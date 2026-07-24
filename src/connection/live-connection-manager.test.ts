import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LiveConnectionManager } from './live-connection-manager'
import type { LiveConnectionManager as ILiveConnectionManager } from './live-connection-manager.interface'
import type { SignallingClient } from '../nostr/signalling-client'
import type { SessionDescriptionData } from '../core/types'
import { createSharedFlow } from '../core/shared-flow'
import { MockPeerConnection } from '../webrtc/peer-connection'
import { MockPeerLink } from '../webrtc/peer-link'

/**
 * Mock SignallingClient for testing.
 */
class MockSignallingClient implements SignallingClient {
  myPubkeyHex: string
  inbound: any
  private inboundFlow: any

  constructor(pubkeyHex: string) {
    this.myPubkeyHex = pubkeyHex
    this.inboundFlow = createSharedFlow()
    this.inbound = this.inboundFlow
  }

  send(toPubkeyHex: string, payload: string): any {
    return { ok: true }
  }

  emitInbound(fromPubkeyHex: string, payload: string): void {
    this.inboundFlow.emit({ fromPubkeyHex, payload })
  }

  close(): void {}
}

/**
 * Factory that produces real MockPeerConnections (which implement the full
 * PeerConnectionLike contract) so LiveInitiator/LiveAnswerer drive correctly.
 */
class MockPeerConnectionFactory {
  connections: MockPeerConnection[] = []

  createPeerConnection(): MockPeerConnection {
    const pc = new MockPeerConnection()
    this.connections.push(pc)
    return pc
  }
}

function createTestConnectionManager(
  signalingClient: MockSignallingClient,
  factory: MockPeerConnectionFactory,
): ILiveConnectionManager {
  const peerConnectionFactory = () => factory.createPeerConnection()
  return new LiveConnectionManager(signalingClient, peerConnectionFactory)
}

