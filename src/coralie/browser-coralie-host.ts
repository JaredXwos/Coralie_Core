import type { CreateLiveConnectionManagerOptions } from '../create-live-connection-manager'
import type {
  LiveConnectionManager,
  MeshPeer as LiveMeshPeer,
} from '../connection/live-connection-manager.interface'
import type {
  PeerMessage as LivePeerMessage,
  TerminalFailure as LiveTerminalFailure,
} from '../core/types'
import type {
  CoralieBytePayload,
  CoralieHost,
  CoralieSendMessageError,
  CoralieSendMessageErrorName,
  HttpFailureDiagnostic,
  HttpRequestData,
  HttpResponseData,
  MeshPeer,
  PeerMessageEventDetail,
  TerminalFailureEventDetail,
  TimerFiredEventDetail,
  TimerInfo,
} from './coralie-host.interface'

import { createLiveConnectionManager } from '../create-live-connection-manager'

type ManagerFactory = (
  options: CreateLiveConnectionManagerOptions,
) => LiveConnectionManager
type FetchLike = typeof fetch
type Unsubscribe = () => void

type BrowserTimer = {
  handle: ReturnType<typeof setTimeout> | null
  deadlineMs: number
  payload: string | null
}

class ResponseTooLargeError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly observedBytes: number,
    readonly declaredByServer: boolean,
  ) {
    super(
      `Response exceeds size limit: ${observedBytes} bytes observed, ` +
        `${limitBytes} bytes allowed`,
    )
    this.name = 'ResponseTooLargeError'
  }
}

const PUBKEY_PATTERN = /^[0-9a-fA-F]{64}$/
const MAX_TIMEOUT_MS = 2_147_483_647

/** Fixed decoded response ceiling shared with the Android native proxy. */
export const MAX_HTTP_RESPONSE_BYTES = 64 * 1024 * 1024

let nextHttpRequestId = 1

/**
 * Browser implementation of Android's direct-native `window.Coralie` v2
 * contract.
 *
 * The browser intentionally has no page-capability or domain prompt API.
 * Android handles those decisions inside protected operations; the browser
 * assumes the operation is permitted.
 */
export class BrowserCoralieHost implements CoralieHost {
  private manager: LiveConnectionManager
  private readonly managerFactory: ManagerFactory
  private readonly options: CreateLiveConnectionManagerOptions
  private readonly fetchImpl: FetchLike

  private managerUnsubscribers: Unsubscribe[] = []
  private currentPeers: MeshPeer[] = []
  private readonly memoryStorage = new Map<string, string>()
  private readonly timers = new Map<string, BrowserTimer>()
  private meshClosed = false

