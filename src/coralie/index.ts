/** Public package entry point. */
export {
  BrowserCoralieHost,
  MAX_HTTP_RESPONSE_BYTES,
} from './coralie/browser-coralie-host'
export { installBrowserCoralie } from './coralie/install-coralie'

export type {
  CoralieBytePayload,
  CoralieHost,
  CoralieHostKind,
  HttpFailureDiagnostic,
  HttpRequestData,
  HttpResponseData,
  MaybePromise,
  MeshPeer as CoralieMeshPeer,
  PeerMessageEventDetail,
  TerminalFailure as CoralieTerminalFailure,
  TerminalFailureEventDetail,
  TimerFiredEventDetail,
  TimerInfo,
} from './coralie/coralie-host.interface'

export { createLiveConnectionManager } from './create-live-connection-manager'
export type {
  CreateLiveConnectionManagerOptions,
} from './create-live-connection-manager'

export type {
  LiveConnectionManager,
  MeshPeer,
} from './connection/live-connection-manager.interface'

export { LinkState } from './core/types'
export type {
  PeerMessage,
  TerminalFailure,
} from './core/types'

export type { StateFlow } from './core/state-flow'
export type { SharedFlow } from './core/shared-flow'