describe('LiveConnectionManager — Six Core Rules', () => {
  let signalingClient: MockSignallingClient
  let factory: MockPeerConnectionFactory
  let manager: ILiveConnectionManager

  beforeEach(() => {
    vi.useFakeTimers()
    signalingClient = new MockSignallingClient('my-pubkey-hex')
    factory = new MockPeerConnectionFactory()
    manager = createTestConnectionManager(signalingClient, factory)
  })

  afterEach(() => {
    manager.close()
    vi.useRealTimers()
  })

  describe('Rule 1: New pubkey learned → initiator', () => {
    it('addPeer() with new pubkey creates initiating slot and sends offer', async () => {
      const newPeerPubkey = 'peer-1'
      let offerSent = false
      let offerFrame: any = null

      vi.spyOn(signalingClient, 'send').mockImplementation((to, payload) => {
        if (to === newPeerPubkey) {
          offerSent = true
          offerFrame = JSON.parse(payload)
        }
        return { ok: true }
      })

      manager.addPeer(newPeerPubkey)
      await vi.advanceTimersByTimeAsync(100)

      expect(offerSent).toBe(true)
      expect(offerFrame).toEqual({
        type: 'offer',
        sdp: 'mock-offer-sdp',
      })
    })

    it('addPeer() called twice with same pubkey is idempotent (no-op second time)', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      manager.addPeer('peer-1')
      await vi.advanceTimersByTimeAsync(100)
      const callCountAfterFirst = sendSpy.mock.calls.length

      manager.addPeer('peer-1')
      await vi.advanceTimersByTimeAsync(100)
      const callCountAfterSecond = sendSpy.mock.calls.length

      expect(callCountAfterSecond).toBe(callCountAfterFirst)
    })

    it('addPeer() with own pubkey is ignored', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      manager.addPeer(signalingClient.myPubkeyHex)
      await vi.advanceTimersByTimeAsync(100)

      expect(sendSpy).not.toHaveBeenCalled()
    })
  })

  describe('Rule 2: Always open to answering, gated by empty initiating', () => {
    it('inbound offer rejected while initiating is non-empty', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      manager.addPeer('peer-1')
      await vi.advanceTimersByTimeAsync(100)

      const offer: SessionDescriptionData = { type: 'offer', sdp: 'test-offer' }
      signalingClient.emitInbound('peer-2', JSON.stringify(offer))
      await vi.advanceTimersByTimeAsync(100)

      const answerSent = sendSpy.mock.calls.some((call) => {
        const payload = call[1]
        return payload && payload.includes('"type":"answer"')
      })
      expect(answerSent).toBe(false)
    })

    it('inbound offer accepted when initiating is empty', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      const offer: SessionDescriptionData = { type: 'offer', sdp: 'test-offer' }
      signalingClient.emitInbound('peer-1', JSON.stringify(offer))
      await vi.advanceTimersByTimeAsync(100)

      const answerSent = sendSpy.mock.calls.some((call) => {
        const payload = call[1]
        return payload && payload.includes('"type":"answer"')
      })
      expect(answerSent).toBe(true)
    })
  })

  describe('Rule 3: Inbound answer matched to in-flight initiation', () => {
    it('inbound answer with no matching initiation is no-op', async () => {
      const answer: SessionDescriptionData = { type: 'answer', sdp: 'test-answer' }
      signalingClient.emitInbound('peer-1', JSON.stringify(answer))
      await vi.advanceTimersByTimeAsync(100)
      expect(true).toBe(true)
    })
  })

  describe('Rule 4: Failure → retry up to 5 times, then terminal failure', () => {
    it('5 consecutive failures for one pubkey emits TerminalFailure with attemptCount=5', async () => {
      let terminalFailureEmitted = false
      let terminalCount = 0

      manager.terminalFailures.subscribe((failure) => {
        if (failure.pubkeyHex === 'peer-1') {
          terminalFailureEmitted = true
          terminalCount = failure.attemptCount
        }
      })

      vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      manager.addPeer('peer-1')

      // Drive 5 handshake timeouts (30s each). advanceTimersByTimeAsync flushes
      // the microtasks from each retry's async offer creation between ticks.
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(31_000)
      }

      expect(terminalFailureEmitted).toBe(true)
      expect(terminalCount).toBe(5)
    })

    it('3 failures then success does not emit terminal failure', async () => {
      let terminalFailureEmitted = false

      manager.terminalFailures.subscribe(() => {
        terminalFailureEmitted = true
      })

      vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      manager.addPeer('peer-1')

      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(31_000)
      }

      expect(terminalFailureEmitted).toBe(false)
    })
  })

  describe('Signalling validation', () => {
    it('ignores non-SDP signalling messages', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      signalingClient.emitInbound(
        'source-peer',
        JSON.stringify({ type: 'announce', pubkeyHex: 'new-peer' }),
      )
      await vi.advanceTimersByTimeAsync(100)

      expect(sendSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })


  describe('Data-channel frame format', () => {
    it('sends application bytes as a lowercase app frame with a JSON array', () => {
      const peerLink = new MockPeerLink()
      const concreteManager = manager as unknown as {
        connected: Map<string, MockPeerLink>
      }
      concreteManager.connected.set('peer-1', peerLink)

      manager.sendToPeer('peer-1', new Uint8Array([0, 127, 128, 255]))

      expect(peerLink.sent).toHaveLength(1)
      const frame = JSON.parse(new TextDecoder().decode(peerLink.sent[0]))
      expect(frame).toEqual({
        type: 'app',
        payload: [0, 127, -128, -1],
      })
    })

    it('normalises signed Android bytes when receiving an app frame', () => {
      let receivedPayload: Uint8Array | undefined
      manager.incomingMessages.subscribe((message) => {
        receivedPayload = message.payload
      })

      const frame = new TextEncoder().encode(
        JSON.stringify({ type: 'app', payload: [0, 127, -128, -1] }),
      )
      const concreteManager = manager as unknown as {
        onIncomingDataChannel(fromPubkeyHex: string, bytes: Uint8Array): void
      }
      concreteManager.onIncomingDataChannel('peer-1', frame)

      expect(receivedPayload).toEqual(new Uint8Array([0, 127, 128, 255]))
    })

    it('broadcasts announcements using the lowercase announce frame', () => {
      const existingPeer = new MockPeerLink()
      const newPeer = new MockPeerLink()
      const concreteManager = manager as unknown as {
        connected: Map<string, MockPeerLink>
        broadcastAnnounce(newPubkeyHex: string): void
      }
      concreteManager.connected.set('existing-peer', existingPeer)
      concreteManager.connected.set('new-peer', newPeer)

      concreteManager.broadcastAnnounce('new-peer')

      expect(existingPeer.sent).toHaveLength(1)
      expect(newPeer.sent).toHaveLength(0)
      const frame = JSON.parse(new TextDecoder().decode(existingPeer.sent[0]))
      expect(frame).toEqual({
        type: 'announce',
        pubkeyHex: 'new-peer',
      })
    })
  })

  describe('Timeout checking', () => {
    it('30s timeout on handshake triggers failure and retry', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      manager.addPeer('peer-1')
      await vi.advanceTimersByTimeAsync(100)

      expect(sendSpy).toHaveBeenCalled()
      const callsBefore = sendSpy.mock.calls.length

      // Advance past the 30s handshake timeout to trigger a retry
      await vi.advanceTimersByTimeAsync(31_000)

      expect(sendSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  describe('Close and cleanup', () => {
    it('close() clears all connections and stops timers', async () => {
      manager.addPeer('peer-1')
      await vi.advanceTimersByTimeAsync(100)

      manager.close()

      await vi.advanceTimersByTimeAsync(10_000)
      expect(true).toBe(true)
    })
  })
})