import type { SessionDescriptionData } from '../../core/types'
import type { DataChannelLike, PeerConnectionLike, PeerConnectionState } from './peer-connection.interface'

export class MockDataChannel implements DataChannelLike {
  readyState: DataChannelLike['readyState'] = 'connecting'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: Uint8Array }) => void) | null = null
  peer: MockDataChannel | null = null
  sent: Uint8Array[] = []

  constructor(readonly label: string) {}

  open(): void {
    this.readyState = 'open'
    this.onopen?.()
  }

  send(data: Uint8Array): void {
    this.sent.push(data)
    this.peer?.onmessage?.({ data })
  }

  close(): void {
    this.readyState = 'closed'
    this.onclose?.()
  }
}

/**
 * A `PeerConnectionLike` test double that "cheats" real signalling:
 * two linked instances share direct references to each other (via
 * `remote`) instead of exchanging opaque SDP over the network. This
 * is enough to exercise the state machines in `Initiator`/`Answerer`/
 * `PeerLink` without a browser — offer/answer content is opaque
 * placeholder text, never actually parsed.
 */
export class MockPeerConnection implements PeerConnectionLike {
  connectionState: PeerConnectionState = 'new'
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null = null
  dataChannel: MockDataChannel | null = null
  remote: MockPeerConnection | null = null

  createDataChannel(label: string): DataChannelLike {
    const channel = new MockDataChannel(label)
    this.dataChannel = channel
    return channel
  }

  async createOffer(): Promise<SessionDescriptionData> {
    return { type: 'offer', sdp: 'mock-offer-sdp' }
  }

  async createAnswer(): Promise<SessionDescriptionData> {
    return { type: 'answer', sdp: 'mock-answer-sdp' }
  }

  async setRemoteDescription(desc: SessionDescriptionData): Promise<void> {
    if (desc.type === 'offer') {
      // We're the answerer processing the initiator's offer: mirror
      // its data channel and fire ondatachannel, same as a real
      // RTCPeerConnection would once negotiation reaches that point.
      const remoteChannel = this.remote?.dataChannel
      if (remoteChannel) {
        const localChannel = new MockDataChannel(remoteChannel.label)
        localChannel.peer = remoteChannel
        remoteChannel.peer = localChannel
        this.dataChannel = localChannel
        this.ondatachannel?.({ channel: localChannel })
      }
    } else {
      // We're the initiator applying the answer: negotiation completes.
      this.markConnected()
      this.remote?.markConnected()
      this.dataChannel?.open()
      this.remote?.dataChannel?.open()
    }
  }

  close(): void {
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }

  markConnected(): void {
    this.connectionState = 'connected'
    this.onconnectionstatechange?.()
  }

  simulateFailure(): void {
    this.connectionState = 'failed'
    this.onconnectionstatechange?.()
  }
}

/** Creates two `MockPeerConnection`s wired to each other. */
export function createLinkedMockPeerConnections(): [MockPeerConnection, MockPeerConnection] {
  const a = new MockPeerConnection()
  const b = new MockPeerConnection()
  a.remote = b
  b.remote = a
  return [a, b]
}
