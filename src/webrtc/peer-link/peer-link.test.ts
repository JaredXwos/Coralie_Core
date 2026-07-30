import { describe, expect, it } from 'vitest'
import { LinkState } from '../../core/types'
import { LiveAnswerer } from '../answerer'
import { LiveInitiator } from '../initiator'
import { createLinkedMockPeerConnections } from '../peer-connection'
import type { DataChannelLike } from '../peer-connection'
import { LivePeerLink } from './peer-link.live'

async function connectedPair() {
  const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
  const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
  const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

  const offer = await initiator.createOffer()
  const answer = await answerer.createAnswer(offer)
  await initiator.acceptAnswer(answer)

  return { initiator, answerer, initiatorPc, answererPc }
}

describe('LivePeerLink', () => {
  it('send() on one side is observed via incomingBytes on the other', async () => {
    const { initiator, answerer } = await connectedPair()
    const a = initiator.peerLink!
    const b = answerer.peerLink!

    const received: Uint8Array[] = []
    b.incomingBytes.subscribe((bytes) => received.push(bytes))

    const payload = new Uint8Array([1, 2, 3])
    expect(a.send(payload)).toEqual({ ok: true, value: undefined })

    expect(received).toEqual([payload])
  })

  it('works symmetrically in the other direction too', async () => {
    const { initiator, answerer } = await connectedPair()
    const a = initiator.peerLink!
    const b = answerer.peerLink!

    const received: Uint8Array[] = []
    a.incomingBytes.subscribe((bytes) => received.push(bytes))

    const payload = new Uint8Array([9, 8, 7])
    b.send(payload)

    expect(received).toEqual([payload])
  })

  it('closing one side surfaces as a state transition on that same link', async () => {
    const { initiator } = await connectedPair()
    const a = initiator.peerLink!

    expect(a.state.value).toBe('open')
    a.close()
    expect(a.state.value).toBe('closed')
  })

  it('returns failure if send() is called after close()', async () => {
    const { initiator } = await connectedPair()
    const a = initiator.peerLink!
    a.close()
    const result = a.send(new Uint8Array([1]))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toBe('cannot send on a closed PeerLink')
    }
  })

  it('returns a channel send failure instead of throwing', () => {
    const channel: DataChannelLike = {
      label: 'test',
      readyState: 'open',
      onopen: null,
      onclose: null,
      onmessage: null,
      send() {
        throw new Error('underlying send failed')
      },
      close() {},
    }
    const link = new LivePeerLink(channel)

    const result = link.send(new Uint8Array([1]))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toBe('underlying send failed')
    }
  })

  it("closing the underlying Initiator's connection closes its PeerLink", async () => {
    const { initiator } = await connectedPair()
    const a = initiator.peerLink!

    initiator.close()

    expect(a.state.value).toBe('closed')
    expect(initiator.state.value).toBe(LinkState.Closed)
  })
})
