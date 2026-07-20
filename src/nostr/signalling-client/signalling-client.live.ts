import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { err, ok, type NostrEvent, type Result } from '../../core/types'
import type { Signer } from '../../crypto/signer'
import { LiveDedupingEventSink, type EventSink } from '../event-sink'
import { LiveRelaySession, type RelaySession } from '../relay-session'
import { LiveRelaySocket, type LiveRelaySocketOptions, type RelaySocket } from '../relay-socket'
import { SIGNALLING_KIND, type SignallingClient, type SignallingMessage } from './signalling-client.interface'

export interface SignallingClientOptions {
  eventSink?: EventSink
  relaySocketOptions?: LiveRelaySocketOptions
  /** Injection point for tests — bypasses real WebSocket/relay-session construction. */
  createRelaySession?: (url: string, myPubkeyHex: string) => RelaySession
}

/**
 * Fans a single logical send/subscribe out across all configured
 * relays. Encrypts outbound payloads and decrypts inbound ones via
 * NIP-44 using the given {@link Signer}, and de-duplicates inbound
 * events (the same event commonly arrives via more than one relay)
 * through a shared {@link EventSink} before decrypting.
 */
export class LiveNostrSignallingClient implements SignallingClient {
  private readonly sink: EventSink
  private readonly sessions: RelaySession[]
  private readonly inboundFlow = createSharedFlow<SignallingMessage>()
  private readonly unsubscribes: Array<() => void> = []

  constructor(
    private readonly signer: Signer,
    relayUrls: string[],
    options: SignallingClientOptions = {},
  ) {
    this.sink = options.eventSink ?? new LiveDedupingEventSink()

    const createSession =
      options.createRelaySession ??
      ((url: string, myPubkeyHex: string): RelaySession => {
        const socket: RelaySocket = new LiveRelaySocket(url, options.relaySocketOptions)
        return new LiveRelaySession(socket, myPubkeyHex, [SIGNALLING_KIND])
      })

    this.sessions = relayUrls.map((url) => createSession(url, this.signer.pubkeyHex))

    for (const session of this.sessions) {
      const unsubscribe = session.events.subscribe((event) => this.handleInboundEvent(event))
      this.unsubscribes.push(unsubscribe)
    }
  }

  get myPubkeyHex(): string {
    return this.signer.pubkeyHex
  }

  get inbound(): SharedFlow<SignallingMessage> {
    return this.inboundFlow.asReadOnly()
  }

  send(toPubkeyHex: string, payload: string): Result<void> {
    const convoKey = this.signer.getConvoKey(toPubkeyHex)
    const ciphertext = this.signer.encryptNip44(payload, convoKey)
    const event = this.signer.sign(SIGNALLING_KIND, [['p', toPubkeyHex]], ciphertext)

    let anySucceeded = false
    let lastError: Error = new Error('no relays configured')
    for (const session of this.sessions) {
      const result = session.publish(event)
      if (result.ok) {
        anySucceeded = true
      } else {
        lastError = result.error
      }
    }

    return anySucceeded ? ok(undefined) : err(lastError)
  }

  close(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    for (const session of this.sessions) session.close()
  }

  private handleInboundEvent(event: NostrEvent): void {
    // Cross-relay dedup: the same event routinely arrives once per
    // relay it was seen on. Only the first arrival is processed.
    if (!this.sink.offer(event)) return

    let convoKey: Uint8Array
    try {
      convoKey = this.signer.getConvoKey(event.pubkey)
    } catch {
      return // malformed sender pubkey — drop, don't throw past the caller
    }

    let plaintext: string
    try {
      plaintext = this.signer.decryptNip44(event.content, convoKey)
    } catch {
      // Wrong key or corrupt payload — dropped, not thrown past the caller.
      return
    }

    this.inboundFlow.emit({ fromPubkeyHex: event.pubkey, payload: plaintext })
  }
}
