/**
 * Cryptographic signer wrapping nostr-tools.
 * 
 * Handles key generation, signing, ECDH, and NIP-44 encryption.
 */

import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  nip44,
} from 'nostr-tools'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import type { NostrEvent, UnsignedNostrEvent } from '../types'

/**
 * Signer: creates and manages a Nostr identity.
 */
export class Signer {
  private secretKey: Uint8Array
  readonly pubkeyHex: string

  private constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey
    this.pubkeyHex = getPublicKey(secretKey)
  }

  /**
   * Generate a fresh random Nostr identity.
   */
  static generate(): Signer {
    const secretKey = generateSecretKey()
    return new Signer(secretKey)
  }

  /**
   * Restore from secret key hex.
   */
  static fromSecretKeyHex(secretKeyHex: string): Signer {
    const secretKey = hexToBytes(secretKeyHex)
    if (secretKey.length !== 32) {
      throw new Error('Secret key must be 32 bytes')
    }
    return new Signer(secretKey)
  }

  /**
   * Export secret key as hex (for persistence if needed).
   * Use with caution — this is the root credential.
   */
  exportSecretKeyHex(): string {
    return bytesToHex(this.secretKey)
  }

  /**
   * Sign a Nostr event, returning the finalized event with id and sig.
   */
  sign(event: UnsignedNostrEvent): NostrEvent {
    return finalizeEvent(event, this.secretKey) as NostrEvent
  }

  /**
   * Verify a Nostr event's signature.
   */
  verify(event: NostrEvent): boolean {
    return verifyEvent(event)
  }

  /**
   * ECDH: shared secret between this key and another public key.
   * Used for establishing encryption keys.
   */
  ecdh(theirPubkeyHex: string): Uint8Array {
    return nip44.v2.utils.getConversationKey(this.secretKey, theirPubkeyHex)
  }

  /**
   * NIP-44 v2 encrypt: encrypt plaintext to a recipient.
   */
  encryptNip44(theirPubkeyHex: string, plaintext: string): string {
    return nip44.v2.encrypt(plaintext, this.ecdh(theirPubkeyHex))
  }

  /**
   * NIP-44 v2 decrypt: decrypt ciphertext from a sender.
   */
  decryptNip44(theirPubkeyHex: string, ciphertext: string): string {
    return nip44.v2.decrypt(ciphertext, this.ecdh(theirPubkeyHex))
  }

  /**
   * Hash data using SHA-256.
   */
  static sha256(data: Uint8Array): Uint8Array {
    return sha256(data)
  }

  /**
   * Hash hex string to hex.
   */
  static sha256Hex(hex: string): string {
    return bytesToHex(sha256(hexToBytes(hex)))
  }
}
