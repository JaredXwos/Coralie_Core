import type { SharedFlow } from '../../core/shared-flow'
import type { Result } from '../../core/types'

/** Ephemeral Nostr event kind used for handshake signalling traffic. */
export const SIGNALLING_KIND = 28080

/** A decrypted inbound signalling payload, addressed to this identity. */
export interface SignallingMessage {
  fromPubkeyHex: string
  payload: string
}

export interface SignallingClient {
  readonly myPubkeyHex: string
  readonly inbound: SharedFlow<SignallingMessage>
  /**
   * Encrypts `payload` for `toPubkeyHex` and fans it out to every
   * configured relay. Best-effort, like rule 5's Announce broadcast —
   * returns success if at least one relay accepted the send.
   */
  send(toPubkeyHex: string, payload: string): Result<void>
  close(): void
}
