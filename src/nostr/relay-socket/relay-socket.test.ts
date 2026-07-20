import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exponentialBackoff, LiveRelaySocket } from './relay-socket.live'
import { RelaySocketState, type WebSocketLike } from './relay-socket.interface'

/** Controllable fake WebSocket for deterministic tests (the raw transport, not RelaySocket itself). */
class FakeWebSocket implements WebSocketLike {
  onopen: (() => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  readyState = 0 // CONNECTING
  sent: string[] = []
  closed = false

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = 3 // CLOSED
  }

  /** Test helper: simulate the server accepting the connection. */
  simulateOpen(): void {
    this.readyState = 1 // OPEN
    this.onopen?.()
  }

  /** Test helper: simulate an unexpected drop. */
  simulateClose(): void {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: 'abnormal closure' })
  }
}

describe('exponentialBackoff', () => {
  it('doubles per attempt starting from baseMs', () => {
    expect(exponentialBackoff(0, { baseMs: 100 })).toBe(100)
    expect(exponentialBackoff(1, { baseMs: 100 })).toBe(200)
    expect(exponentialBackoff(2, { baseMs: 100 })).toBe(400)
  })

  it('caps at maxMs', () => {
    expect(exponentialBackoff(10, { baseMs: 100, maxMs: 1000 })).toBe(1000)
  })
})

describe('LiveRelaySocket', () => {
  let sockets: FakeWebSocket[]

  function factory() {
    const socket = new FakeWebSocket()
    sockets.push(socket)
    return socket
  }

  beforeEach(() => {
    sockets = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in Connecting state and moves to Open once the socket opens', () => {
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory })
    expect(relay.state.value).toBe(RelaySocketState.Connecting)

    sockets[0].simulateOpen()
    expect(relay.state.value).toBe(RelaySocketState.Open)
  })

  it('follows the expected exponential backoff curve on repeated failures', () => {
    const delays: number[] = []
    const backoffStrategy = (attempt: number) => {
      const d = 100 * 2 ** attempt
      delays.push(d)
      return d
    }
    new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory, backoffStrategy })

    sockets[0].simulateClose()
    vi.advanceTimersByTime(100)
    sockets[1].simulateClose()
    vi.advanceTimersByTime(200)
    sockets[2].simulateClose()
    vi.advanceTimersByTime(400)

    expect(delays).toEqual([100, 200, 400])
    expect(sockets.length).toBe(4) // initial + 3 reconnects
  })

  it('resets the backoff counter after a successful connection', () => {
    const attempts: number[] = []
    const backoffStrategy = (attempt: number) => {
      attempts.push(attempt)
      return 50
    }
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory, backoffStrategy })

    sockets[0].simulateClose()
    vi.advanceTimersByTime(50)
    sockets[1].simulateOpen()
    expect(relay.state.value).toBe(RelaySocketState.Open)

    sockets[1].simulateClose()
    expect(attempts).toEqual([0, 0])
  })

  it('rejects a send while not yet open (queued-vs-rejected: rejected)', () => {
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory })
    const result = relay.send('["REQ"]')
    expect(result.ok).toBe(false)
    expect(sockets[0].sent).toEqual([])
  })

  it('sends once the socket is open', () => {
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory })
    sockets[0].simulateOpen()

    const result = relay.send('["REQ"]')
    expect(result.ok).toBe(true)
    expect(sockets[0].sent).toEqual(['["REQ"]'])
  })

  it('forwards inbound messages via the messages SharedFlow', () => {
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory })
    sockets[0].simulateOpen()

    const received: string[] = []
    relay.messages.subscribe((msg) => received.push(msg))
    sockets[0].onmessage?.({ data: '["EVENT","sub1",{}]' })

    expect(received).toEqual(['["EVENT","sub1",{}]'])
  })

  it('does not reconnect after an explicit close()', () => {
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory })
    sockets[0].simulateOpen()

    relay.close()
    expect(relay.state.value).toBe(RelaySocketState.Closed)
    expect(sockets[0].closed).toBe(true)

    vi.advanceTimersByTime(60_000)
    expect(sockets.length).toBe(1)
  })

  it('close() before any open still prevents a pending reconnect from firing', () => {
    const relay = new LiveRelaySocket('wss://relay.example', { webSocketFactory: factory })
    sockets[0].simulateClose()
    relay.close()

    vi.advanceTimersByTime(60_000)
    expect(sockets.length).toBe(1)
    expect(relay.state.value).toBe(RelaySocketState.Closed)
  })
})
