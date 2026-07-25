import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { LinkState, type SessionDescriptionData } from '../../core/types'
import { LivePeerLink, type PeerLink } from '../peer-link'
import type { DataChannelLike, PeerConnectionFactory, PeerConnectionLike, PeerConnectionObserver } from '../peer-connection'
import type { Initiator } from './initiator.interface'

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000
const DATA_CHANNEL_LABEL = 'mesh'

export interface LiveInitiatorOptions {
  peerConnectionFactory: PeerConnectionFactory
  /** Wall-clock timeout for the whole offer→connected cycle. Default 30s (§3). */
  handshakeTimeoutMs?: number
  /** Optional diagnostic observer forwarded to the peer connection factory. */
  observer?: PeerConnectionObserver
}

export class LiveInitiator implements Initiator {
  private readonly stateFlow = createStateFlow<LinkState>(LinkState.Initiating)
  private readonly pc: PeerConnectionLike
  private readonly handshakeTimeoutMs: number
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null
  private link: PeerLink | null = null

  constructor(options: LiveInitiatorOptions) {
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    this.pc = options.peerConnectionFactory(options.observer)
    this.pc.onconnectionstatechange = () => this.handleConnectionStateChange()
  }

  get state(): StateFlow<LinkState> {
    return this.stateFlow.asReadOnly()
  }

  get peerLink(): PeerLink | null {
    return this.link
  }

  async createOffer(): Promise<SessionDescriptionData> {
    const channel = this.pc.createDataChannel(DATA_CHANNEL_LABEL)
    this.wireDataChannel(channel)

    this.stateFlow.value = LinkState.Offering
    // createOffer() already sets the local description and waits for
    // ICE gathering to complete (see PeerConnectionLike's contract).
    const offer = await this.pc.createOffer()

    this.stateFlow.value = LinkState.Connecting
    this.startHandshakeTimeout()
    return offer
  }

  async acceptAnswer(answer: SessionDescriptionData): Promise<void> {
    if (this.stateFlow.value !== LinkState.Connecting) return // stale: superseded by a retry
    await this.pc.setRemoteDescription(answer)
  }

  close(): void {
    this.clearHandshakeTimeout()
    this.link?.close()
    this.pc.close()
    this.stateFlow.value = LinkState.Closed
  }

  private wireDataChannel(channel: DataChannelLike): void {
    channel.onopen = () => {
      if (this.stateFlow.value !== LinkState.Connecting) return // stale/superseded
      this.link = new LivePeerLink(channel)
      this.clearHandshakeTimeout()
      this.stateFlow.value = LinkState.Connected
    }
  }

  private handleConnectionStateChange(): void {
    if (this.pc.connectionState === 'failed') this.fail()
  }

  private fail(): void {
    if (this.stateFlow.value === LinkState.Failed || this.stateFlow.value === LinkState.Closed) return
    this.clearHandshakeTimeout()
    this.stateFlow.value = LinkState.Failed
  }

  private startHandshakeTimeout(): void {
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null
      if (this.stateFlow.value !== LinkState.Connected) this.fail() // handshake timed out
    }, this.handshakeTimeoutMs)
  }

  private clearHandshakeTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }
}
