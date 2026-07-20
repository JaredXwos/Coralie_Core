import type { NostrEvent } from '../core/types'

/**
 * Options for {@link DedupingEventSink}.
 */
export interface DedupingEventSinkOptions {
  /**
   * How long a seen event id is remembered before it's eligible to be
   * accepted again. Default: 5 minutes.
   */
  retentionWindowMs?: number
  /**
   * Hard cap on how many event ids are tracked at once, independent of
   * age. Once exceeded, the oldest-inserted id is evicted regardless of
   * whether it has expired yet. Default: 10,000.
   */
  maxEntries?: number
  /**
   * Clock injection point for deterministic tests. Defaults to
   * `Date.now`. Must be non-decreasing across calls — the eviction
   * sweep relies on insertion order approximating arrival-time order.
   */
  now?: () => number
}

const DEFAULT_RETENTION_WINDOW_MS = 5 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 10_000

/**
 * De-duplicates Nostr events by id across multiple relays.
 *
 * A small out-of-band mesh subscribes to several relays for redundancy,
 * so the same event routinely arrives more than once (once per relay
 * that relayed it, plus possible re-delivery on reconnect/re-`REQ`).
 * `DedupingEventSink` is the single fan-in point every relay consumer
 * calls into: `offer()` returns `true` exactly once per distinct event
 * id, and `false` for every subsequent duplicate, so downstream
 * decrypt/verify/forward logic only ever sees an event once.
 *
 * Entries are tracked in a `Map`, which preserves insertion order in
 * JS — this doubles as the arrival-time order needed for eviction, the
 * same trick the Kotlin reference gets from `LinkedHashMap`. Eviction
 * happens two ways:
 *   - age-based: entries older than `retentionWindowMs` are swept out
 *     at the start of every `offer()` call (oldest-first, stopping at
 *     the first still-live entry).
 *   - size-based: if `maxEntries` is exceeded after inserting a new id,
 *     the single oldest entry is evicted, regardless of its age.
 *
 * Everything here is synchronous — there is no `await` between reading
 * and mutating `seenAt`, so JS's single-threaded execution already
 * guarantees no interleaving. No identity-check-after-await discipline
 * is needed for this class specifically (unlike the orchestrator in
 * §4), because it never yields mid-operation.
 */
export class DedupingEventSink {
  private readonly retentionWindowMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly seenAt = new Map<string, number>()

  constructor(options: DedupingEventSinkOptions = {}) {
    this.retentionWindowMs = options.retentionWindowMs ?? DEFAULT_RETENTION_WINDOW_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.now = options.now ?? Date.now
  }

  /**
   * Offer an event to the sink.
   *
   * @returns `true` if this is the first time this event id has been
   *   seen within the current retention window (i.e. it should be
   *   forwarded downstream); `false` if it's a duplicate and should be
   *   dropped.
   */
  offer(event: NostrEvent): boolean {
    const now = this.now()
    this.evictExpired(now)

    if (this.seenAt.has(event.id)) {
      return false
    }

    this.seenAt.set(event.id, now)
    this.evictOverCapacity()
    return true
  }

  /** Number of event ids currently tracked. Exposed for tests/inspection. */
  get size(): number {
    return this.seenAt.size
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.retentionWindowMs
    for (const [id, seenAt] of this.seenAt) {
      if (seenAt <= cutoff) {
        this.seenAt.delete(id)
      } else {
        // Map iteration is insertion order; once we hit a live entry,
        // every entry after it is at least as new, so stop the sweep.
        break
      }
    }
  }

  private evictOverCapacity(): void {
    while (this.seenAt.size > this.maxEntries) {
      const oldestId = this.seenAt.keys().next().value
      if (oldestId === undefined) break
      this.seenAt.delete(oldestId)
    }
  }
}
