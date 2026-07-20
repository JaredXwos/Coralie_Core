import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '../../core/types'
import { LiveDedupingEventSink } from './event-sink.live'
import { MockEventSink } from './event-sink.mock'

function fakeEvent(id: string): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 0,
    kind: 20000,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
  }
}

/** Simple controllable clock for deterministic tests. */
function fakeClock(startMs = 0) {
  let current = startMs
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('LiveDedupingEventSink', () => {
  it('drops a duplicate event id arriving from a second relay', () => {
    const sink = new LiveDedupingEventSink()
    const event = fakeEvent('event-1')

    expect(sink.offer(event)).toBe(true) // first relay
    expect(sink.offer(event)).toBe(false) // second relay, same event
  })

  it('accepts a new, distinct event id', () => {
    const sink = new LiveDedupingEventSink()

    expect(sink.offer(fakeEvent('event-1'))).toBe(true)
    expect(sink.offer(fakeEvent('event-2'))).toBe(true)
  })

  it('accepts an event id again after it expires from the retention window', () => {
    const clock = fakeClock()
    const sink = new LiveDedupingEventSink({ retentionWindowMs: 1000, now: clock.now })
    const event = fakeEvent('event-1')

    expect(sink.offer(event)).toBe(true)
    expect(sink.offer(event)).toBe(false) // still within window

    clock.advance(1001)

    expect(sink.offer(event)).toBe(true) // window has passed, treated as new
  })

  it('does not expire an event id that is still within the retention window', () => {
    const clock = fakeClock()
    const sink = new LiveDedupingEventSink({ retentionWindowMs: 1000, now: clock.now })
    const event = fakeEvent('event-1')

    expect(sink.offer(event)).toBe(true)
    clock.advance(999)
    expect(sink.offer(event)).toBe(false)
  })

  it('evicts expired entries oldest-first, respecting insertion order', () => {
    const clock = fakeClock()
    const sink = new LiveDedupingEventSink({ retentionWindowMs: 100, now: clock.now })

    sink.offer(fakeEvent('old-1'))
    clock.advance(50)
    sink.offer(fakeEvent('old-2'))
    clock.advance(60) // old-1 is now 110ms old (expired), old-2 is 60ms old (live)

    sink.offer(fakeEvent('new-1')) // triggers a sweep as a side effect

    expect(sink.size).toBe(2) // old-1 evicted; old-2 and new-1 remain
    expect(sink.offer(fakeEvent('old-1'))).toBe(true) // treated as new again
    expect(sink.offer(fakeEvent('old-2'))).toBe(false) // still tracked
  })

  it('stops the eviction sweep at the first still-live entry', () => {
    const clock = fakeClock()
    const sink = new LiveDedupingEventSink({ retentionWindowMs: 100, now: clock.now })

    sink.offer(fakeEvent('a'))
    clock.advance(200) // 'a' expired
    sink.offer(fakeEvent('b')) // sweeps 'a', inserts 'b' at now=200
    clock.advance(50) // 'b' is 50ms old, still live

    sink.offer(fakeEvent('c')) // sweep should stop at 'b', not touch it

    expect(sink.size).toBe(2) // 'b' and 'c'
    expect(sink.offer(fakeEvent('b'))).toBe(false)
  })

  it('evicts the single oldest entry once maxEntries is exceeded', () => {
    const sink = new LiveDedupingEventSink({ maxEntries: 2 })

    sink.offer(fakeEvent('event-1'))
    sink.offer(fakeEvent('event-2'))
    sink.offer(fakeEvent('event-3')) // over capacity, evicts event-1

    expect(sink.size).toBe(2)
    expect(sink.offer(fakeEvent('event-1'))).toBe(true) // treated as new again
    expect(sink.offer(fakeEvent('event-3'))).toBe(false) // still tracked
  })

  it('defaults to a 5 minute retention window', () => {
    const clock = fakeClock()
    const sink = new LiveDedupingEventSink({ now: clock.now })
    const event = fakeEvent('event-1')

    sink.offer(event)
    clock.advance(5 * 60 * 1000 - 1)
    expect(sink.offer(event)).toBe(false) // just under the window

    clock.advance(2)
    expect(sink.offer(event)).toBe(true) // now past the window
  })
})

describe('MockEventSink', () => {
  it('accepts each id once, like the live sink', () => {
    const sink = new MockEventSink()
    const event = fakeEvent('event-1')
    expect(sink.offer(event)).toBe(true)
    expect(sink.offer(event)).toBe(false)
  })

  it('records every offered event, including duplicates', () => {
    const sink = new MockEventSink()
    const event = fakeEvent('event-1')
    sink.offer(event)
    sink.offer(event)
    expect(sink.offered).toEqual([event, event])
  })

  it('forget() allows an id to be re-accepted', () => {
    const sink = new MockEventSink()
    const event = fakeEvent('event-1')
    sink.offer(event)
    sink.forget('event-1')
    expect(sink.offer(event)).toBe(true)
  })
})
