import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkState } from '../../core/types'
import { LiveAnswerer } from '../answerer'
import { createLinkedMockPeerConnections } from '../peer-connection'
import { LiveInitiator } from './initiator.live'

describe('LiveInitiator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reaches Connected when paired directly with an Answerer', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    const states: LinkState[] = []
    initiator.state.subscribe((s) => states.push(s))

    const offer = await initiator.createOffer()
    const answer = await answerer.createAnswer(offer)
    await initiator.acceptAnswer(answer)

    expect(initiator.state.value).toBe(LinkState.Connected)
    expect(answerer.state.value).toBe(LinkState.Connected)
    expect(states).toEqual([
      LinkState.Initiating,
      LinkState.Offering,
      LinkState.Connecting,
      LinkState.Connected,
    ])
  })

  it('exposes a working PeerLink once Connected', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    const offer = await initiator.createOffer()
    const answer = await answerer.createAnswer(offer)
    await initiator.acceptAnswer(answer)

    expect(initiator.peerLink).not.toBeNull()
    expect(answerer.peerLink).not.toBeNull()
  })

  it('times out and transitions to Failed when no answer ever arrives', async () => {
    const [initiatorPc] = createLinkedMockPeerConnections() // remote never answers
    const initiator = new LiveInitiator({
      peerConnectionFactory: () => initiatorPc,
      handshakeTimeoutMs: 30_000,
    })

    await initiator.createOffer()
    expect(initiator.state.value).toBe(LinkState.Connecting)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(initiator.state.value).toBe(LinkState.Failed)
  })

  it('does not time out if Connected is reached before the deadline', async () => {
    const [initiatorPc, answererPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc, handshakeTimeoutMs: 30_000 })
    const answerer = new LiveAnswerer({ peerConnectionFactory: () => answererPc })

    const offer = await initiator.createOffer()
    const answer = await answerer.createAnswer(offer)
    await initiator.acceptAnswer(answer)
    expect(initiator.state.value).toBe(LinkState.Connected)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(initiator.state.value).toBe(LinkState.Connected) // unaffected by the now-cleared timer
  })

  it('transitions to Failed if the underlying connection reports failed', async () => {
    const [initiatorPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })

    await initiator.createOffer()
    initiatorPc.simulateFailure()

    expect(initiator.state.value).toBe(LinkState.Failed)
  })

  it('ignores a late acceptAnswer() once already superseded (not Connecting)', async () => {
    const [initiatorPc] = createLinkedMockPeerConnections()
    const initiator = new LiveInitiator({ peerConnectionFactory: () => initiatorPc })

    await initiator.createOffer()
    initiator.close() // superseded before any answer arrives

    await expect(initiator.acceptAnswer({ type: 'answer', sdp: 'stale' })).resolves.toBeUndefined()
    expect(initiator.state.value).toBe(LinkState.Closed)
  })
})
