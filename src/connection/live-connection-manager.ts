import type { Initiator } from '../webrtc/initiator'
import type { Answerer } from '../webrtc/answerer'
import type { PeerLink } from '../webrtc/peer-link'
import type { SignallingClient } from '../nostr/signalling-client'
import type { SharedFlow } from '../core/shared-flow'
import type { MutableStateFlow } from '../core/state-flow'
import type { DataChannelFrame, SessionDescriptionData, LinkState, TerminalFailure, PeerMessage } from '../core/types'
import type { PeerConnectionFactory } from '../webrtc/peer-connection'

import { LiveInitiator } from '../webrtc/initiator'
import { LiveAnswerer } from '../webrtc/answerer'
import { createStateFlow } from '../core/state-flow'
import { createSharedFlow } from '../core/shared-flow'
import type { MeshPeer, LiveConnectionManager } from './live-connection-manager.interface'

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
 * LiveConnectionManager: orchestrator for the mesh, enforcing §2's six rules
 * and §4's concurrency discipline.
 *
 * State maps:
 * - `initiating`: pubkeyHex → { connection, attemptCount, startedAt }
 * - `connected`: pubkeyHex → PeerLink (data channel wrapper)
 *
 * Concurrency: after every async operation (signalling send, timeout check),
 * verify identity of the slot before mutating state. This is the sole
 * concurrency mechanism — no locks, no queues.
 */
export class LiveConnectionManager implements LiveConnectionManager {
  readonly myPubkeyHex: string
  readonly peers: MutableStateFlow<Set<MeshPeer>>
  readonly incomingMessages: SharedFlow<PeerMessage>
  readonly terminalFailures: SharedFlow<TerminalFailure>

  private initiating = new Map<string, InitiatingSlot>()
  private connected = new Map<string, PeerLink>()

  private signalingClient: SignallingClient
  private peerConnectionFactory: PeerConnectionFactory
  private timeoutCheckInterval: number | null = null
  private closed = false

