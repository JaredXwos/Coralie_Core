import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { createStateFlow, type StateFlow } from '../../core/state-flow'
import type { PeerLink, PeerLinkState } from './peer-link.interface'
import type { Result } from '../../core/types'
import { err, ok } from '../../core/types'

/**
 * A `PeerLink` test double for exercising consumers (e.g. the future
 * orchestrator) without a real or mock data channel underneath. Tests
 * inspect `sent` and drive inbound bytes via `simulateIncoming()`.
 */
export class MockPeerLink implements PeerLink {
  private readonly stateFlow = createStateFlow<PeerLinkState>('open')
  private readonly incomingBytesFlow = createSharedFlow<Uint8Array>()
  /** Every payload handed to `send()`, in order. */
  readonly sent: Uint8Array[] = []

  get state(): StateFlow<PeerLinkState> {
    return this.stateFlow.asReadOnly()
  }

  get incomingBytes(): SharedFlow<Uint8Array> {
    return this.incomingBytesFlow.asReadOnly()
  }

  send(data: Uint8Array): Result<void> {
    if (this.stateFlow.value !== 'open') {
      return err(new Error('cannot send on a closed PeerLink'))
    }
    this.sent.push(data)
    return ok(undefined)
  }

  close(): void {
    this.stateFlow.value = 'closed'
  }

  // --- test-only driver methods ---

  /** Simulates bytes arriving from the remote peer. */
  simulateIncoming(data: Uint8Array): void {
    this.incomingBytesFlow.emit(data)
  }
}
