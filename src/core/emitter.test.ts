/**
 * Unit tests for pub/sub emitters (StateFlow, SharedFlow).
 * 
 * Phase 0: Verify that state and event flows work correctly.
 */

import { describe, it, expect } from 'vitest'
import { createStateFlow, createSharedFlow } from './emitter'

describe('StateFlow', () => {
  it('holds and exposes initial value', () => {
    const flow = createStateFlow(42)
    expect(flow.value).toBe(42)
  })

  it('notifies subscribers on value change', () => {
    const flow = createStateFlow(0)
    const values: number[] = []

    flow.subscribe(v => values.push(v))
    flow.emit(1)
    flow.emit(2)

    expect(values).toEqual([1, 2])
  })

  it('multiple subscribers all receive updates', () => {
    const flow = createStateFlow('start')
    const sub1: string[] = []
    const sub2: string[] = []

    flow.subscribe(v => sub1.push(v))
    flow.subscribe(v => sub2.push(v))

    flow.emit('next')

    expect(sub1).toEqual(['next'])
    expect(sub2).toEqual(['next'])
  })

  it('unsubscribe stops notifications', () => {
    const flow = createStateFlow(0)
    const values: number[] = []

    const unsubscribe = flow.subscribe(v => values.push(v))
    flow.emit(1)
    unsubscribe()
    flow.emit(2)

    expect(values).toEqual([1])
  })

  it('latest value is always accessible', () => {
    const flow = createStateFlow(0)

    flow.emit(5)
    expect(flow.value).toBe(5)

    flow.emit(10)
    expect(flow.value).toBe(10)
  })

  it('asReadOnly returns a read-only view', () => {
    const flow = createStateFlow(0)
    const readOnly = flow.asReadOnly()

    flow.emit(5)
    expect(readOnly.value).toBe(5)

    // Read-only view has no emit method
    expect(typeof (readOnly as any).emit).not.toBe('function')
  })

  it('read-only view subscriptions still work', () => {
    const flow = createStateFlow(0)
    const readOnly = flow.asReadOnly()
    const values: number[] = []

    readOnly.subscribe(v => values.push(v))
    flow.emit(1)
    flow.emit(2)

    expect(values).toEqual([1, 2])
  })
})

describe('SharedFlow', () => {
  it('notifies subscribers of emitted events', () => {
    const flow = createSharedFlow<number>()
    const values: number[] = []

    flow.subscribe(v => values.push(v))
    flow.emit(1)
    flow.emit(2)

    expect(values).toEqual([1, 2])
  })

  it('new subscribers only see future events', () => {
    const flow = createSharedFlow<number>()
    const values1: number[] = []
    const values2: number[] = []

    flow.subscribe(v => values1.push(v))
    flow.emit(1)

    // Second subscriber joins after first event
    flow.subscribe(v => values2.push(v))
    flow.emit(2)

    expect(values1).toEqual([1, 2])
    expect(values2).toEqual([2])
  })

  it('multiple subscribers all receive the same event', () => {
    const flow = createSharedFlow<string>()
    const sub1: string[] = []
    const sub2: string[] = []

    flow.subscribe(v => sub1.push(v))
    flow.subscribe(v => sub2.push(v))

    flow.emit('event')

    expect(sub1).toEqual(['event'])
    expect(sub2).toEqual(['event'])
  })

  it('unsubscribe stops notifications', () => {
    const flow = createSharedFlow<number>()
    const values: number[] = []

    const unsubscribe = flow.subscribe(v => values.push(v))
    flow.emit(1)
    unsubscribe()
    flow.emit(2)

    expect(values).toEqual([1])
  })

  it('asReadOnly returns a read-only view', () => {
    const flow = createSharedFlow<number>()
    const readOnly = flow.asReadOnly()
    const values: number[] = []

    readOnly.subscribe(v => values.push(v))
    flow.emit(1)
    flow.emit(2)

    expect(values).toEqual([1, 2])

    // Read-only view has no emit method
    expect(typeof (readOnly as any).emit).not.toBe('function')
  })
})