  constructor(
    signalingClient: SignallingClient,
    peerConnectionFactory: PeerConnectionFactory,
  ) {
    this.myPubkeyHex = signalingClient.myPubkeyHex
    this.signalingClient = signalingClient
    this.peerConnectionFactory = peerConnectionFactory

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
        const frame: DataChannelFrame = JSON.parse(message.payload)

        if (frame.type === 'Offer') {
          this.onInboundOffer(message.fromPubkeyHex, frame.sessionDescription, frame.attemptCount)
        } else if (frame.type === 'Answer') {
          this.onInboundAnswer(message.fromPubkeyHex, frame.sessionDescription)
        } else if (frame.type === 'Announce') {
          this.onInboundAnnounce(message.fromPubkeyHex, frame.pubkeys)
        }
      } catch (err) {
        console.error(`Failed to parse signalling frame from ${message.fromPubkeyHex}:`, err)
      }
    })
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
    if (this.connected.has(pubkeyHex)) return // Already connected

    this.startInitiation(pubkeyHex)
  }

  private startInitiation(pubkeyHex: string): void {
    const connection = new LiveInitiator({ peerConnectionFactory: this.peerConnectionFactory })

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

      const frame: DataChannelFrame = {
        type: 'Offer',
        sessionDescription: offer,
        attemptCount: this.initiating.get(pubkeyHex)!.attemptCount,
      }

      const result = this.signalingClient.send(pubkeyHex, JSON.stringify(frame))
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
   * Accept only if:
   * - sender is not already `connected`
   * - `initiating` map is empty (global gate)
   */
  private onInboundOffer(fromPubkeyHex: string, offer: SessionDescriptionData, attemptCount: number): void {
    if (this.closed) return

    // Reject if sender is already connected
    if (this.connected.has(fromPubkeyHex)) return

    // Reject if we are actively initiating toward anyone
    if (this.initiating.size > 0) return

    // Accept: become answerer
    const answerer = new LiveAnswerer({ peerConnectionFactory: this.peerConnectionFactory })
    
    // Queue the offer creation since we need to accept it after construction
    this.acceptOfferInAnswerer(fromPubkeyHex, answerer, offer)

    // Watch for connection state changes
    answerer.state.subscribe((state) => {
      if (this.closed) return
      if (this.initiating.has(fromPubkeyHex)) return // Should not happen in answer path

      if (state === 'Connected') {
        this.onLinkConnected(fromPubkeyHex, answerer.peerLink!)
      } else if (state === 'Failed') {
        // Answerer failures are silent; we do not retry (rule 4 applies only to initiators)
      }
    })

    // Create and send answer
    this.acceptOfferInAnswerer(fromPubkeyHex, answerer, offer)
  }

  private async acceptOfferInAnswerer(toPubkeyHex: string, answerer: Answerer, offer: SessionDescriptionData): Promise<void> {
    try {
      const answer = await answerer.createAnswer(offer)
      if (this.closed) return

      const frame: DataChannelFrame = {
        type: 'Answer',
        sessionDescription: answer,
      }

      this.signalingClient.send(toPubkeyHex, JSON.stringify(frame))
    } catch (err) {
      if (this.closed) return
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

    const newConnection = new LiveInitiator({ peerConnectionFactory: this.peerConnectionFactory })
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
   * Move from `initiating` to `connected`, broadcast `Announce` to all other
   * connected peers (best-effort).
   */
  private onLinkConnected(pubkeyHex: string, peerLink: PeerLink): void {
    if (this.closed) return

    // Remove from initiating (no-op if this was an answerer)
    this.initiating.delete(pubkeyHex)

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

      if (state === 'Closed' || state === 'Failed') {
        this.onLinkClosed(pubkeyHex)
      }
    })

    // Broadcast Announce: pubkeys of all other connected peers
    this.broadcastAnnounce()
  }

  private onIncomingDataChannel(fromPubkeyHex: string, bytes: Uint8Array): void {
    if (this.closed) return

    try {
      const text = new TextDecoder().decode(bytes)
      const frame: DataChannelFrame = JSON.parse(text)

      if (frame.type === 'Data') {
        this.incomingMessages.emit({
          from: fromPubkeyHex,
          to: this.myPubkeyHex,
          timestamp: Date.now(),
          payload: frame.payload,
        })
      } else if (frame.type === 'Announce') {
        this.onInboundAnnounce(fromPubkeyHex, frame.pubkeys)
      }
    } catch (err) {
      console.error(`Failed to parse data channel frame from ${fromPubkeyHex}:`, err)
    }
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
   * Broadcast Announce frame to all connected peers except self.
   * Payload: list of all other connected peer pubkeys.
   * Best-effort, no retry, no acknowledgement.
   */
  private broadcastAnnounce(): void {
    if (this.connected.size <= 1) return // Nothing to announce

    const pubkeys = Array.from(this.connected.keys())
    const frame: DataChannelFrame = {
      type: 'Announce',
      pubkeys,
    }

    for (const [peerPubkey, peerLink] of this.connected.entries()) {
      const bytes = new TextEncoder().encode(JSON.stringify(frame))
      peerLink.send(bytes)
    }
  }

  /**
   * Inbound Announce handling: learn new peers via gossip (§2 rule 5).
   * For each pubkey in the announce:
   * - If already `initiating` or `connected`: no-op (idempotent)
   * - Otherwise: call `addPeer()` (same entry point, same idempotency)
   */
  private onInboundAnnounce(fromPubkeyHex: string, pubkeys: string[]): void {
    if (this.closed) return

    for (const pubkey of pubkeys) {
      if (pubkey === this.myPubkeyHex) continue // Ignore self
      if (this.initiating.has(pubkey)) continue // Already initiating
      if (this.connected.has(pubkey)) continue // Already connected

      // Learn new peer via gossip
      this.addPeer(pubkey)
    }
  }

  /**
   * Timeout checker: runs every 1s, checks all `initiating` slots for
   * 30s elapsed time. Any slot that has exceeded timeout is marked failed.
   */
  private checkTimeouts(): void {
    const now = Date.now()
    const expired: string[] = []

    for (const [pubkeyHex, slot] of this.initiating.entries()) {
      if (now - slot.startedAt >= HANDSHAKE_TIMEOUT_MS) {
        expired.push(pubkeyHex)
      }
    }

    for (const pubkeyHex of expired) {
      this.onAttemptFailed(pubkeyHex)
    }
  }

  /**
   * Send a message to a connected peer via data channel.
   * If not connected: dropped silently.
   */
  sendToPeer(toPubkeyHex: string, payload: unknown): void {
    if (this.closed) return

    const peerLink = this.connected.get(toPubkeyHex)
    if (!peerLink) return

    const frame: DataChannelFrame = {
      type: 'Data',
      payload: payload as Uint8Array,
    }

    const bytes = new TextEncoder().encode(JSON.stringify(frame))
    peerLink.send(bytes)
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

    for (const peerLink of this.connected.values()) {
      peerLink.close()
    }
    this.connected.clear()

    this.signalingClient.close()
  }
}
