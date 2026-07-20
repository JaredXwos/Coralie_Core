import type { MutableStateFlow, StateFlow } from './state-flow.interface'

export class LiveStateFlow<T> implements MutableStateFlow<T> {
  private current: T
  private readonly listeners = new Set<(value: T) => void>()

  constructor(initial: T) {
    this.current = initial
  }

  get value(): T {
    return this.current
  }

  set value(next: T) {
    this.current = next
    for (const listener of this.listeners) listener(this.current)
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    listener(this.current) // StateFlow-like: replay current value immediately
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

export function createStateFlow<T>(initial: T): LiveStateFlow<T> {
  return new LiveStateFlow(initial)
}
