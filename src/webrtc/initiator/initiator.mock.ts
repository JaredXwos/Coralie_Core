import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { LinkState, type SessionDescriptionData } from '../../core/types'
import type { PeerLink } from '../peer-link'
import type { Initiator } from './initiator.interface'

/**
 * An `Initiator` test double with no real (or mock) `RTCPeerConnection`
 * underneath — just the state machine, driven manually by tests.
 * Useful for testing the future orchestrator without pulling in the
 * WebRTC seam at all.
 */
export class MockInitiator implements Initiator {
  private readonly stateFlow = createStateFlow<LinkState>(LinkState.Initiating)
  private link: PeerLink | null = null
  /** Every offer returned by `createOffer()`, in order. */
  readonly offersCreated: SessionDescriptionData[] = []
  /** Every answer passed to `acceptAnswer()`, in order. */
  readonly answersAccepted: SessionDescriptionData[] = []

  get state(): StateFlow<LinkState> {
    return this.stateFlow.asReadOnly()
  }

  get peerLink(): PeerLink | null {
    return this.link
  }

  async createOffer(): Promise<SessionDescriptionData> {
    this.stateFlow.value = LinkState.Offering
    const offer: SessionDescriptionData = { type: 'offer', sdp: 'mock-offer-sdp' }
    this.offersCreated.push(offer)
    this.stateFlow.value = LinkState.Connecting
    return offer
  }

  async acceptAnswer(answer: SessionDescriptionData): Promise<void> {
    if (this.stateFlow.value !== LinkState.Connecting) return
    this.answersAccepted.push(answer)
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

  /** Forces the state machine to Failed (connection failure or handshake timeout). */
  simulateFailed(): void {
    if (this.stateFlow.value === LinkState.Closed) return
    this.stateFlow.value = LinkState.Failed
  }
}
