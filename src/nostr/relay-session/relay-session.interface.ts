import type { SharedFlow } from '../../core/shared-flow'
import type { StateFlow } from '../../core/state-flow'
import type { NostrEvent, Result } from '../../core/types'
import type { RelaySocketState } from '../relay-socket'

/**
 * Subscribe/publish semantics (NIP-01) layered on top of a raw relay
 * socket. Filters inbound events by the `#p` tag matching
 * `myPubkeyHex` — the mesh only ever cares about events addressed to
 * it, never open discovery.
 */
export interface RelaySession {
  readonly url: string
  readonly connectionState: StateFlow<RelaySocketState>
  /** Nostr events matching this session's subscription. */
  readonly events: SharedFlow<NostrEvent>
  publish(event: NostrEvent): Result<void>
  close(): void
}
