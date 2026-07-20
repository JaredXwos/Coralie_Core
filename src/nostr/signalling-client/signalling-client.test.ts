import { describe, expect, it } from 'vitest'
import { LiveSigner } from '../../crypto/signer'
import { MockRelaySession } from '../relay-session'
import { LiveNostrSignallingClient } from './signalling-client.live'
import { SIGNALLING_KIND } from './signalling-client.interface'

function buildClient(signer: LiveSigner, sessions: MockRelaySession[]) {
  return new LiveNostrSignallingClient(signer, sessions.map((s) => s.url), {
    createRelaySession: (url) => sessions.find((s) => s.url === url)!,
  })
}

describe('LiveNostrSignallingClient', () => {
  it('encrypts an outbound message before handing it to every relay', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    const relayB = new MockRelaySession('relay-b')
    const client = buildClient(alice, [relayA, relayB])

    const result = client.send(bob.pubkeyHex, 'plaintext offer sdp')

    expect(result.ok).toBe(true)
    expect(relayA.published).toHaveLength(1)
    expect(relayB.published).toHaveLength(1)

    const publishedEvent = relayA.published[0]
    expect(publishedEvent.kind).toBe(SIGNALLING_KIND)
    expect(publishedEvent.content).not.toContain('plaintext offer sdp')
    expect(publishedEvent.tags).toContainEqual(['p', bob.pubkeyHex])

    // Bob can decrypt it independently, proving it really was NIP-44 encrypted.
    const convoKey = bob.getConvoKey(alice.pubkeyHex)
    expect(bob.decryptNip44(publishedEvent.content, convoKey)).toBe('plaintext offer sdp')
  })

  it('send() succeeds if at least one relay accepts, even if others reject', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    const relayB = new MockRelaySession('relay-b')
    relayB.failPublishes()
    const client = buildClient(alice, [relayA, relayB])

    const result = client.send(bob.pubkeyHex, 'hello')
    expect(result.ok).toBe(true)
  })

  it('send() fails if every relay rejects', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    relayA.failPublishes()
    const client = buildClient(alice, [relayA])

    const result = client.send(bob.pubkeyHex, 'hello')
    expect(result.ok).toBe(false)
  })

  it('decrypts an inbound event and surfaces it once, even delivered by two relays', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    const relayB = new MockRelaySession('relay-b')
    const client = buildClient(alice, [relayA, relayB])

    const convoKey = bob.getConvoKey(alice.pubkeyHex)
    const ciphertext = bob.encryptNip44('an answer sdp', convoKey)
    const event = bob.sign(SIGNALLING_KIND, [['p', alice.pubkeyHex]], ciphertext)

    const received: string[] = []
    client.inbound.subscribe((m) => received.push(m.payload))

    relayA.deliver(event)
    relayB.deliver(event) // same event id, arriving via a second relay

    expect(received).toEqual(['an answer sdp'])
  })

  it('reports the correct sender pubkey on an inbound message', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    const client = buildClient(alice, [relayA])

    const convoKey = bob.getConvoKey(alice.pubkeyHex)
    const ciphertext = bob.encryptNip44('hi', convoKey)
    const event = bob.sign(SIGNALLING_KIND, [['p', alice.pubkeyHex]], ciphertext)

    const received: string[] = []
    client.inbound.subscribe((m) => received.push(m.fromPubkeyHex))
    relayA.deliver(event)

    expect(received).toEqual([bob.pubkeyHex])
  })

  it('drops an event that fails to decrypt (wrong key) without throwing', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const mallory = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    const client = buildClient(alice, [relayA])

    const convoKey = bob.getConvoKey(mallory.pubkeyHex)
    const ciphertext = bob.encryptNip44('not for alice', convoKey)
    const event = bob.sign(SIGNALLING_KIND, [['p', mallory.pubkeyHex]], ciphertext)

    const received: string[] = []
    client.inbound.subscribe((m) => received.push(m.payload))

    expect(() => relayA.deliver(event)).not.toThrow()
    expect(received).toEqual([])
  })

  it('drops an event with a corrupt payload without throwing', () => {
    const alice = LiveSigner.generate()
    const bob = LiveSigner.generate()
    const relayA = new MockRelaySession('relay-a')
    const client = buildClient(alice, [relayA])

    const convoKey = bob.getConvoKey(alice.pubkeyHex)
    const goodCiphertext = bob.encryptNip44('hi', convoKey)
    const corruptEvent = bob.sign(
      SIGNALLING_KIND,
      [['p', alice.pubkeyHex]],
      goodCiphertext.slice(0, -4) + 'AAAA',
    )

    const received: string[] = []
    client.inbound.subscribe((m) => received.push(m.payload))

    expect(() => relayA.deliver(corruptEvent)).not.toThrow()
    expect(received).toEqual([])
  })

  it('myPubkeyHex matches the signer used to construct it', () => {
    const alice = LiveSigner.generate()
    const client = buildClient(alice, [])
    expect(client.myPubkeyHex).toBe(alice.pubkeyHex)
  })
})
