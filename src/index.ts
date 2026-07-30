import { installBrowserCoralie } from './coralie/install-coralie'

if (typeof window !== 'undefined') {
  installBrowserCoralie()
}

export {
  BrowserCoralieHost,
  MAX_HTTP_RESPONSE_BYTES,
} from './coralie/browser-coralie-host'
export { installBrowserCoralie } from './coralie/install-coralie'

export type {
  CoralieBytePayload,
  CoralieHost,
  CoralieHostKind,
  CoralieSendMessageError,
  CoralieSendMessageErrorName,
  HttpFailureDiagnostic,
  HttpRequestData,
  HttpResponseData,
  MaybePromise,
  MeshPeer,
  PeerMessageEventDetail,
  TerminalFailure,
  TerminalFailureEventDetail,
  TimerFiredEventDetail,
  TimerInfo,
} from './coralie/coralie-host.interface'

export { createLiveConnectionManager } from './create-live-connection-manager'
export type { CreateLiveConnectionManagerOptions } from './create-live-connection-manager'
export type {
  LiveConnectionManager,
  MeshPeer as LiveMeshPeer,
} from './connection/live-connection-manager.interface'
export type {
  PeerMessage as LivePeerMessage,
  TerminalFailure as LiveTerminalFailure,
} from './core/types'
export { LinkState } from './core/types'
export type { StateFlow } from './core/state-flow'
export type { SharedFlow } from './core/shared-flow'
