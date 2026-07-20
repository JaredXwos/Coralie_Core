import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '../../core/types'
import { MockRelaySocket } from '../relay-socket'
import { LiveRelaySession } from './relay-session.live'

function fakeEvent(id: string, overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 0,
    kind: 25050,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
    ...overrides,
  }
}

describe('LiveRelaySession', () => {
  it('sends a REQ filtered by #p = myPubkeyHex when the socket opens', () => {
    const socket = new MockRelaySocket()
    const myPubkey = 'c'.repeat(64)
    new LiveRelaySession(socket, myPubkey)

    socket.open()

    expect(socket.sent).toHaveLength(1)
    const [type, subId, filter] = JSON.parse(socket.sent[0])
    expect(type).toBe('REQ')
    expect(typeof subId).toBe('string')
    expect(filter['#p']).toEqual([myPubkey])
  })

  it('re-sends the subscription after a reconnect (socket re-opens)', () => {
    const socket = new MockRelaySocket()
    new LiveRelaySession(socket, 'c'.repeat(64))

    socket.open()
    expect(socket.sent).toHaveLength(1)

    socket.reconnecting()
    socket.open()

    expect(socket.sent.length).toBeGreaterThanOrEqual(2)
  })

  it('emits inbound EVENT frames matching the subscription id', () => {
    const socket = new MockRelaySocket()
    const session = new LiveRelaySession(socket, 'c'.repeat(64))
    socket.open()

    const received: NostrEvent[] = []
    session.events.subscribe((e) => received.push(e))

    const subId = JSON.parse(socket.sent[0])[1]
    const event = fakeEvent('event-1')
    socket.deliver(JSON.stringify(['EVENT', subId, event]))

    expect(received).toEqual([event])
  })

  it('ignores EVENT frames for a different subscription id', () => {
    const socket = new MockRelaySocket()
    const session = new LiveRelaySession(socket, 'c'.repeat(64))
    socket.open()

    const received: NostrEvent[] = []
    session.events.subscribe((e) => received.push(e))

    socket.deliver(JSON.stringify(['EVENT', 'some-other-sub', fakeEvent('event-1')]))

    expect(received).toEqual([])
  })

  it('drops malformed frames without throwing', () => {
    const socket = new MockRelaySocket()
    const session = new LiveRelaySession(socket, 'c'.repeat(64))
    socket.open()

    const received: NostrEvent[] = []
    session.events.subscribe((e) => received.push(e))

    expect(() => socket.deliver('not json')).not.toThrow()
    expect(() => socket.deliver('{}')).not.toThrow() // valid JSON, not an array
    expect(() => socket.deliver('[]')).not.toThrow() // empty array
    expect(received).toEqual([])
  })

  it('ignores non-EVENT frame types (EOSE, NOTICE, OK)', () => {
    const socket = new MockRelaySocket()
    const session = new LiveRelaySession(socket, 'c'.repeat(64))
    socket.open()
    const subId = JSON.parse(socket.sent[0])[1]

    const received: NostrEvent[] = []
    session.events.subscribe((e) => received.push(e))

    socket.deliver(JSON.stringify(['EOSE', subId]))
    socket.deliver(JSON.stringify(['NOTICE', 'hello']))
    socket.deliver(JSON.stringify(['OK', 'event-1', true, '']))

    expect(received).toEqual([])
  })

  it('publish() wraps the event in an ["EVENT", event] frame', () => {
    const socket = new MockRelaySocket()
    const session = new LiveRelaySession(socket, 'c'.repeat(64))
    socket.open()
    socket.sent.length = 0 // clear the REQ frame

    const event = fakeEvent('event-1')
    const result = session.publish(event)

    expect(result.ok).toBe(true)
    expect(JSON.parse(socket.sent[0])).toEqual(['EVENT', event])
  })

  it('close() closes the underlying socket', () => {
    const socket = new MockRelaySocket()
    const session = new LiveRelaySession(socket, 'c'.repeat(64))
    session.close()
    expect(socket.closed).toBe(true)
  })

  it('filters by kinds when provided', () => {
    const socket = new MockRelaySocket()
    new LiveRelaySession(socket, 'c'.repeat(64), [25050])
    socket.open()

    const filter = JSON.parse(socket.sent[0])[2]
    expect(filter.kinds).toEqual([25050])
  })
})
