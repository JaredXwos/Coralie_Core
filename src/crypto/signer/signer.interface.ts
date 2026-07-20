import type { NostrEvent } from '../../core/types'

/**
 * Identity + signing/encryption operations needed by the Nostr and
 * WebRTC layers. Deliberately thin — every method is a pass-through to
 * an audited library implementation (see `signer.live.ts`), never a
 * hand-rolled primitive (§1: "ecosystem-aligned crypto").
 */
export interface Signer {
  readonly pubkeyHex: string

  /** Builds and signs an event with this identity's key. */
  sign(kind: number, tags: string[][], content: string, createdAt?: number): NostrEvent

  /** Validates an event's id hash and signature. */
  verify(event: NostrEvent): boolean

  /**
   * Derives the shared NIP-44 conversation key with another pubkey.
   * Symmetric: `A.getConvoKey(B.pubkeyHex) === B.getConvoKey(A.pubkeyHex)`.
   */
  getConvoKey(theirPubkeyHex: string): Uint8Array

  /** NIP-44 v2 encrypt, given a conversation key from {@link getConvoKey}. */
  encryptNip44(plaintext: string, convoKey: Uint8Array): string

  /** NIP-44 v2 decrypt, given a conversation key from {@link getConvoKey}. */
  decryptNip44(payload: string, convoKey: Uint8Array): string
}
