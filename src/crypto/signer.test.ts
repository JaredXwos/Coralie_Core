/**
 * Unit tests for Signer (crypto operations).
 * 
 * Phase 0: Verify that signer generation, signing, verification, and encryption work.
 */

import { describe, it, expect } from 'vitest'
import { Signer } from './signer'

describe('Signer', () => {
  describe('generate', () => {
    it('generates a fresh random pubkey each time', () => {
      const signer1 = Signer.generate()
      const signer2 = Signer.generate()

      expect(signer1.pubkeyHex).toBeDefined()
      expect(signer2.pubkeyHex).toBeDefined()
      expect(signer1.pubkeyHex).not.toBe(signer2.pubkeyHex)
      expect(signer1.pubkeyHex.length).toBe(64) // hex string of 32 bytes
    })

    it('generates valid hex pubkeys', () => {
      const signer = Signer.generate()
      expect(/^[0-9a-f]{64}$/i.test(signer.pubkeyHex)).toBe(true)
    })
  })

  describe('sign and verify', () => {
    it('signs an unsigned event', () => {
      const signer = Signer.generate()
      const unsigned = {
        pubkey: signer.pubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Hello, mesh!',
      }

      const signed = signer.sign(unsigned)

      expect(signed.id).toBeDefined()
      expect(signed.sig).toBeDefined()
      expect(signed.pubkey).toBe(signer.pubkeyHex)
    })

    it('verifies a signed event', () => {
      const signer = Signer.generate()
      const unsigned = {
        pubkey: signer.pubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Test event',
      }

      const signed = signer.sign(unsigned)
      const isValid = signer.verify(signed)

      expect(isValid).toBe(true)
    })

    it('rejects tampering with event content', () => {
      const signer = Signer.generate()
      const unsigned = {
        pubkey: signer.pubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Original',
      }

      const signed = signer.sign(unsigned)

      // nostr-tools caches verification status on a Symbol-keyed property
      // for performance. A plain object spread copies that Symbol along
      // with it, which would make tampering silently "verify" as valid.
      // Round-tripping through JSON strips it — exactly what happens when
      // an event actually crosses the wire, since Nostr is a JSON protocol.
      const tampered = JSON.parse(JSON.stringify(signed))
      tampered.content = 'Tampered'

      const isValid = signer.verify(tampered)
      expect(isValid).toBe(false)
    })
  })

  describe('ECDH and encryption', () => {
    it('derives same shared secret from both sides', () => {
      const alice = Signer.generate()
      const bob = Signer.generate()

      const aliceSharedSecret = alice.ecdh(bob.pubkeyHex)
      const bobSharedSecret = bob.ecdh(alice.pubkeyHex)

      expect(aliceSharedSecret).toEqual(bobSharedSecret)
    })

    it('encrypts and decrypts NIP-44 messages', () => {
      const alice = Signer.generate()
      const bob = Signer.generate()

      const plaintext = 'Secret message'
      const ciphertext = alice.encryptNip44(bob.pubkeyHex, plaintext)

      expect(ciphertext).not.toBe(plaintext)
      expect(ciphertext.length).toBeGreaterThan(0)

      const decrypted = bob.decryptNip44(alice.pubkeyHex, ciphertext)
      expect(decrypted).toBe(plaintext)
    })

    it('encryption is asymmetric (A→B different from B→A)', () => {
      const alice = Signer.generate()
      const bob = Signer.generate()

      const message = 'Test'
      const aliceToBob = alice.encryptNip44(bob.pubkeyHex, message)
      const bobToAlice = bob.encryptNip44(alice.pubkeyHex, message)

      // Different ciphertexts (includes random nonce)
      expect(aliceToBob).not.toBe(bobToAlice)
    })
  })

  describe('export and import', () => {
    it('roundtrips secret key hex', () => {
      const original = Signer.generate()
      const exported = original.exportSecretKeyHex()
      const restored = Signer.fromSecretKeyHex(exported)

      expect(restored.pubkeyHex).toBe(original.pubkeyHex)

      // Verify they sign identically
      const unsigned = {
        pubkey: original.pubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Test',
      }

      const sig1 = original.sign(unsigned)
      const sig2 = restored.sign(unsigned)

      // Event IDs should match (same content, same signer)
      expect(sig1.id).toBe(sig2.id)
    })

    it('rejects invalid secret key length', () => {
      expect(() => Signer.fromSecretKeyHex('00')).toThrow('Secret key must be 32 bytes')
    })
  })

  describe('static hash', () => {
    it('sha256 produces consistent hashes', () => {
      const data = new TextEncoder().encode('test data')
      const hash1 = Signer.sha256(data)
      const hash2 = Signer.sha256(data)

      expect(hash1).toEqual(hash2)
      expect(hash1.length).toBe(32)
    })

    it('sha256Hex produces hex output', () => {
      const hex = Signer.sha256Hex('0102')
      expect(/^[0-9a-f]{64}$/i.test(hex)).toBe(true)
    })
  })
})