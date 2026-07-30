import type { Initiator } from '../webrtc/initiator'
import type { Answerer } from '../webrtc/answerer'
import type { PeerLink } from '../webrtc/peer-link'
import type { SignallingClient } from '../nostr/signalling-client'
import type { MutableSharedFlow } from '../core/shared-flow'
import type { MutableStateFlow } from '../core/state-flow'
import type { DataChannelFrame, SessionDescriptionData, LinkState, TerminalFailure, PeerMessage, Result } from '../core/types'
import type { PeerConnectionFactory, PeerConnectionObserver } from '../webrtc/peer-connection'

import { LiveInitiator } from '../webrtc/initiator'
import { LiveAnswerer } from '../webrtc/answerer'
import { createStateFlow } from '../core/state-flow'
import { createSharedFlow } from '../core/shared-flow'
import type { MeshPeer, LiveConnectionManager as LiveConnectionManagerContract } from './live-connection-manager.interface'
import { err, ok } from '../core/types'

const HANDSHAKE_TIMEOUT_MS = 30_000
const MAX_INITIATION_ATTEMPTS = 5

/**
 * In-flight initiation slot (§3).
 * Holds a peer connection, attempt counter, and start time for the
 * 30s handshake timeout check.
 */
interface InitiatingSlot {
  connection: Initiator
  attemptCount: number
  startedAt: number
}

/**
 * One in-flight answer for a peer. Keeping the offer alongside the answerer
 * lets us distinguish a duplicate relay delivery from a fresh initiator retry.
 */
interface AnsweringSlot {
  connection: Answerer
  offer: SessionDescriptionData
}

/**
 * LiveConnectionManager: orchestrator for the mesh, enforcing §2's six rules
 * and §4's concurrency discipline.
 *
 * State maps:
 * - `initiating`: pubkeyHex → { connection, attemptCount, startedAt }
 * - `answering`: pubkeyHex → { connection, offer }
 * - `connected`: pubkeyHex → PeerLink (data channel wrapper)
 *
 * Concurrency: after every async operation (signalling send, timeout check),
 * verify identity of the slot before mutating state. This is the sole
 * concurrency mechanism — no locks, no queues.
 */
export class LiveConnectionManager implements LiveConnectionManagerContract {
  readonly myPubkeyHex: string
  readonly peers: MutableStateFlow<Set<MeshPeer>>
  readonly incomingMessages: MutableSharedFlow<PeerMessage>
  readonly terminalFailures: MutableSharedFlow<TerminalFailure>

  private initiating = new Map<string, InitiatingSlot>()
  private answering = new Map<string, AnsweringSlot>()
  private connected = new Map<string, PeerLink>()

  private signalingClient: SignallingClient
  private peerConnectionFactory: PeerConnectionFactory
  private timeoutCheckInterval: number | null = null
  private closed = false
  private handshakeTimeoutMs: number
  private observerFactory?: (peerPubkeyHex: string, role: 'initiator' | 'answerer') => PeerConnectionObserver

  constructor(
    signalingClient: SignallingClient,
    peerConnectionFactory: PeerConnectionFactory,
    handshakeTimeoutMs?: number,
    observerFactory?: (peerPubkeyHex: string, role: 'initiator' | 'answerer') => PeerConnectionObserver,
  ) {
    this.myPubkeyHex = signalingClient.myPubkeyHex
    this.signalingClient = signalingClient
    this.peerConnectionFactory = peerConnectionFactory
    this.handshakeTimeoutMs = handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
    this.observerFactory = observerFactory

    this.peers = createStateFlow(new Set<MeshPeer>())
    this.incomingMessages = createSharedFlow<PeerMessage>()
    this.terminalFailures = createSharedFlow<TerminalFailure>()

    this.setupInboundSignalling()
    this.startTimeoutChecker()
  }

