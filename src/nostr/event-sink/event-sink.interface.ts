import type { NostrEvent } from '../../core/types'

/**
 * Fan-in point for de-duplicating Nostr events arriving from multiple
 * relays. Named to match the Kotlin reference's `EventSink`.
 */
export interface EventSink {
  /**
   * Offer an event to the sink.
   *
   * @returns `true` if this is the first time this event id has been
   *   seen within the current retention window (i.e. it should be
   *   forwarded downstream); `false` if it's a duplicate and should be
   *   dropped.
   */
  offer(event: NostrEvent): boolean
}
