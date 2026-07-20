import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import type { StateFlow } from '../../core/state-flow'
import { err, ok, type NostrEvent, type Result } from '../../core/types'
import { RelaySocketState, type RelaySocket } from '../relay-socket'
import type { RelaySession } from './relay-session.interface'

const SUBSCRIPTION_ID = 'mesh'

/**
 * Wraps a {@link RelaySocket} with a REQ subscription filtered by
 * `#p` = `myPubkeyHex`, and a publish() that wraps `["EVENT", event]`.
 *
 * The REQ subscription is (re)sent every time the underlying socket
 * transitions to `Open` — including after a reconnect — since NIP-01
 * subscriptions don't survive a dropped connection.
 */
export class LiveRelaySession implements RelaySession {
  private readonly eventsFlow = createSharedFlow<NostrEvent>()
  private unsubscribeSocketState: () => void
  private unsubscribeSocketMessages: () => void

  constructor(
    private readonly socket: RelaySocket,
    private readonly myPubkeyHex: string,
    private readonly kinds?: number[],
  ) {
    this.unsubscribeSocketState = this.socket.state.subscribe((state) => {
      if (state === RelaySocketState.Open) {
        this.sendSubscription()
      }
    })
    this.unsubscribeSocketMessages = this.socket.messages.subscribe((raw) => {
      this.handleMessage(raw)
    })
  }

  get url(): string {
    return this.socket.url
  }

  get connectionState(): StateFlow<RelaySocketState> {
    return this.socket.state
  }

  get events(): SharedFlow<NostrEvent> {
    return this.eventsFlow.asReadOnly()
  }

  publish(event: NostrEvent): Result<void> {
    return this.socket.send(JSON.stringify(['EVENT', event]))
  }

  close(): void {
    this.unsubscribeSocketState()
    this.unsubscribeSocketMessages()
    this.socket.close()
  }

  private sendSubscription(): void {
    const filter: Record<string, unknown> = { '#p': [this.myPubkeyHex] }
    if (this.kinds) filter.kinds = this.kinds
    this.socket.send(JSON.stringify(['REQ', SUBSCRIPTION_ID, filter]))
  }

  private handleMessage(raw: string): void {
    const parsed = parseRelayMessage(raw)
    if (!parsed.ok) return // malformed frame: logged and dropped, never crashes the reader

    const [type, ...rest] = parsed.value
    if (type === 'EVENT' && rest[0] === SUBSCRIPTION_ID) {
      const event = rest[1] as NostrEvent
      this.eventsFlow.emit(event)
    }
    // EOSE / OK / NOTICE / CLOSED frames are currently ignored — nothing
    // downstream depends on end-of-stored-events or publish acks yet.
  }
}

function parseRelayMessage(raw: string): Result<unknown[]> {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== 'string') {
      return err(new Error('malformed relay frame: not a [type, ...] array'))
    }
    return ok(value)
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}