  private setupInboundSignalling(): void {
    this.signalingClient.inbound.subscribe((message) => {
      if (this.closed) return

      try {
        const description: unknown = JSON.parse(message.payload)

        if (!this.isSessionDescription(description)) {
          throw new Error('Unsupported signalling message')
        }

        if (description.type === 'offer') {
          this.onInboundOffer(message.fromPubkeyHex, description)
        } else {
          this.onInboundAnswer(message.fromPubkeyHex, description)
        }
      } catch (err) {
        console.error(`Failed to parse signalling message from ${message.fromPubkeyHex}:`, err)
      }
    })
  }

  private isSessionDescription(value: unknown): value is SessionDescriptionData {
    if (typeof value !== 'object' || value === null) return false

    const description = value as Record<string, unknown>
    return (
      (description.type === 'offer' || description.type === 'answer') &&
      typeof description.sdp === 'string'
    )
  }

  private startTimeoutChecker(): void {
    this.timeoutCheckInterval = setInterval(() => {
      if (this.closed) return
      this.checkTimeouts()
    }, 1000) as unknown as number
  }

  /**
   * §2 rule 1: New pubkey learned → become initiator if conditions met.
   * Idempotent: calling twice with same pubkey while `initiating` is a no-op.
   */
  addPeer(pubkeyHex: string): void {
    if (this.closed) return
    if (pubkeyHex === this.myPubkeyHex) return // Ignore self
    if (this.initiating.has(pubkeyHex)) return // Already initiating
    if (this.answering.has(pubkeyHex)) return // Already answering
    if (this.connected.has(pubkeyHex)) return // Already connected

    this.startInitiation(pubkeyHex)
  }

  private startInitiation(pubkeyHex: string): void {
    const connection = new LiveInitiator({
      peerConnectionFactory: this.peerConnectionFactory,
      handshakeTimeoutMs: this.handshakeTimeoutMs,
      observer: this.observerFactory?.(pubkeyHex, 'initiator'),
    })

    const slot: InitiatingSlot = {
      connection,
      attemptCount: 1,
      startedAt: Date.now(),
    }
    this.initiating.set(pubkeyHex, slot)

    // Watch for connection failures
    connection.state.subscribe((state) => {
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== connection) return // Stale

      if (state === 'Connected') {
        this.onLinkConnected(pubkeyHex, connection.peerLink!)
      } else if (state === 'Failed') {
        this.onAttemptFailed(pubkeyHex)
      }
    })

