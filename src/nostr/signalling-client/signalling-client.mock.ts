import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { ok, type Result } from '../../core/types'
import type { SignallingClient, SignallingMessage } from './signalling-client.interface'

/**
 * A `SignallingClient` test double. `send()` just records what was
 * sent (no real encryption/relay fan-out); tests drive inbound
 * traffic directly via `deliver()`.
 */
export class MockSignallingClient implements SignallingClient {
  private readonly inboundFlow = createSharedFlow<SignallingMessage>()
  /** Every `send()` call, in order. */
  readonly sent: Array<{ toPubkeyHex: string; payload: string }> = []
  private sendResult: Result<void> = ok(undefined)

  constructor(readonly myPubkeyHex: string) {}

  get inbound(): SharedFlow<SignallingMessage> {
    return this.inboundFlow.asReadOnly()
  }

  send(toPubkeyHex: string, payload: string): Result<void> {
    this.sent.push({ toPubkeyHex, payload })
    return this.sendResult
  }

  close(): void {}

  // --- test-only driver methods ---

  /** Configures every subsequent `send()` to report failure. */
  failSends(error: Error = new Error('mock signalling client rejected send')): void {
    this.sendResult = { ok: false, error }
  }

  /** Simulates a decrypted inbound message arriving from `fromPubkeyHex`. */
  deliver(fromPubkeyHex: string, payload: string): void {
    this.inboundFlow.emit({ fromPubkeyHex, payload })
  }
}
