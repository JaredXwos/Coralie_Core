import type { MutableSharedFlow, SharedFlow } from './shared-flow.interface'

export class LiveSharedFlow<T> implements MutableSharedFlow<T> {
  private readonly listeners = new Set<(value: T) => void>()

  emit(value: T): void {
    for (const listener of this.listeners) listener(value)
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  asReadOnly(): SharedFlow<T> {
    return { subscribe: (listener) => this.subscribe(listener) }
  }
}

export function createSharedFlow<T>(): LiveSharedFlow<T> {
  return new LiveSharedFlow<T>()
}
