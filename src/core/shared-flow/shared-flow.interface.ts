/**
 * SharedFlow: hot observable broadcasting events with no replay —
 * subscribers only see events emitted after they subscribed. Inspired
 * by Kotlin's `SharedFlow`.
 */
export interface SharedFlow<T> {
  subscribe(listener: (value: T) => void): () => void
}

/** A SharedFlow that can be emitted into, driving subscriber delivery. */
export interface MutableSharedFlow<T> extends SharedFlow<T> {
  emit(value: T): void
  /** Exposes this flow as a read-only view (no `.emit()`). */
  asReadOnly(): SharedFlow<T>
}
