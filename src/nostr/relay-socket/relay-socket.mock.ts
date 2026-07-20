import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { ok, type Result } from '../../core/types'
import { RelaySocketState, type RelaySocket } from './relay-socket.interface'

/**
 * A `RelaySocket` test double for exercising consumers (`RelaySession`,
 * `SignallingClient`) without a real or fake WebSocket underneath.
 * Tests drive it directly via `open()`/`reconnecting()`/`deliver()`
 * and inspect what was sent via `sent`.
 */
export class MockRelaySocket implements RelaySocket {
  private readonly stateFlow = createStateFlow<RelaySocketState>(RelaySocketState.Connecting)
  private readonly messagesFlow = createSharedFlow<string>()
  /** Every frame handed to `send()`, in order. */
  readonly sent: string[] = []
  closed = false
  private sendResult: Result<void> = ok(undefined)

  constructor(readonly url: string = 'wss://relay.example') {}

  get state(): StateFlow<RelaySocketState> {
    return this.stateFlow.asReadOnly()
  }

  get messages(): SharedFlow<string> {
    return this.messagesFlow.asReadOnly()
  }

  send(data: string): Result<void> {
    this.sent.push(data)
    return this.sendResult
  }

  close(): void {
    this.closed = true
    this.stateFlow.value = RelaySocketState.Closed
  }

  // --- test-only driver methods ---

  open(): void {
    this.stateFlow.value = RelaySocketState.Open
  }

  reconnecting(): void {
    this.stateFlow.value = RelaySocketState.Reconnecting
  }

  /** Configures every subsequent `send()` to report failure. */
  failSends(error: Error = new Error('mock relay rejected send')): void {
    this.sendResult = { ok: false, error }
  }

  /** Simulates an inbound raw text frame from the relay. */
  deliver(raw: string): void {
    this.messagesFlow.emit(raw)
  }
}
