import type { MutableSharedFlow, SharedFlow } from './shared-flow.interface'

/**
 * A SharedFlow test double with the same fan-out semantics as
 * {@link LiveSharedFlow}, plus an `emissions` history for assertions
 * that don't want to wire up their own subscriber.
 */
export class MockSharedFlow<T> implements MutableSharedFlow<T> {
  /** Every value ever emitted, in order. */
  readonly emissions: T[] = []
  private readonly listeners = new Set<(value: T) => void>()

  emit(value: T): void {
    this.emissions.push(value)
    for (const listener of this.listeners) listener(value)
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  asReadOnly(): SharedFlow<T> {
    return { subscribe: (listener) => this.subscribe(listener) }
  }
}

export function createMockSharedFlow<T>(): MockSharedFlow<T> {
  return new MockSharedFlow<T>()
}
