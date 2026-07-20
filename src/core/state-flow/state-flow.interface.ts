/**
 * StateFlow: hot observable holding latest value, replays it to new
 * subscribers, then emits every subsequent change. Inspired by
 * Kotlin's `StateFlow`.
 */
export interface StateFlow<T> {
  readonly value: T
  subscribe(listener: (value: T) => void): () => void
}

/** A StateFlow whose value can be set, driving notifications. */
export interface MutableStateFlow<T> extends StateFlow<T> {
  value: T
  /** Exposes this flow as a read-only view (no `.value` setter). */
  asReadOnly(): StateFlow<T>
}
