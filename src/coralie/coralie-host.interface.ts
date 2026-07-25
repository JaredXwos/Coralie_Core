/** Browser and Android implementations expose API version 2. */
export type CoralieHostKind = 'browser' | 'android-native'

export interface MeshPeer {
  pubkeyHex: string
  connectedAt: number | null
}

/** JSON-compatible detail dispatched by `coralie:message`. */
export interface PeerMessageEventDetail {
  fromPubkeyHex: string
  toPubkeyHex: string
  timestamp: number
  payload: number[]
}

export interface TerminalFailureEventDetail {
  pubkeyHex: string
  attemptCount: number
  reason?: string
}

/** Compatibility name retained for Coralie-submodule consumers. */
export type TerminalFailure = TerminalFailureEventDetail

export interface HttpRequestData {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export interface HttpResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string | null
}

export interface HttpFailureDiagnostic {
  requestId: number
  stage: string
  category: string
  method: string
  url: string
  elapsedMs: number
  message: string
  exception: string
  rootException: string
  causeChain: string
  limitBytes?: number
  observedBytes?: number
  declaredByServer?: boolean
}

export interface TimerInfo {
  id: string
  remainingMs: number
}

/** Android omits `payload` when the queued value was null. */
export interface TimerFiredEventDetail {
  id: string
  payload?: string
}

export type CoralieBytePayload = Uint8Array | readonly number[]
export type MaybePromise<T> = T | Promise<T>

/**
 * Flat page-facing API shared by Android's native bridge and the browser host.
 * Page code should use `await` for consumed return values because a host
 * method may be synchronous in one implementation and asynchronous in another.
 */
export interface CoralieHost {
  apiVersion(): number
  hostKind(): CoralieHostKind

  getPubkey(): MaybePromise<string>
  addPeer(pubkeyHex: string): MaybePromise<void>
  sendMessage(
    toPubkeyHex: string,
    payload: CoralieBytePayload,
  ): MaybePromise<void>
  getPeersJson(): MaybePromise<string>
  reset(): MaybePromise<string>
  close(): MaybePromise<void>

  storageGetItem(key: string): MaybePromise<string | null>
  storageSetItem(key: string, value: string): MaybePromise<void>
  storageRemoveItem(key: string): MaybePromise<void>

  httpRequestJson(requestJson: string): MaybePromise<string>

  timerQueue(
    id: string | null,
    delaySeconds: number,
    payload: string | null,
  ): MaybePromise<string>
  timerCancel(id: string): MaybePromise<void>
  timerListJson(): MaybePromise<string>
}

declare global {
  interface Window {
    Coralie: CoralieHost
  }

  interface WindowEventMap {
    'coralie:peers': CustomEvent<MeshPeer[]>
    'coralie:message': CustomEvent<PeerMessageEventDetail>
    'coralie:terminalFailure': CustomEvent<TerminalFailureEventDetail>
    'coralie:timerFired': CustomEvent<TimerFiredEventDetail>
  }
}
