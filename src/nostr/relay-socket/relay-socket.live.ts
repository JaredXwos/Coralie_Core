import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { err, ok, type Result } from '../../core/types'
import { RelaySocketState, type BackoffStrategy, type RelaySocket, type WebSocketLike } from './relay-socket.interface'

export function exponentialBackoff(
  attempt: number,
  options?: { baseMs?: number; maxMs?: number },
): number {
  const base = options?.baseMs ?? 500
  const max = options?.maxMs ?? 30_000
  return Math.min(max, base * 2 ** attempt)
}

const OPEN_READY_STATE = 1

export interface LiveRelaySocketOptions {
  backoffStrategy?: BackoffStrategy
  webSocketFactory?: (url: string) => WebSocketLike
}

/**
 * One WebSocket connection to a single Nostr relay, with automatic
 * reconnect-with-backoff on unexpected drop. Connects immediately on
 * construction; call `close()` to tear down permanently (no further
 * reconnect attempts after that).
 */
export class LiveRelaySocket implements RelaySocket {
  private readonly backoffStrategy: BackoffStrategy
  private readonly webSocketFactory: (url: string) => WebSocketLike

  private readonly stateFlow = createStateFlow<RelaySocketState>(RelaySocketState.Connecting)
  private readonly messagesFlow = createSharedFlow<string>()

  private ws: WebSocketLike | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByCaller = false

  constructor(
    readonly url: string,
    options: LiveRelaySocketOptions = {},
  ) {
    this.backoffStrategy = options.backoffStrategy ?? exponentialBackoff
    this.webSocketFactory = options.webSocketFactory ?? ((u) => new WebSocket(u) as unknown as WebSocketLike)
    this.openSocket()
  }

  get state(): StateFlow<RelaySocketState> {
    return this.stateFlow.asReadOnly()
  }

  get messages(): SharedFlow<string> {
    return this.messagesFlow.asReadOnly()
  }

  send(data: string): Result<void> {
    if (this.stateFlow.value !== RelaySocketState.Open || !this.ws) {
      return err(new Error(`relay ${this.url}: not open`))
    }
    // readyState is a fast-path hint, not the source of truth for
    // whether the underlying transport will actually accept the
    // frame — but the browser WebSocket API gives us no send-result
    // signal beyond "throws if not OPEN", so this check is the best
    // available guard before handing off to send().
    if (this.ws.readyState !== OPEN_READY_STATE) {
      return err(new Error(`relay ${this.url}: socket not ready`))
    }
    this.ws.send(data)
    return ok(undefined)
  }

  close(): void {
    if (this.closedByCaller) return
    this.closedByCaller = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stateFlow.value = RelaySocketState.Closed
    this.ws?.close(1000, 'client closing')
    this.ws = null
  }

  private openSocket(): void {
    if (this.closedByCaller) return
    this.stateFlow.value = this.attempt === 0 ? RelaySocketState.Connecting : RelaySocketState.Reconnecting

    const socket = this.webSocketFactory(this.url)
    this.ws = socket

    socket.onopen = () => {
      if (this.ws !== socket) return // superseded by a later reconnect
      this.attempt = 0 // a successful connection resets the backoff counter
      this.stateFlow.value = RelaySocketState.Open
    }

    socket.onmessage = (ev) => {
      if (this.ws !== socket) return
      this.messagesFlow.emit(ev.data)
    }

    socket.onerror = () => {
      // Errors are followed by a close event on real WebSocket
      // implementations; the reconnect logic lives in onclose so it
      // isn't triggered twice.
    }

    socket.onclose = () => {
      if (this.ws !== socket) return // stale handler from a superseded socket
      this.ws = null
      if (this.closedByCaller) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    const delay = this.backoffStrategy(this.attempt)
    this.attempt += 1
    this.stateFlow.value = RelaySocketState.Reconnecting
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }
}
