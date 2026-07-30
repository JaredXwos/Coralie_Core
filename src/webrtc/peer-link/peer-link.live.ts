import { createSharedFlow, type SharedFlow } from '../../core/shared-flow'
import { createStateFlow, type StateFlow } from '../../core/state-flow'
import type { DataChannelLike } from '../peer-connection'
import type { PeerLink, PeerLinkState } from './peer-link.interface'
import type { Result } from '../../core/types'
import { err, ok } from '../../core/types'

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

  send(data: Uint8Array): Result<void> {
    if (this.stateFlow.value !== 'open') {
      return err(new Error('cannot send on a closed PeerLink'))
    }
    try {
      this.channel.send(data)
      return ok(undefined)
    } catch (error) {
      return err(
        error instanceof Error
          ? error
          : new Error(String(error)),
      )
    }
  }

  close(): void {
    if (this.stateFlow.value === 'closed') return
    this.stateFlow.value = 'closed'
    this.channel.close()
  }
}
