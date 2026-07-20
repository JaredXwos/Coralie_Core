import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey } from 'nostr-tools/pure'
import { LiveSigner } from './signer.live'
import type { Signer } from './signer.interface'

/**
 * A `Signer` test double with deterministic key material.
 *
 * This is not fake crypto — signing, verification, and NIP-44 still
 * run through the real `nostr-tools` implementation via delegation to
 * {@link LiveSigner} (a signer that lies about signature validity
 * would make every consumer's decrypt/verify test meaningless). What's
 * "mocked" is only the source of randomness: `MockSigner.fromSeed()`
 * derives a 32-byte secret key deterministically from a string, so
 * tests get a stable, reproducible pubkey instead of a fresh random
 * one on every run.
 */
export class MockSigner implements Signer {
  private readonly live: LiveSigner

  private constructor(live: LiveSigner) {
    this.live = live
  }

  /** Deterministic identity derived from `seed` (sha256(seed) as the secret key). */
  static fromSeed(seed: string): MockSigner {
    const secretKey = sha256(new TextEncoder().encode(seed))
    return new MockSigner(LiveSigner.fromSecretKey(secretKey))
  }

  get pubkeyHex(): string {
    return this.live.pubkeyHex
  }

  sign(kind: number, tags: string[][], content: string, createdAt?: number) {
    return this.live.sign(kind, tags, content, createdAt)
  }

  verify(event: Parameters<Signer['verify']>[0]): boolean {
    return this.live.verify(event)
  }

  getConvoKey(theirPubkeyHex: string): Uint8Array {
    return this.live.getConvoKey(theirPubkeyHex)
  }

  encryptNip44(plaintext: string, convoKey: Uint8Array): string {
    return this.live.encryptNip44(plaintext, convoKey)
  }

  decryptNip44(payload: string, convoKey: Uint8Array): string {
    return this.live.decryptNip44(payload, convoKey)
  }
}

// Re-exported only so consumers can sanity-check a seed's resulting
// pubkey without constructing a full MockSigner, if ever needed.
export function pubkeyForSeed(seed: string): string {
  const secretKey = sha256(new TextEncoder().encode(seed))
  return getPublicKey(secretKey)
}
