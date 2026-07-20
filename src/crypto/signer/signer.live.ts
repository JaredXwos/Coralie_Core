import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import type { NostrEvent, UnsignedNostrEvent } from '../../core/types'
import type { Signer } from './signer.interface'

/**
 * Thin wrapper over `nostr-tools/pure` and `nostr-tools/nip44`.
 *
 * Deliberately does not hand-roll any cryptographic primitive — see
 * §1 of the architecture doc ("ecosystem-aligned crypto"). Everything
 * here is a direct pass-through to the audited library so this port
 * stays byte-for-byte interoperable with other Nostr clients.
 */
export class LiveSigner implements Signer {
  private constructor(
    private readonly secretKey: Uint8Array,
    readonly pubkeyHex: string,
  ) {}

  /** Generates a fresh random identity. No persistence, no restore path. */
  static generate(): LiveSigner {
    const secretKey = generateSecretKey()
    return new LiveSigner(secretKey, getPublicKey(secretKey))
  }

  /** Builds an identity from an existing 32-byte secret key. */
  static fromSecretKey(secretKey: Uint8Array): LiveSigner {
    return new LiveSigner(secretKey, getPublicKey(secretKey))
  }

  sign(
    kind: number,
    tags: string[][],
    content: string,
    createdAt: number = Math.floor(Date.now() / 1000),
  ): NostrEvent {
    const unsigned: UnsignedNostrEvent = {
      pubkey: this.pubkeyHex,
      created_at: createdAt,
      kind,
      tags,
      content,
    }
    return finalizeEvent(unsigned, this.secretKey) as NostrEvent
  }

  verify(event: NostrEvent): boolean {
    return verifyEvent(event)
  }

  getConvoKey(theirPubkeyHex: string): Uint8Array {
    assertPubkeyHex(theirPubkeyHex)
    return nip44.v2.utils.getConversationKey(this.secretKey, theirPubkeyHex)
  }

  encryptNip44(plaintext: string, convoKey: Uint8Array): string {
    return nip44.v2.encrypt(plaintext, convoKey)
  }

  decryptNip44(payload: string, convoKey: Uint8Array): string {
    return nip44.v2.decrypt(payload, convoKey)
  }
}

const HEX_64_RE = /^[0-9a-f]{64}$/i

function assertPubkeyHex(pubkeyHex: string): void {
  if (!HEX_64_RE.test(pubkeyHex)) {
    throw new Error(`invalid pubkey hex: expected 64 hex chars, got ${JSON.stringify(pubkeyHex)}`)
  }
}
