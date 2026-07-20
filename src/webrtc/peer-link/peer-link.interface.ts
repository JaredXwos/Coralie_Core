import type { SharedFlow } from '../../core/shared-flow'
import type { StateFlow } from '../../core/state-flow'

export type PeerLinkState = 'open' | 'closed'

/**
 * Wraps an already-open data channel. Constructed once a channel
 * reaches `open` — see Initiator/Answerer, which each expose a
 * `PeerLink` only after their connection reaches `Connected`.
 */
export interface PeerLink {
  readonly state: StateFlow<PeerLinkState>
  readonly incomingBytes: SharedFlow<Uint8Array>
  send(data: Uint8Array): void
  close(): void
}
