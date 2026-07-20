/**
 * Pub/sub primitives inspired by Kotlin Flow.
 * 
 * StateFlow: hot observable holding latest value, emits to all subscribers.
 * SharedFlow: hot observable broadcasting events, subscribers see only future events.
 * 
 * Phase 0 placeholder — to be implemented with full async iteration support.
 */

/**
 * A StateFlow holds the latest value and notifies subscribers of changes.
 * 
 * Similar to Kotlin's StateFlow or RxJS's BehaviorSubject.
 */
export interface StateFlow<T> {
  readonly value: T
  subscribe(listener: (value: T) => void): () => void
  asReadOnly(): StateFlow<T>
}

/**
 * A SharedFlow broadcasts events to all current subscribers.
 * 
 * New subscribers only see events emitted after subscription.
 * Similar to Kotlin's SharedFlow or RxJS's Subject.
 */
export interface SharedFlow<T> {
  subscribe(listener: (value: T) => void): () => void
  asReadOnly(): SharedFlow<T>
}

/**
 * Create a StateFlow with an initial value.
 */
export function createStateFlow<T>(initialValue: T): StateFlow<T> & { emit(value: T): void } {
  let value = initialValue
  const listeners = new Set<(value: T) => void>()

  return {
    get value() {
      return value
    },
    emit(newValue: T) {
      value = newValue
      listeners.forEach(listener => listener(newValue))
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    asReadOnly(): StateFlow<T> {
      return {
        get value() {
          return value
        },
        subscribe: (listener) => this.subscribe(listener),
        asReadOnly() { return this }
      }
    }
  }
}

/**
 * Create a SharedFlow for broadcasting events.
 */
export function createSharedFlow<T>(): SharedFlow<T> & { emit(value: T): void } {
  const listeners = new Set<(value: T) => void>()

  return {
    emit(value: T) {
      listeners.forEach(listener => listener(value))
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    asReadOnly(): SharedFlow<T> {
      return {
        subscribe: (listener) => this.subscribe(listener),
        asReadOnly() { return this }
      }
    }
  }
}
