import type { SessionDescriptionData } from '../../core/types'
import type {
  DataChannelLike,
  PeerConnectionFactory,
  PeerConnectionLike,
  PeerConnectionState,
} from './peer-connection.interface'

export interface LivePeerConnectionOptions {
  iceServers?: RTCIceServer[]
}

/** Wraps a real `RTCDataChannel`, narrowing its `send()` to `Uint8Array` only. */
class LiveDataChannel implements DataChannelLike {
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: Uint8Array }) => void) | null = null

  constructor(private readonly channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => this.onopen?.()
    channel.onclose = () => this.onclose?.()
    channel.onmessage = (ev: MessageEvent) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(0)
      this.onmessage?.({ data })
    }
  }

  get label(): string {
    return this.channel.label
  }

  get readyState(): DataChannelLike['readyState'] {
    return this.channel.readyState
  }

  send(data: Uint8Array): void {
    this.channel.send(data as unknown as ArrayBufferView<ArrayBuffer>)
  }

  close(): void {
    this.channel.close()
  }
}

/**
 * Wraps the real browser `RTCPeerConnection`, adapting its trickle-ICE
 * default into the non-trickle contract `PeerConnectionLike` expects:
 * `createOffer()`/`createAnswer()` don't resolve until ICE gathering
 * reaches `complete`, at which point `pc.localDescription.sdp` already
 * has every candidate folded in (the standard "vanilla ICE" pattern) —
 * so the returned SDP is immediately ready to hand to signalling.
 */
export class LivePeerConnection implements PeerConnectionLike {
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null = null

  constructor(private readonly pc: RTCPeerConnection) {
    this.pc.onconnectionstatechange = () => this.onconnectionstatechange?.()
    this.pc.ondatachannel = (ev: RTCDataChannelEvent) => {
      this.ondatachannel?.({ channel: new LiveDataChannel(ev.channel) })
    }
  }

  get connectionState(): PeerConnectionState {
    return this.pc.connectionState as PeerConnectionState
  }

  createDataChannel(label: string): DataChannelLike {
    return new LiveDataChannel(this.pc.createDataChannel(label))
  }

  async createOffer(): Promise<SessionDescriptionData> {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await this.waitForIceGatheringComplete()
    return this.currentLocalDescription('offer')
  }

  async createAnswer(): Promise<SessionDescriptionData> {
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    await this.waitForIceGatheringComplete()
    return this.currentLocalDescription('answer')
  }

  async setRemoteDescription(desc: SessionDescriptionData): Promise<void> {
    await this.pc.setRemoteDescription(desc as RTCSessionDescriptionInit)
  }

  close(): void {
    this.pc.close()
  }

  private currentLocalDescription(type: 'offer' | 'answer'): SessionDescriptionData {
    const local = this.pc.localDescription
    if (!local) throw new Error(`localDescription missing after create${type === 'offer' ? 'Offer' : 'Answer'}()`)
    return { type, sdp: local.sdp }
  }

  private waitForIceGatheringComplete(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', check)
          resolve()
        }
      }
      this.pc.addEventListener('icegatheringstatechange', check)
    })
  }
}

/** Default factory: builds a `LivePeerConnection` around a real `RTCPeerConnection`. */
export function createLivePeerConnectionFactory(options: LivePeerConnectionOptions = {}): PeerConnectionFactory {
  return () => new LivePeerConnection(new RTCPeerConnection({ iceServers: options.iceServers }))
}
