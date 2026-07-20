import { createStateFlow, type StateFlow } from '../../core/state-flow'
import { LinkState, type SessionDescriptionData } from '../../core/types'
import { LivePeerLink, type PeerLink } from '../peer-link'
import type { DataChannelLike, PeerConnectionFactory, PeerConnectionLike } from '../peer-connection'
import type { Answerer } from './answerer.interface'

export interface LiveAnswererOptions {
  peerConnectionFactory: PeerConnectionFactory
}

export class LiveAnswerer implements Answerer {
  private readonly stateFlow = createStateFlow<LinkState>(LinkState.Answering)
  private readonly pc: PeerConnectionLike
  private link: PeerLink | null = null

  constructor(options: LiveAnswererOptions) {
    this.pc = options.peerConnectionFactory()
    this.pc.onconnectionstatechange = () => this.handleConnectionStateChange()
    this.pc.ondatachannel = (ev) => this.wireDataChannel(ev.channel)
  }

  get state(): StateFlow<LinkState> {
    return this.stateFlow.asReadOnly()
  }

  get peerLink(): PeerLink | null {
    return this.link
  }

  async createAnswer(offer: SessionDescriptionData): Promise<SessionDescriptionData> {
    await this.pc.setRemoteDescription(offer)
    // createAnswer() already sets the local description and waits for
    // ICE gathering to complete (see PeerConnectionLike's contract).
    const answer = await this.pc.createAnswer()
    this.stateFlow.value = LinkState.Connecting
    return answer
  }

  close(): void {
    this.link?.close()
    this.pc.close()
    this.stateFlow.value = LinkState.Closed
  }

  private wireDataChannel(channel: DataChannelLike): void {
    channel.onopen = () => {
      if (this.stateFlow.value !== LinkState.Connecting) return // stale/superseded
      this.link = new LivePeerLink(channel)
      this.stateFlow.value = LinkState.Connected
    }
  }

  private handleConnectionStateChange(): void {
    if (this.pc.connectionState !== 'failed') return
    if (this.stateFlow.value === LinkState.Failed || this.stateFlow.value === LinkState.Closed) return
    this.stateFlow.value = LinkState.Failed
  }
}
