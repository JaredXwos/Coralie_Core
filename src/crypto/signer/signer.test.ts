import { describe, expect, it } from 'vitest'
import { LiveSigner } from './signer.live'
import { MockSigner } from './signer.mock'
import type { Signer } from './signer.interface'

const implementations: Array<[string, () => Signer, () => Signer]> = [
  ['LiveSigner', () => LiveSigner.generate(), () => LiveSigner.generate()],
  ['MockSigner', () => MockSigner.fromSeed('alice'), () => MockSigner.fromSeed('bob')],
]

describe.each(implementations)('%s', (_name, makeA, makeB) => {
  it('produces a valid pubkey', () => {
    const signer = makeA()
    expect(signer.pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sign() produces an event that verifies', () => {
    const signer = makeA()
    const event = signer.sign(20000, [['p', 'somepeer']], 'hello', 1_700_000_000)

    expect(event.pubkey).toBe(signer.pubkeyHex)
    expect(event.kind).toBe(20000)
    expect(event.content).toBe('hello')
    expect(signer.verify(event)).toBe(true)
  })

  it('rejects a tampered event on verify', () => {
    const signer = makeA()
    const event = signer.sign(20000, [], 'hello')
    // Built field-by-field (not via `{ ...event }`) so we don't also
    // copy nostr-tools' internal cached-verification symbol, which
    // would short-circuit re-verification of the tampered copy.
    const tampered = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: 'goodbye',
      sig: event.sig,
    }
    expect(signer.verify(tampered)).toBe(false)
  })

  it('getConvoKey() is symmetric between two signers', () => {
    const a = makeA()
    const b = makeB()

    const convoA = a.getConvoKey(b.pubkeyHex)
    const convoB = b.getConvoKey(a.pubkeyHex)

    expect(Buffer.from(convoA).equals(Buffer.from(convoB))).toBe(true)
  })

  it('getConvoKey() is stable across calls with the same inputs', () => {
    const a = makeA()
    const b = makeB()

    const first = a.getConvoKey(b.pubkeyHex)
    const second = a.getConvoKey(b.pubkeyHex)

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('throws on a malformed pubkey (wrong length)', () => {
    const a = makeA()
    expect(() => a.getConvoKey('deadbeef')).toThrow()
  })

  it('throws on a malformed pubkey (non-hex)', () => {
    const a = makeA()
    expect(() => a.getConvoKey('z'.repeat(64))).toThrow()
  })

  it('encryptNip44/decryptNip44 round-trip via a shared conversation key', () => {
    const a = makeA()
    const b = makeB()
    const convoA = a.getConvoKey(b.pubkeyHex)
    const convoB = b.getConvoKey(a.pubkeyHex)

    const ciphertext = a.encryptNip44('a secret offer payload', convoA)
    const plaintext = b.decryptNip44(ciphertext, convoB)

    expect(plaintext).toBe('a secret offer payload')
  })

  it('two distinct identities produce distinct pubkeys', () => {
    const a = makeA()
    const b = makeB()
    expect(a.pubkeyHex).not.toBe(b.pubkeyHex)
  })
})

describe('MockSigner-specific determinism', () => {
  it('the same seed always produces the same identity', () => {
    const a1 = MockSigner.fromSeed('alice')
    const a2 = MockSigner.fromSeed('alice')
    expect(a1.pubkeyHex).toBe(a2.pubkeyHex)
  })

  it('different seeds produce different identities', () => {
    const a = MockSigner.fromSeed('alice')
    const b = MockSigner.fromSeed('bob')
    expect(a.pubkeyHex).not.toBe(b.pubkeyHex)
  })
})
