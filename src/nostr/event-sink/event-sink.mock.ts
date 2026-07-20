import type { NostrEvent } from '../../core/types'
import type { EventSink } from './event-sink.interface'

/**
 * A minimal `EventSink` test double. By default every offered event is
 * accepted exactly once (tracked by id, no expiry) — enough to test a
 * consumer's "don't process duplicates" wiring without pulling in the
 * real sink's time-based eviction logic. Every offered event is also
 * recorded in `offered`, in order, for assertions.
 */
export class MockEventSink implements EventSink {
  /** Every event passed to `offer()`, in call order (including duplicates). */
  readonly offered: NostrEvent[] = []
  private readonly seenIds = new Set<string>()

  offer(event: NostrEvent): boolean {
    this.offered.push(event)
    if (this.seenIds.has(event.id)) return false
    this.seenIds.add(event.id)
    return true
  }

  /** Test helper: forget an id, so the next offer() of it is accepted again. */
  forget(eventId: string): void {
    this.seenIds.delete(eventId)
  }
}