    // Create and send offer
    this.sendOfferAsync(pubkeyHex, connection)
  }

  private async sendOfferAsync(pubkeyHex: string, initiator: Initiator): Promise<void> {
    try {
      const offer = await initiator.createOffer()
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return // Stale

      const result = this.signalingClient.send(pubkeyHex, JSON.stringify(offer))
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return // Stale

      if (!result.ok) {
        // Failed to send: count as failed attempt
        this.onAttemptFailed(pubkeyHex)
      }
    } catch (err) {
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return // Stale
      console.error(`Failed to create/send offer to ${pubkeyHex}:`, err)
      this.onAttemptFailed(pubkeyHex)
    }
  }

  /**
   * §2 rule 2: Inbound offer handling.
   *
   * There is no global initiation lock: this node may answer peer C while it
   * is initiating peers A and B. The gate is per peer only. If this node is
   * already initiating the sender, the offer is ignored so the one-sided role
   * selected by gossip remains intact.
   *
   * While answering a peer, an exact repeat of the same offer is a duplicate
   * relay delivery. A different SDP is a fresh initiator retry and replaces
   * the unfinished answerer; otherwise every retry would be ignored until the
   * first answerer eventually failed.
   */
  private onInboundOffer(fromPubkeyHex: string, offer: SessionDescriptionData): void {
    if (this.closed) return
    if (this.connected.has(fromPubkeyHex)) return
    if (this.initiating.has(fromPubkeyHex)) return

    const existing = this.answering.get(fromPubkeyHex)
    if (existing) {
      if (this.sameSessionDescription(existing.offer, offer)) return

      this.answering.delete(fromPubkeyHex)
      existing.connection.close()
    }

    const answerer = new LiveAnswerer({
      peerConnectionFactory: this.peerConnectionFactory,
      observer: this.observerFactory?.(fromPubkeyHex, 'answerer'),
    })
    const slot: AnsweringSlot = { connection: answerer, offer }
    this.answering.set(fromPubkeyHex, slot)

    // Watch for connection state changes (wired up before accepting the offer
    // so we can't miss a synchronous/near-synchronous 'Connected' transition)
    answerer.state.subscribe((state) => {
      if (this.closed) return
      if (this.answering.get(fromPubkeyHex) !== slot) return // Stale/replaced

      if (state === 'Connected') {
        this.onLinkConnected(fromPubkeyHex, answerer.peerLink!)
      } else if (state === 'Failed') {
        this.answering.delete(fromPubkeyHex)
        answerer.close()
      }
    })

    // Create and send the answer (exactly once — calling this twice would run
    // setRemoteDescription()/setLocalDescription() a second time on the same
    // RTCPeerConnection, which real WebRTC treats as a fresh renegotiation)
    this.acceptOfferInAnswerer(fromPubkeyHex, slot)
  }

  private sameSessionDescription(
    left: SessionDescriptionData,
    right: SessionDescriptionData,
  ): boolean {
    return left.type === right.type && left.sdp === right.sdp
  }

  private async acceptOfferInAnswerer(
    toPubkeyHex: string,
    slot: AnsweringSlot,
  ): Promise<void> {
    try {
      const answer = await slot.connection.createAnswer(slot.offer)
      if (this.closed) return
      if (this.answering.get(toPubkeyHex) !== slot) return // Replaced by retry

      const result = this.signalingClient.send(toPubkeyHex, JSON.stringify(answer))
      if (this.closed) return
      if (this.answering.get(toPubkeyHex) !== slot) return // Replaced while sending

      if (!result.ok) {
        this.answering.delete(toPubkeyHex)
        slot.connection.close()
      }
    } catch (err) {
      if (this.closed) return
      if (this.answering.get(toPubkeyHex) !== slot) return // Stale failure

      this.answering.delete(toPubkeyHex)
      slot.connection.close()
      console.error(`Failed to create/send answer to ${toPubkeyHex}:`, err)
    }
  }

  /**
   * §2 rule 3: Inbound answer handling.
   * Match against in-flight initiation for the sender's pubkey.
   * If no matching slot or slot has been superseded by a retry: no-op.
   */
  private onInboundAnswer(fromPubkeyHex: string, answer: SessionDescriptionData): void {
    if (this.closed) return

    const slot = this.initiating.get(fromPubkeyHex)
    if (!slot) return // No in-flight initiation

    // Attempt to apply the answer; if the connection has been superseded,
    // acceptAnswer will throw or fail gracefully (ICE will fail).
    // Both paths count as a failure (rule 4).
    this.applyAnswerAsync(fromPubkeyHex, slot.connection, answer)
  }

  private async applyAnswerAsync(pubkeyHex: string, initiator: Initiator, answer: SessionDescriptionData): Promise<void> {
    try {
      await initiator.acceptAnswer(answer)
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return // Stale

      // Answer accepted; connection will now proceed through ICE toward Connected or Failed
    } catch (err) {
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return // Stale
      console.error(`Failed to apply answer from ${pubkeyHex}:`, err)
      this.onAttemptFailed(pubkeyHex)
    }
  }

  /**
   * §2 rule 4: Attempt failure handling.
   * Increment counter; if ≥ 5: remove pubkey and emit terminal failure.
   * Otherwise: create fresh peer connection and retry.
   */
  private onAttemptFailed(pubkeyHex: string): void {
    if (this.closed) return

    const slot = this.initiating.get(pubkeyHex)
    if (!slot) return // Already removed (stale retry)

    slot.connection.close()

    if (slot.attemptCount >= MAX_INITIATION_ATTEMPTS) {
      // Terminal failure
      this.initiating.delete(pubkeyHex)
      this.terminalFailures.emit({
        pubkeyHex,
        attemptCount: slot.attemptCount,
        reason: 'Exhausted maximum retry attempts',
      })
      return
    }

    // Retry: create fresh peer connection, same pubkey, increment counter
    slot.attemptCount += 1
    slot.startedAt = Date.now()

    const newConnection = new LiveInitiator({
      peerConnectionFactory: this.peerConnectionFactory,
      handshakeTimeoutMs: this.handshakeTimeoutMs,
      observer: this.observerFactory?.(pubkeyHex, 'initiator'),
    })
    slot.connection = newConnection

    // Watch for failures on the new attempt
    newConnection.state.subscribe((state) => {
      if (this.closed) return
      if (this.initiating.get(pubkeyHex)?.connection !== newConnection) return // Stale

      if (state === 'Connected') {
        this.onLinkConnected(pubkeyHex, newConnection.peerLink!)
      } else if (state === 'Failed') {
        this.onAttemptFailed(pubkeyHex)
      }
    })

    // Send fresh offer
    this.sendOfferAsync(pubkeyHex, newConnection)
  }

  /**
   * §2 rule 5: Connection reaches open.
   * Move from `initiating` to `connected`, broadcast `announce` to all other
   * connected peers (best-effort).
   */
  private onLinkConnected(pubkeyHex: string, peerLink: PeerLink): void {
    if (this.closed) return

    const existing = this.connected.get(pubkeyHex)
    if (existing) {
      if (existing !== peerLink) peerLink.close()
      return
    }

    // Remove whichever in-flight role produced this link.
    this.initiating.delete(pubkeyHex)
    this.answering.delete(pubkeyHex)

    // Add to connected
    this.connected.set(pubkeyHex, peerLink)

    // Update peers StateFlow
    const updatedPeers = new Set(this.peers.value)
    updatedPeers.add({ pubkeyHex, connectedAt: Date.now() })
    this.peers.value = updatedPeers

    // Watch for incoming data on this peer
    peerLink.incomingBytes.subscribe((bytes) => {
      if (this.closed) return
      this.onIncomingDataChannel(pubkeyHex, bytes)
    })

    // Watch for peer close/failure
    peerLink.state.subscribe((state) => {
      if (this.closed) return
      if (this.connected.get(pubkeyHex) !== peerLink) return // Stale

      if (state === 'closed') {
        this.onLinkClosed(pubkeyHex)
      }
    })

    // §2 rule 5: broadcast an announce for this new pubkey to every *other*
    // connected peer (not a roster — just the one peer that just joined).
    this.broadcastAnnounce(pubkeyHex)
  }

  private onIncomingDataChannel(fromPubkeyHex: string, bytes: Uint8Array): void {
    if (this.closed) return

    try {
      const text = new TextDecoder().decode(bytes)
      const frame: unknown = JSON.parse(text)

      if (!this.isDataChannelFrame(frame)) {
        throw new Error('Unsupported data-channel frame')
      }

      if (frame.type === 'app') {
        this.incomingMessages.emit({
          from: fromPubkeyHex,
          to: this.myPubkeyHex,
          timestamp: Date.now(),
          payload: Uint8Array.from(frame.payload, (value) => value & 0xff),
        })
      } else {
        this.onInboundAnnounce(fromPubkeyHex, frame.pubkeyHex)
      }
    } catch (err) {
      console.error(`Failed to parse data channel frame from ${fromPubkeyHex}:`, err)
    }
  }

  private isDataChannelFrame(value: unknown): value is DataChannelFrame {
    if (typeof value !== 'object' || value === null) return false

    const frame = value as Record<string, unknown>

    if (frame.type === 'announce') {
      return typeof frame.pubkeyHex === 'string'
    }

    if (frame.type === 'app') {
      return (
        Array.isArray(frame.payload) &&
        frame.payload.every(
          (byte) => Number.isInteger(byte) && byte >= -128 && byte <= 255,
        )
      )
    }

    return false
  }

  /**
   * §2 rule 6: Connection closes or fails (post-open).
   * Remove from `connected`. No re-announce, no cleanup broadcast.
   */
  private onLinkClosed(pubkeyHex: string): void {
    if (this.closed) return

    const peerLink = this.connected.get(pubkeyHex)
    if (!peerLink) return // Stale

    this.connected.delete(pubkeyHex)
    peerLink.close()

    // Update peers StateFlow by removing this peer
    const updatedPeers = new Set(this.peers.value)
    updatedPeers.forEach((peer) => {
      if (peer.pubkeyHex === pubkeyHex) {
        updatedPeers.delete(peer)
      }
    })
    this.peers.value = updatedPeers
  }

  /**
   * §2 rule 5: broadcast an announce for one newly-connected pubkey to every
   * *other* connected peer. This is not a roster sync — the recipient learns
   * about exactly one new peer, not the sender's full connected set — and the
   * newly-connected peer itself is excluded (it doesn't need telling about
   * its own connection). Best-effort, no retry, no acknowledgement.
   */
  private broadcastAnnounce(newPubkeyHex: string): void {
    const frame: DataChannelFrame = {
      type: 'announce',
      pubkeyHex: newPubkeyHex,
    }
    const bytes = new TextEncoder().encode(JSON.stringify(frame))

    for (const [peerPubkey, peerLink] of this.connected.entries()) {
      if (peerPubkey === newPubkeyHex) continue // Don't tell the new peer about itself
      const result = peerLink.send(bytes)
      if (!result.ok && this.connected.get(peerPubkey) === peerLink) {
        this.onLinkClosed(peerPubkey)
      }
    }
  }

  /**
   * Inbound announce handling: learn a new peer via gossip (§2 rule 5).
   * If already `initiating` or `connected`: no-op (idempotent).
   * Otherwise: call `addPeer()` (same entry point, same idempotency).
   */
  private onInboundAnnounce(fromPubkeyHex: string, pubkeyHex: string): void {
    if (this.closed) return
    if (pubkeyHex === this.myPubkeyHex) return // Ignore self
    if (this.initiating.has(pubkeyHex)) return // Already initiating
    if (this.answering.has(pubkeyHex)) return // Already answering
    if (this.connected.has(pubkeyHex)) return // Already connected

    // Learn new peer via gossip
    this.addPeer(pubkeyHex)
  }

  /**
   * Timeout checker: runs every 1s, checks all `initiating` slots for
   * 30s elapsed time. Any slot that has exceeded timeout is marked failed.
   */
  private checkTimeouts(): void {
    const now = Date.now()
    const expired: string[] = []

    for (const [pubkeyHex, slot] of this.initiating.entries()) {
      if (now - slot.startedAt >= this.handshakeTimeoutMs) {
        expired.push(pubkeyHex)
      }
    }

    for (const pubkeyHex of expired) {
      this.onAttemptFailed(pubkeyHex)
    }
  }

  /**
   * Send a message to a connected peer via data channel.
   * Returns a failure if the manager or peer channel is unavailable.
   */
  sendToPeer(toPubkeyHex: string, payload: Uint8Array): Result<void> {
    if (this.closed) {
      return err(new Error('connection manager is closed'))
    }

    const peerLink = this.connected.get(toPubkeyHex)
    if (!peerLink) {
      return err(new Error('peer is not connected'))
    }

    const frame: DataChannelFrame = {
      type: 'app',
      payload: Array.from(payload, (value) => (value > 127 ? value - 256 : value)),
    }

    const bytes = new TextEncoder().encode(JSON.stringify(frame))
    const result = peerLink.send(bytes)
    if (!result.ok) {
      if (this.connected.get(toPubkeyHex) === peerLink) {
        this.onLinkClosed(toPubkeyHex)
      }
      return result
    }
    return ok(undefined)
  }

  /**
   * Close all connections and stop timers.
   */
  close(): void {
    if (this.closed) return
    this.closed = true

    if (this.timeoutCheckInterval !== null) {
      clearInterval(this.timeoutCheckInterval)
    }

    for (const slot of this.initiating.values()) {
      slot.connection.close()
    }
    this.initiating.clear()

    for (const slot of this.answering.values()) {
      slot.connection.close()
    }
    this.answering.clear()

    for (const peerLink of this.connected.values()) {
      peerLink.close()
    }
    this.connected.clear()

    this.signalingClient.close()
  }
}
