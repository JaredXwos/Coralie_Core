import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { LinkState, type SessionDescriptionData } from '../../core/types'
import type { PeerLink } from '../peer-link'
import type { Answerer } from './answerer.interface'

/**
 * An `Answerer` test double with no real (or mock) `RTCPeerConnection`
 * underneath — just the state machine, driven manually by tests.
 */
export class MockAnswerer implements Answerer {
  private readonly stateFlow = createStateFlow<LinkState>(LinkState.Answering)
  private link: PeerLink | null = null
  /** Every offer passed to `createAnswer()`, in order. */
  readonly offersReceived: SessionDescriptionData[] = []

  get state(): StateFlow<LinkState> {
    return this.stateFlow.asReadOnly()
  }

  get peerLink(): PeerLink | null {
    return this.link
  }

  async createAnswer(offer: SessionDescriptionData): Promise<SessionDescriptionData> {
    this.offersReceived.push(offer)
    this.stateFlow.value = LinkState.Connecting
    return { type: 'answer', sdp: 'mock-answer-sdp' }
  }

  close(): void {
    this.link?.close()
    this.stateFlow.value = LinkState.Closed
  }

  // --- test-only driver methods ---

  /** Forces the state machine to Connected, attaching the given PeerLink. */
  simulateConnected(link: PeerLink): void {
    this.link = link
    this.stateFlow.value = LinkState.Connected
  }

  /** Forces the state machine to Failed. */
  simulateFailed(): void {
    if (this.stateFlow.value === LinkState.Closed) return
    this.stateFlow.value = LinkState.Failed
  }
}
