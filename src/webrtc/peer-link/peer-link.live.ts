import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { createStateFlow, type StateFlow } from '../../core/state-flow'
import type { DataChannelLike } from '../peer-connection'
import type { PeerLink, PeerLinkState } from './peer-link.interface'

export class LivePeerLink implements PeerLink {
  private readonly stateFlow = createStateFlow<PeerLinkState>('open')
  private readonly incomingBytesFlow = createSharedFlow<Uint8Array>()

  constructor(private readonly channel: DataChannelLike) {
    this.channel.onmessage = (ev) => {
      this.incomingBytesFlow.emit(ev.data)
    }
    this.channel.onclose = () => {
      this.stateFlow.value = 'closed'
    }
  }

  get state(): StateFlow<PeerLinkState> {
    return this.stateFlow.asReadOnly()
  }

  get incomingBytes(): SharedFlow<Uint8Array> {
    return this.incomingBytesFlow.asReadOnly()
  }

  send(data: Uint8Array): void {
    if (this.stateFlow.value !== 'open') {
      throw new Error('cannot send on a closed PeerLink')
    }
    this.channel.send(data)
  }

  close(): void {
    if (this.stateFlow.value === 'closed') return
    this.stateFlow.value = 'closed'
    this.channel.close()
  }
}
