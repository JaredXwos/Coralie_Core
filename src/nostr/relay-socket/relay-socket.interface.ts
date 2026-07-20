import type { Result } from '../../core/types'
import type { StateFlow } from '../../core/state-flow'
import type { SharedFlow } from '../../core/shared-flow'

/** Connection lifecycle of a single relay socket. */
export enum RelaySocketState {
  Connecting = 'Connecting',
  Open = 'Open',
  Reconnecting = 'Reconnecting',
  /** Terminal — only reached via explicit close(); never auto-recovers. */
  Closed = 'Closed',
}

/**
 * Returns the delay in ms to wait before the given (0-indexed) retry
 * attempt. Exposed as a pluggable strategy so tests can inject a fast
 * or fully deterministic schedule.
 */
export type BackoffStrategy = (attempt: number) => number

/**
 * Minimal subset of the WebSocket API the Live implementation depends
 * on, so tests can inject a fake instead of a real browser/Node
 * WebSocket.
 */
export interface WebSocketLike {
  onopen: (() => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface RelaySocket {
  readonly url: string
  readonly state: StateFlow<RelaySocketState>
  readonly messages: SharedFlow<string>
  /**
   * Sends a text frame.
   *
   * Resolves the architecture doc's §7 open question ("queued vs
   * rejected sends on a not-yet-open socket"): rejected, not queued.
   * A send while not `Open` returns a failure `Result` immediately
   * rather than buffering — callers (relay-session, signalling-client)
   * are expected to retry at the semantic layer once the socket
   * reports `Open` again, the same way a failed WebRTC signalling send
   * feeds into rule 4's retry path in the orchestrator.
   */
  send(data: string): Result<void>
  close(): void
}
