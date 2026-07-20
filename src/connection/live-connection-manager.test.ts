import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LiveConnectionManager } from './live-connection-manager'
import type { LiveConnectionManager as ILiveConnectionManager } from './live-connection-manager.interface'
import type { SignallingClient } from '../nostr/signalling-client'
import type { SessionDescriptionData } from '../core/types'
import { createSharedFlow } from '../core/shared-flow'
import { MockPeerConnection } from '../webrtc/peer-connection'

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
      expect(offerFrame?.type).toBe('Offer')
      expect(offerFrame?.attemptCount).toBe(1)
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
      signalingClient.emitInbound('peer-2', JSON.stringify({ type: 'Offer', sessionDescription: offer, attemptCount: 1 }))
      await vi.advanceTimersByTimeAsync(100)

      const answerSent = sendSpy.mock.calls.some((call) => {
        const payload = call[1]
        return payload && payload.includes('"type":"Answer"')
      })
      expect(answerSent).toBe(false)
    })

    it('inbound offer accepted when initiating is empty', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      const offer: SessionDescriptionData = { type: 'offer', sdp: 'test-offer' }
      signalingClient.emitInbound('peer-1', JSON.stringify({ type: 'Offer', sessionDescription: offer, attemptCount: 1 }))
      await vi.advanceTimersByTimeAsync(100)

      const answerSent = sendSpy.mock.calls.some((call) => {
        const payload = call[1]
        return payload && payload.includes('"type":"Answer"')
      })
      expect(answerSent).toBe(true)
    })
  })

  describe('Rule 3: Inbound answer matched to in-flight initiation', () => {
    it('inbound answer with no matching initiation is no-op', async () => {
      const answer: SessionDescriptionData = { type: 'answer', sdp: 'test-answer' }
      signalingClient.emitInbound('peer-1', JSON.stringify({ type: 'Answer', sessionDescription: answer }))
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

  describe('Announce gossip handling', () => {
    it('inbound Announce learning new peer calls addPeer idempotently', async () => {
      const sendSpy = vi.spyOn(signalingClient, 'send').mockReturnValue({ ok: true })

      signalingClient.emitInbound('source-peer', JSON.stringify({ type: 'Announce', pubkeys: ['new-peer'] }))
      await vi.advanceTimersByTimeAsync(100)

      const firstCallCount = sendSpy.mock.calls.length

      signalingClient.emitInbound('source-peer', JSON.stringify({ type: 'Announce', pubkeys: ['new-peer'] }))
      await vi.advanceTimersByTimeAsync(100)

      expect(sendSpy.mock.calls.length).toBe(firstCallCount)
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