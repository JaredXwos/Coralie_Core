import { describe, expect, it } from 'vitest'
import { createStateFlow } from './state-flow.live'
import { createMockStateFlow } from './state-flow.mock'

describe.each([
  ['LiveStateFlow', createStateFlow],
  ['MockStateFlow', createMockStateFlow],
])('%s', (_name, create) => {
  it('replays the current value to a new subscriber immediately', () => {
    const flow = create(1)
    const seen: number[] = []
    flow.subscribe((v) => seen.push(v))
    expect(seen).toEqual([1])
  })

  it('notifies all subscribers on change', () => {
    const flow = create('a')
    const a: string[] = []
    const b: string[] = []
    flow.subscribe((v) => a.push(v))
    flow.subscribe((v) => b.push(v))

    flow.value = 'b'

    expect(a).toEqual(['a', 'b'])
    expect(b).toEqual(['a', 'b'])
  })

  it('stops delivery after unsubscribe', () => {
    const flow = create(0)
    const seen: number[] = []
    const unsubscribe = flow.subscribe((v) => seen.push(v))
    flow.value = 1
    unsubscribe()
    flow.value = 2
    expect(seen).toEqual([0, 1])
  })

  it('asReadOnly reflects live value without exposing a setter', () => {
    const flow = create(0)
    const readOnly = flow.asReadOnly()
    expect(readOnly.value).toBe(0)
    flow.value = 5
    expect(readOnly.value).toBe(5)
    expect('value' in readOnly).toBe(true)
  })
})

describe('MockStateFlow-specific inspection hooks', () => {
  it('records value history', () => {
    const flow = createMockStateFlow(0)
    flow.value = 1
    flow.value = 2
    expect(flow.history).toEqual([0, 1, 2])
  })

  it('reports listenerCount', () => {
    const flow = createMockStateFlow(0)
    expect(flow.listenerCount).toBe(0)
    const unsubscribe = flow.subscribe(() => {})
    expect(flow.listenerCount).toBe(1)
    unsubscribe()
    expect(flow.listenerCount).toBe(0)
  })
})
