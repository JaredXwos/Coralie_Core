import type { StateFlow } from '../../core/state-flow'
import type { LinkState, SessionDescriptionData } from '../../core/types'
import type { PeerLink } from '../peer-link'

/**
 * Answer side of the handshake (§2 rule 2 — always open to being an
 * answerer, gated only at the orchestrator level, not here).
 *
 * Answering → Connecting → Connected
 *                        ↘ Failed ↗
 *
 * No handshake timeout: only initiators retry (rule 4).
 */
export interface Answerer {
  readonly state: StateFlow<LinkState>
  /** The open data channel, once `state` reaches `Connected`. Otherwise `null`. */
  readonly peerLink: PeerLink | null
  /**
   * Applies the remote offer, creates an SDP answer, and sets it as
   * the local description. The caller sends the returned answer back
   * to the initiator via signalling.
   */
  createAnswer(offer: SessionDescriptionData): Promise<SessionDescriptionData>
  close(): void
}
