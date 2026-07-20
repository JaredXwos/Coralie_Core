import type { StateFlow } from '../../core/state-flow'
import type { LinkState, SessionDescriptionData } from '../../core/types'
import type { PeerLink } from '../peer-link'

/**
 * Offer side of the handshake (§2 rule 1).
 *
 * Initiator → Offering → Connecting → Connected
 *                       ↘ Failed ↗
 *
 * Owns the handshake-timeout check — the Answerer does not, since only
 * initiators retry (rule 4).
 */
export interface Initiator {
  readonly state: StateFlow<LinkState>
  /** The open data channel, once `state` reaches `Connected`. Otherwise `null`. */
  readonly peerLink: PeerLink | null
  /**
   * Creates the data channel and an SDP offer, sets it as the local
   * description, and starts the handshake-timeout clock. The caller
   * is responsible for sending the returned offer to the remote peer
   * via signalling.
   */
  createOffer(): Promise<SessionDescriptionData>
  /** Applies a remote answer received via signalling (rule 3). */
  acceptAnswer(answer: SessionDescriptionData): Promise<void>
  close(): void
}
