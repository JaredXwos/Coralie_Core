import { describe, expect, it } from 'vitest'
import { LinkState } from '../../core/types'
import { createLinkedMockPeerConnections } from '../peer-connection'
import { LiveInitiator } from '../initiator'
import { LiveAnswerer } from './answerer.live'

describe('LiveAnswerer', () => {
  it('starts in Answering and moves to Connecting once createAnswer() is called', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    expect(answerer.state.value).toBe(LinkState.Answering)

    const offer = await initiator.createOffer()
    await answerer.createAnswer(offer)

    expect(answerer.state.value).toBe(LinkState.Connecting)
  })

  it('transitions to Failed if the underlying connection reports failed', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    const offer = await initiator.createOffer()
    await answerer.createAnswer(offer)
    answererPc.simulateFailure()

    expect(answerer.state.value).toBe(LinkState.Failed)
  })

  it('has no handshake timeout — remains Connecting indefinitely if never completed', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    const offer = await initiator.createOffer()
    await answerer.createAnswer(offer)
    // Deliberately never call initiator.acceptAnswer() — the answerer
    // has no timer of its own, so it should simply stay Connecting.
    expect(answerer.state.value).toBe(LinkState.Connecting)
  })

  it('close() tears down and transitions to Closed', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    const offer = await initiator.createOffer()
    await answerer.createAnswer(offer)

    answerer.close()
    expect(answerer.state.value).toBe(LinkState.Closed)
    expect(answererPc.connectionState).toBe('closed')
  })
})
