import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type {
  LiveConnectionManager,
  MeshPeer as LiveMeshPeer,
} from '../connection/live-connection-manager.interface'
import type {
  PeerMessage,
  TerminalFailure as LiveTerminalFailure,
} from '../core/types'
import { createMockSharedFlow } from '../core/shared-flow/shared-flow.mock'
import { createMockStateFlow } from '../core/state-flow/state-flow.mock'
import type {
  HttpResponseData,
  PeerMessageEventDetail,
} from './coralie-host.interface'
import {
  BrowserCoralieHost,
  MAX_HTTP_RESPONSE_BYTES,
} from './browser-coralie-host'

type CapturedEvent = {
  type: string
  detail: unknown
}

class TestCustomEvent<T> {
  readonly type: string
  readonly detail: T

  constructor(type: string, init: { detail: T }) {
    this.type = type
    this.detail = init.detail
  }
}

function createManagerFixture(initialPeers: LiveMeshPeer[] = []) {
  const peers = createMockStateFlow<Set<LiveMeshPeer>>(
    new Set(initialPeers),
  )
  const messages = createMockSharedFlow<PeerMessage>()
  const failures = createMockSharedFlow<LiveTerminalFailure>()
  const sent: Array<{
    toPubkeyHex: string
    payload: number[]
  }> = []

  const manager: LiveConnectionManager = {
    myPubkeyHex: 'a'.repeat(64),
    peers,
    incomingMessages: messages,
    terminalFailures: failures,
    addPeer: vi.fn(),
    sendToPeer(toPubkeyHex, payload) {
      sent.push({
        toPubkeyHex,
        payload: Array.from(payload as Uint8Array),
      })
    },
    close: vi.fn(),
  }

  return {
    failures,
    manager,
    messages,
    peers,
    sent,
  }
}

function createHeadersWithoutEntries(
  values: Record<string, string>,
): Pick<Headers, 'forEach' | 'get'> {
  const normalized = new Map(
    Object.entries(values).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  )

  return {
    get(name: string) {
      return normalized.get(name.toLowerCase()) ?? null
    },

    forEach(callback) {
      for (const [name, value] of normalized) {
        callback(value, name, this as Headers)
      }
    },
  }
}

function createResponseWithoutIterableHeaders(
  body: string,
  headers: Record<string, string>,
): Response {
  const encoded = new TextEncoder().encode(body)

  return {
    status: 200,
    statusText: 'OK',
    headers: createHeadersWithoutEntries(headers) as Headers,
    body: null,
    arrayBuffer: async () =>
      encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      ),
  } as Response
}

describe('BrowserCoralieHost', () => {
  const capturedEvents: CapturedEvent[] = []
  const storage = new Map<string, string>()

  beforeEach(() => {
    capturedEvents.length = 0
    storage.clear()

    vi.stubGlobal('CustomEvent', TestCustomEvent)
    vi.stubGlobal('window', {
      localStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null
        },
        setItem(key: string, value: string) {
          storage.set(key, value)
        },
        removeItem(key: string) {
          storage.delete(key)
        },
      },
      dispatchEvent(event: CapturedEvent) {
        capturedEvents.push(event)
        return true
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes API version 2 and JSON peer snapshots', () => {
    const peer: LiveMeshPeer = {
      pubkeyHex: 'B'.repeat(64),
      connectedAt: 123,
    }
    const fixture = createManagerFixture([peer])
    const host = new BrowserCoralieHost({}, () => fixture.manager)

    expect(host.apiVersion()).toBe(2)
    expect(host.hostKind()).toBe('browser')
    expect(JSON.parse(host.getPeersJson())).toEqual([
      {
        pubkeyHex: 'b'.repeat(64),
        connectedAt: 123,
      },
    ])
  })

  it('normalizes outgoing and incoming message payloads', () => {
    const peerKey = 'b'.repeat(64)
    const fixture = createManagerFixture([
      {
        pubkeyHex: peerKey,
        connectedAt: 123,
      },
    ])
    const host = new BrowserCoralieHost({}, () => fixture.manager)

    host.sendMessage(peerKey, new Uint8Array([1, 2, 255]))

    expect(fixture.sent).toEqual([
      {
        toPubkeyHex: peerKey,
        payload: [1, 2, 255],
      },
    ])

    fixture.messages.emit({
      from: peerKey,
      to: fixture.manager.myPubkeyHex,
      timestamp: 42,
      payload: new Uint8Array([7, 8]),
    })

    const messageEvent = capturedEvents.find(
      (event) => event.type === 'coralie:message',
    )

    expect(messageEvent?.detail).toEqual({
      fromPubkeyHex: peerKey,
      toPubkeyHex: fixture.manager.myPubkeyHex,
      timestamp: 42,
      payload: [7, 8],
    } satisfies PeerMessageEventDetail)
  })

  it('converts response headers without requiring entries()', async () => {
    const fixture = createManagerFixture()
    const fetchMock = vi.fn(async () =>
      createResponseWithoutIterableHeaders('hello', {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Coralie-Test': 'present',
      }),
    ) as unknown as typeof fetch

    const host = new BrowserCoralieHost(
      {},
      () => fixture.manager,
      fetchMock,
    )

    const response = JSON.parse(
      await host.httpRequestJson(
        JSON.stringify({
          url: 'https://example.com/data',
          method: 'GET',
          headers: {
            Accept: 'text/plain',
          },
          body: 'ignored for GET',
        }),
      ),
    ) as HttpResponseData

    expect(response).toEqual({
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-coralie-test': 'present',
      },
      body: 'hello',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/data',
      expect.objectContaining({
        body: undefined,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
      }),
    )
  })

  it('returns status 599 for an oversized declared response', async () => {
    const fixture = createManagerFixture()
    const fetchMock = vi.fn(async () =>
      ({
        status: 200,
        statusText: 'OK',
        headers: createHeadersWithoutEntries({
          'content-length': String(
            MAX_HTTP_RESPONSE_BYTES + 1,
          ),
        }) as Headers,
        body: null,
        arrayBuffer: vi.fn(),
      }) as unknown as Response,
    ) as unknown as typeof fetch

    const host = new BrowserCoralieHost(
      {},
      () => fixture.manager,
      fetchMock,
    )

    const response = JSON.parse(
      await host.httpRequestJson(
        JSON.stringify({
          url: 'https://example.com/large',
        }),
      ),
    ) as HttpResponseData

    expect(response.status).toBe(599)

    const diagnostic = JSON.parse(response.body ?? '{}')
    expect(diagnostic).toMatchObject({
      category: 'response-too-large',
      limitBytes: MAX_HTTP_RESPONSE_BYTES,
      observedBytes: MAX_HTTP_RESPONSE_BYTES + 1,
      declaredByServer: true,
    })
  })

  it('generates a timer ID only when the ID is null', () => {
    const fixture = createManagerFixture()
    const host = new BrowserCoralieHost({}, () => fixture.manager)

    const generatedId = host.timerQueue(null, 30, null)
    const emptyId = host.timerQueue('', 30, null)

    expect(generatedId).not.toBe('')
    expect(emptyId).toBe('')
    expect(JSON.parse(host.timerListJson())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: generatedId }),
        expect.objectContaining({ id: '' }),
      ]),
    )
  })

  it('keeps storage usable after the mesh is closed', () => {
    const fixture = createManagerFixture()
    const host = new BrowserCoralieHost({}, () => fixture.manager)

    host.close()

    host.storageSetItem('key', 'value')
    expect(host.storageGetItem('key')).toBe('value')
    expect(() => host.getPubkey()).toThrow('Coralie mesh is closed')
  })
})
