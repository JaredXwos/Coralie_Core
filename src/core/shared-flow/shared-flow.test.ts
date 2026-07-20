import { describe, expect, it } from 'vitest'
import { createSharedFlow } from './shared-flow.live'
import { createMockSharedFlow } from './shared-flow.mock'

describe.each([
  ['LiveSharedFlow', createSharedFlow],
  ['MockSharedFlow', createMockSharedFlow],
])('%s', (_name, create) => {
  it('does not replay past emissions to a new subscriber', () => {
    const flow = create<number>()
    flow.emit(1)
    const seen: number[] = []
    flow.subscribe((v) => seen.push(v))
    flow.emit(2)
    expect(seen).toEqual([2])
  })

  it('fans out to all current subscribers', () => {
    const flow = create<string>()
    const a: string[] = []
    const b: string[] = []
    flow.subscribe((v) => a.push(v))
    flow.subscribe((v) => b.push(v))
    flow.emit('x')
    expect(a).toEqual(['x'])
    expect(b).toEqual(['x'])
  })

  it('stops delivery after unsubscribe', () => {
    const flow = create<number>()
    const seen: number[] = []
    const unsubscribe = flow.subscribe((v) => seen.push(v))
    flow.emit(1)
    unsubscribe()
    flow.emit(2)
    expect(seen).toEqual([1])
  })
})

describe('MockSharedFlow-specific inspection hooks', () => {
  it('records every emission regardless of subscribers', () => {
    const flow = createMockSharedFlow<number>()
    flow.emit(1)
    flow.emit(2)
    expect(flow.emissions).toEqual([1, 2])
  })

  it('reports listenerCount', () => {
    const flow = createMockSharedFlow<number>()
    expect(flow.listenerCount).toBe(0)
    const unsubscribe = flow.subscribe(() => {})
    expect(flow.listenerCount).toBe(1)
    unsubscribe()
    expect(flow.listenerCount).toBe(0)
  })
})
