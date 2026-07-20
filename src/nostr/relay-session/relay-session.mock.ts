import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { ok, type NostrEvent, type Result } from '../../core/types'
import { RelaySocketState } from '../relay-socket'
import type { RelaySession } from './relay-session.interface'

/**
 * A `RelaySession` test double for exercising consumers
 * (`SignallingClient`) without a real socket underneath. Tests inspect
 * `published` and drive inbound traffic via `deliver()`.
 */
export class MockRelaySession implements RelaySession {
  private readonly stateFlow = createStateFlow<RelaySocketState>(RelaySocketState.Open)
  private readonly eventsFlow = createSharedFlow<NostrEvent>()
  /** Every event handed to `publish()`, in order. */
  readonly published: NostrEvent[] = []
  private publishResult: Result<void> = ok(undefined)

  constructor(readonly url: string = 'wss://relay.example') {}

  get connectionState(): StateFlow<RelaySocketState> {
    return this.stateFlow.asReadOnly()
  }

  get events(): SharedFlow<NostrEvent> {
    return this.eventsFlow.asReadOnly()
  }

  publish(event: NostrEvent): Result<void> {
    this.published.push(event)
    return this.publishResult
  }

  close(): void {
    this.stateFlow.value = RelaySocketState.Closed
  }

  // --- test-only driver methods ---

  /** Configures every subsequent `publish()` to report failure. */
  failPublishes(error: Error = new Error('mock relay rejected publish')): void {
    this.publishResult = { ok: false, error }
  }

  /** Simulates an inbound event delivered by this relay. */
  deliver(event: NostrEvent): void {
    this.eventsFlow.emit(event)
  }
}