  constructor(
    options: CreateLiveConnectionManagerOptions = {},
    managerFactory: ManagerFactory = createLiveConnectionManager,
    fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {
    this.options = options
    this.managerFactory = managerFactory
    this.fetchImpl = fetchImpl
    this.manager = this.managerFactory(this.options)
    this.bindManager()
  }

  apiVersion(): number {
    return 2
  }

  hostKind(): 'browser' {
    return 'browser'
  }

  getPubkey(): string {
    this.assertMeshOpen()
    return this.manager.myPubkeyHex
  }

  addPeer(pubkeyHex: string): void {
    this.assertMeshOpen()
    this.assertPubkey(pubkeyHex, 'pubkeyHex')
    this.manager.addPeer(pubkeyHex.toLowerCase())
  }

  sendMessage(
    toPubkeyHex: string,
    payload: CoralieBytePayload,
  ): void {
    const target = String(toPubkeyHex).toLowerCase()

    if (this.meshClosed) {
      throw this.sendMessageError(
        'CoralieHostError',
        'Unable to send message',
        target,
      )
    }

    let bytes: Uint8Array
    try {
      this.assertPubkey(target, 'toPubkeyHex')
      bytes = this.normaliseOutgoingPayload(payload)
    } catch (error) {
      throw this.sendMessageError(
        'InvalidArgumentError',
        error instanceof Error ? error.message : String(error),
        target,
      )
    }

    const connected = this.currentPeers.some(
      (peer) => peer.pubkeyHex === target,
    )

    if (!connected) {
      throw this.sendMessageError(
        'PeerUnavailableError',
        'Peer disconnected or channel unavailable',
        target,
      )
    }

    const result = this.manager.sendToPeer(target, bytes)
    if (!result.ok) {
      throw this.sendMessageError(
        'PeerUnavailableError',
        'Peer disconnected or channel unavailable',
        target,
      )
    }
  }

  getPeersJson(): string {
    this.assertMeshOpen()
    return JSON.stringify(this.clonePeers(this.currentPeers))
  }

  reset(): string {
    // Build first so a factory failure leaves the existing mesh usable.
    const nextManager = this.managerFactory(this.options)

    this.unbindManager()
    if (!this.meshClosed) this.manager.close()

    this.manager = nextManager
    this.currentPeers = []
    this.meshClosed = false
    this.bindManager()

    return this.manager.myPubkeyHex
  }

  /**
   * Matches Android's `close()`: closes only the mesh. Storage, HTTP and timers
   * remain usable until the page itself is unloaded.
   */
  close(): void {
    if (this.meshClosed) return

    this.meshClosed = true
    this.unbindManager()
    this.manager.close()
    this.currentPeers = []
    this.dispatch('coralie:peers', [])
  }

  storageGetItem(key: string): string | null {
    const normalizedKey = String(key)
    const storage = this.resolveLocalStorage()

    if (storage) {
      try {
        return storage.getItem(normalizedKey)
      } catch {
        // Fall through when storage is denied for this origin.
      }
    }

    return this.memoryStorage.get(normalizedKey) ?? null
  }

  storageSetItem(key: string, value: string): void {
    const normalizedKey = String(key)
    const normalizedValue = String(value)
    const storage = this.resolveLocalStorage()

    if (storage) {
      try {
        storage.setItem(normalizedKey, normalizedValue)
        return
      } catch {
        // Fall through when storage is denied for this origin.
      }
    }

    this.memoryStorage.set(normalizedKey, normalizedValue)
  }

  storageRemoveItem(key: string): void {
    const normalizedKey = String(key)
    const storage = this.resolveLocalStorage()

    if (storage) {
      try {
        storage.removeItem(normalizedKey)
      } catch {
        // Also clear the memory fallback below.
      }
    }

    this.memoryStorage.delete(normalizedKey)
  }

  /**
   * Browser transport matching Android's JSON request/response surface.
   *
   * Differences that are intrinsic to browsers:
   * - the method returns a Promise;
   * - CORS still applies;
   * - redirects use the browser's normal redirect handling.
   *
   * Non-permission failures are encoded as status 599, matching Android.
   */
  async httpRequestJson(requestJson: string): Promise<string> {
    const requestId = nextHttpRequestId++
    const startedAt = this.nowMs()

    let stage = 'parse-request'
    let method = 'UNKNOWN'
    let safeUrl = '(unparsed)'

    try {
      const request = this.parseHttpRequest(requestJson)
      method = request.method
      safeUrl = this.safeUrlForDiagnostic(request.url)

      stage = 'browser-fetch'
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : request.body ?? '',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
      })

      stage = 'read-response'
      const body = await this.readResponseBodyLimited(response)

      const result: HttpResponseData = {
        status: response.status,
        statusText: response.statusText,
        headers: this.headersToRecord(response.headers),
        body,
      }

      return JSON.stringify(result)
    } catch (error) {
      const elapsedMs = Math.max(0, this.nowMs() - startedAt)
      return JSON.stringify(
        this.httpFailureResponse(
          requestId,
          stage,
          method,
          safeUrl,
          elapsedMs,
          error,
        ),
      )
    }
  }

  timerQueue(
    id: string | null,
    delaySeconds: number,
    payload: string | null,
  ): string {
    if (
      !Number.isSafeInteger(delaySeconds) ||
      delaySeconds <= 0
    ) {
      throw new RangeError(
        'delaySeconds must be a positive integer',
      )
    }

    const timerId =
      id === null
        ? this.generateId()
        : String(id)
    const normalizedPayload =
      payload == null ? null : String(payload)

    this.timerCancel(timerId)

    const timer: BrowserTimer = {
      handle: null,
      deadlineMs: Date.now() + delaySeconds * 1000,
      payload: normalizedPayload,
    }

    this.timers.set(timerId, timer)
    this.scheduleTimer(timerId)
    return timerId
  }

  timerCancel(id: string): void {
    const normalizedId = String(id)
    const timer = this.timers.get(normalizedId)
    if (!timer) return

    if (timer.handle !== null) {
      clearTimeout(timer.handle)
    }
    this.timers.delete(normalizedId)
  }

  timerListJson(): string {
    const now = Date.now()
    const result: TimerInfo[] =
      [...this.timers.entries()].map(
        ([id, timer]) => ({
          id,
          remainingMs: Math.max(
            0,
            timer.deadlineMs - now,
          ),
        }),
      )

    return JSON.stringify(result)
  }

  private scheduleTimer(id: string): void {
    const timer = this.timers.get(id)
    if (!timer) return

    const remainingMs = timer.deadlineMs - Date.now()
    if (remainingMs <= 0) {
      this.fireTimer(id)
      return
    }

    timer.handle = setTimeout(
      () => this.scheduleTimer(id),
      Math.min(remainingMs, MAX_TIMEOUT_MS),
    )
  }

  private fireTimer(id: string): void {
    const timer = this.timers.get(id)
    if (!timer) return

    this.timers.delete(id)

    const detail: TimerFiredEventDetail = { id }
    if (timer.payload !== null) {
      detail.payload = timer.payload
    }

    this.dispatch('coralie:timerFired', detail)
  }

  private bindManager(): void {
    this.managerUnsubscribers = [
      this.manager.peers.subscribe((peers) => {
        this.currentPeers = this.normalisePeers(peers)
        this.dispatch(
          'coralie:peers',
          this.clonePeers(this.currentPeers),
        )
      }),
      this.manager.incomingMessages.subscribe((message) => {
        this.dispatch(
          'coralie:message',
          this.normaliseMessage(message),
        )
      }),
      this.manager.terminalFailures.subscribe((failure) => {
        this.dispatch(
          'coralie:terminalFailure',
          this.normaliseFailure(failure),
        )
      }),
    ]
  }

  private unbindManager(): void {
    for (const unsubscribe of this.managerUnsubscribers) {
      unsubscribe()
    }
    this.managerUnsubscribers = []
  }

  private normalisePeers(
    peers: Set<LiveMeshPeer>,
  ): MeshPeer[] {
    return [...peers].map((peer) => ({
      pubkeyHex: peer.pubkeyHex.toLowerCase(),
      connectedAt: peer.connectedAt ?? null,
    }))
  }

  private normaliseMessage(
    message: LivePeerMessage,
  ): PeerMessageEventDetail {
    return {
      fromPubkeyHex: String(message.from).toLowerCase(),
      toPubkeyHex: String(message.to).toLowerCase(),
      timestamp: Number(message.timestamp),
      payload: Array.from(
        this.normaliseIncomingPayload(message.payload),
      ),
    }
  }

  private normaliseFailure(
    failure: LiveTerminalFailure,
  ): TerminalFailureEventDetail {
    return {
      pubkeyHex: failure.pubkeyHex.toLowerCase(),
      attemptCount: failure.attemptCount,
      reason: failure.reason,
    }
  }

  private normaliseOutgoingPayload(
    payload: CoralieBytePayload,
  ): Uint8Array {
    if (
      !(payload instanceof Uint8Array) &&
      !Array.isArray(payload)
    ) {
      throw new TypeError(
        'payload must be a Uint8Array or integer array',
      )
    }

    return Uint8Array.from(payload, (value) => {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255
      ) {
        throw new RangeError(
          'payload[index] must be between 0 and 255',
        )
      }
      return value
    })
  }

  private normaliseIncomingPayload(
    payload: unknown,
  ): Uint8Array {
    if (payload instanceof Uint8Array) {
      return new Uint8Array(payload)
    }
    if (payload instanceof ArrayBuffer) {
      return new Uint8Array(payload)
    }
    if (ArrayBuffer.isView(payload)) {
      return new Uint8Array(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      )
    }
    if (Array.isArray(payload)) {
      return this.normaliseOutgoingPayload(payload)
    }

    throw new TypeError(
      'Incoming payload is not byte-compatible',
    )
  }

  private dispatch<T>(
    eventName: string,
    detail: T,
  ): void {
    window.dispatchEvent(
      new CustomEvent(eventName, { detail }),
    )
  }

  private clonePeers(peers: MeshPeer[]): MeshPeer[] {
    return peers.map((peer) => ({ ...peer }))
  }

  private resolveLocalStorage(): Storage | null {
    try {
      return window.localStorage || null
    } catch {
      return null
    }
  }

  private parseHttpRequest(
    requestJson: string,
  ): Required<HttpRequestData> {
    let parsed: unknown

    try {
      parsed = JSON.parse(requestJson)
    } catch (error) {
      throw new TypeError(
        `Invalid HTTP request JSON: ${String(error)}`,
      )
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new TypeError(
        'HTTP request must be an object',
      )
    }

    const request = parsed as HttpRequestData
    if (
      typeof request.url !== 'string' ||
      request.url.trim() === ''
    ) {
      throw new TypeError(
        'HTTP request url must be a non-empty string',
      )
    }

    let url: URL
    try {
      url = new URL(request.url.trim())
    } catch {
      throw new TypeError(
        'HTTP request url must be an absolute URL',
      )
    }

    if (url.protocol !== 'https:') {
      throw new TypeError(
        'Only https requests are allowed',
      )
    }

    const headers: Record<string, string> = {}
    if (request.headers !== undefined) {
      if (
        typeof request.headers !== 'object' ||
        request.headers === null ||
        Array.isArray(request.headers)
      ) {
        throw new TypeError(
          'HTTP request headers must be an object',
        )
      }

      for (
        const [name, value] of
        Object.entries(request.headers)
      ) {
        if (typeof value !== 'string') {
          throw new TypeError(
            `HTTP header ${name} must be a string`,
          )
        }
        headers[name] = value
      }
    }

    const body =
      request.body == null ? null : request.body
    if (
      body !== null &&
      typeof body !== 'string'
    ) {
      throw new TypeError(
        'HTTP request body must be a string or null',
      )
    }

    const method =
      (request.method || 'GET')
        .trim()
        .toUpperCase()
    if (method === '') {
      throw new TypeError(
        'HTTP request method must be non-empty',
      )
    }

    return {
      url: url.href,
      method,
      headers,
      body,
    }
  }

  private headersToRecord(
    headers: Headers,
  ): Record<string, string> {
    const result: Record<string, string> = {}

    headers.forEach((value, name) => {
      result[name] = value
    })

    return result
  }

  private async readResponseBodyLimited(
    response: Response,
  ): Promise<string> {
    const declaredHeader =
      response.headers.get('content-length')
    const declaredLength =
      declaredHeader == null
        ? -1
        : Number(declaredHeader)

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_HTTP_RESPONSE_BYTES
    ) {
      throw new ResponseTooLargeError(
        MAX_HTTP_RESPONSE_BYTES,
        declaredLength,
        true,
      )
    }

    const charset =
      this.resolveResponseCharset(response)
    const decoder = new TextDecoder(charset)

    if (!response.body) {
      const bytes =
        new Uint8Array(await response.arrayBuffer())

      if (
        bytes.byteLength >
        MAX_HTTP_RESPONSE_BYTES
      ) {
        throw new ResponseTooLargeError(
          MAX_HTTP_RESPONSE_BYTES,
          bytes.byteLength,
          false,
        )
      }

      return decoder.decode(bytes)
    }

    const reader = response.body.getReader()
    let observedBytes = 0
    let result = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        observedBytes += value.byteLength
        if (
          observedBytes >
          MAX_HTTP_RESPONSE_BYTES
        ) {
          await reader.cancel(
            'Response exceeds size limit',
          )
          throw new ResponseTooLargeError(
            MAX_HTTP_RESPONSE_BYTES,
            observedBytes,
            false,
          )
        }

        result += decoder.decode(
          value,
          { stream: true },
        )
      }

      result += decoder.decode()
      return result
    } finally {
      reader.releaseLock()
    }
  }

  private resolveResponseCharset(
    response: Response,
  ): string {
    const contentType =
      response.headers.get('content-type') || ''
    const match =
      /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i
        .exec(contentType)

    return match?.[1] || 'utf-8'
  }

  private httpFailureResponse(
    requestId: number,
    stage: string,
    method: string,
    safeUrl: string,
    elapsedMs: number,
    error: unknown,
  ): HttpResponseData {
    const normalized =
      error instanceof Error
        ? error
        : new Error(String(error))
    const category =
      this.classifyHttpFailure(normalized)

    const diagnostic: HttpFailureDiagnostic = {
      requestId,
      stage,
      category,
      method,
      url: safeUrl,
      elapsedMs,
      message:
        normalized.message ||
        normalized.name,
      exception: normalized.name,
      rootException: normalized.name,
      causeChain:
        `${normalized.name}: ${normalized.message}`,
    }

    if (
      normalized instanceof
      ResponseTooLargeError
    ) {
      diagnostic.limitBytes =
        normalized.limitBytes
      diagnostic.observedBytes =
        normalized.observedBytes
      diagnostic.declaredByServer =
        normalized.declaredByServer
    }

    return {
      status: 599,
      statusText:
        category === 'response-too-large'
          ? 'Browser response too large'
          : 'Browser HTTP failure',
      headers: {},
      body: JSON.stringify(diagnostic),
    }
  }

  private classifyHttpFailure(
    error: Error,
  ): string {
    if (
      error instanceof
      ResponseTooLargeError
    ) {
      return 'response-too-large'
    }

    if (error.name === 'AbortError') {
      return 'cancelled'
    }
    if (
      error instanceof TypeError &&
      /request|url|header|https|body|json/i
        .test(error.message)
    ) {
      return 'invalid-request'
    }
    if (error instanceof TypeError) {
      return 'network-io'
    }

    return 'internal'
  }

  private safeUrlForDiagnostic(
    rawUrl: string,
  ): string {
    try {
      const url = new URL(rawUrl)
      return (
        `${url.protocol}//${url.host}` +
        `${url.pathname || '/'}`
      )
    } catch {
      return '(unparsed)'
    }
  }

  private generateId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID ===
        'function'
    ) {
      return crypto.randomUUID()
    }

    return (
      `timer-${Date.now()}-` +
      Math.random().toString(16).slice(2)
    )
  }

  private assertPubkey(
    value: string,
    fieldName: string,
  ): void {
    if (!PUBKEY_PATTERN.test(value)) {
      throw new TypeError(
        `${fieldName} must be a ` +
          '64-character hexadecimal public key',
      )
    }
  }

  private assertMeshOpen(): void {
    if (this.meshClosed) {
      throw new Error(
        'Coralie mesh is closed',
      )
    }
  }

  private sendMessageError(
    name: CoralieSendMessageErrorName,
    message: string,
    target: string,
  ): CoralieSendMessageError {
    const error = new Error(message) as CoralieSendMessageError
    error.name = name
    error.operation = 'sendMessage'
    error.target = target
    return error
  }

  private nowMs(): number {
    return (
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    )
  }
}
