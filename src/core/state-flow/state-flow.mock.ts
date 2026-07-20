import type { MutableStateFlow, StateFlow } from './state-flow.interface'

/**
 * A StateFlow test double with the same replay/notify semantics as
 * {@link LiveStateFlow}, plus extra inspection hooks (`history`,
 * `listenerCount`) useful for asserting on subscriber behavior in
 * tests without reaching into private fields of a real flow.
 */
export class MockStateFlow<T> implements MutableStateFlow<T> {
  private current: T
  /** Every value this flow has held, in order, including the initial one. */
  readonly history: T[]
  private readonly listeners = new Set<(value: T) => void>()

  constructor(initial: T) {
    this.current = initial
    this.history = [initial]
  }

  get value(): T {
    return this.current
  }

  set value(next: T) {
    this.current = next
    this.history.push(next)
    for (const listener of this.listeners) listener(this.current)
  }

  /** Number of currently-active subscribers. */
  get listenerCount(): number {
    return this.listeners.size
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => this.listeners.delete(listener)
  }

  asReadOnly(): StateFlow<T> {
    const self = this
    return {
      get value(): T {
        return self.value
      },
      subscribe: (listener: (value: T) => void) => self.subscribe(listener),
    }
  }
}

export function createMockStateFlow<T>(initial: T): MockStateFlow<T> {
  return new MockStateFlow(initial)
}
