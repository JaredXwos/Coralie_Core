import { describe, expect, it } from 'vitest'

import type {
  CoralieHost,
  CoralieSendMessageError,
  CoralieSendMessageErrorName,
  TerminalFailure,
  TerminalFailureEventDetail,
} from './index'

/**
 * Build-output test: verifies that the published root entry point exposes the
 * documented Coralie v2 and connection-manager runtime surface without
 * leaking implementation modules.
 *
 * Type-only exports are checked by the imports above. A missing type export
 * causes TypeScript or the DTS build to fail before these tests run.
 */
describe('exports (build-output test)', () => {
  it('should expose the structural send-message error types', () => {
    const name: CoralieSendMessageErrorName = 'PeerUnavailableError'
    const error: CoralieSendMessageError | null = null

    expect(name).toBe('PeerUnavailableError')
    expect(error).toBeNull()
  })

  it('should export the connection-manager factory', async () => {
    const mod = await import('../dist/index.js')
    expect(typeof mod.createLiveConnectionManager).toBe('function')
  })

  it('should export the Coralie browser host runtime', async () => {
    const mod = await import('../dist/index.js')

    expect(typeof mod.BrowserCoralieHost).toBe('function')
    expect(typeof mod.installBrowserCoralie).toBe('function')
    expect(mod.MAX_HTTP_RESPONSE_BYTES).toBe(64 * 1024 * 1024)
  })

  it('should export the LinkState enum', async () => {
    const mod = await import('../dist/index.js')

    expect(mod.LinkState).toBeDefined()
    expect(typeof mod.LinkState.Connected).toBe('string')
    expect(mod.LinkState.Offering).toBe('Offering')
  })

  it('should not export internal Signer modules', async () => {
    const mod = await import('../dist/index.js')

    expect((mod as Record<string, unknown>)['LiveSigner']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockSigner']).toBeUndefined()
  })

  it('should not export internal Nostr modules', async () => {
    const mod = await import('../dist/index.js')

    expect((mod as Record<string, unknown>)['LiveRelaySocket']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockRelaySocket']).toBeUndefined()
    expect((mod as Record<string, unknown>)['LiveRelaySession']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockRelaySession']).toBeUndefined()
    expect((mod as Record<string, unknown>)['LiveNostrSignallingClient']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockNostrSignallingClient']).toBeUndefined()
    expect((mod as Record<string, unknown>)['LiveEventSink']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockEventSink']).toBeUndefined()
  })

  it('should not export internal WebRTC modules', async () => {
    const mod = await import('../dist/index.js')

    expect((mod as Record<string, unknown>)['LivePeerConnection']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockPeerConnection']).toBeUndefined()
    expect((mod as Record<string, unknown>)['LiveInitiator']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockInitiator']).toBeUndefined()
    expect((mod as Record<string, unknown>)['LiveAnswerer']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockAnswerer']).toBeUndefined()
    expect((mod as Record<string, unknown>)['LivePeerLink']).toBeUndefined()
    expect((mod as Record<string, unknown>)['MockPeerLink']).toBeUndefined()
  })

  it('should not export mutable core-flow implementations', async () => {
    const mod = await import('../dist/index.js')

    expect((mod as Record<string, unknown>)['createStateFlow']).toBeUndefined()
    expect((mod as Record<string, unknown>)['createSharedFlow']).toBeUndefined()
  })

  it('should not export the connection-manager implementation class', async () => {
    const mod = await import('../dist/index.js')

    // LiveConnectionManager is a TypeScript interface and must not become a
    // runtime implementation export.
    expect((mod as Record<string, unknown>)['LiveConnectionManager']).toBeUndefined()
  })

  it('should list exactly the runtime-visible exports', async () => {
    const mod = await import('../dist/index.js')
    const exportedKeys = Object.keys(mod).sort()

    const expectedExports = [
      'BrowserCoralieHost',
      'LinkState',
      'MAX_HTTP_RESPONSE_BYTES',
      'createLiveConnectionManager',
      'installBrowserCoralie',
    ].sort()

    expect(exportedKeys).toEqual(expectedExports)
  })

  it('should expose compatible terminal-failure event type names', () => {
    const failure: TerminalFailure = {
      pubkeyHex: 'a'.repeat(64),
      attemptCount: 5,
      reason: 'retry limit reached',
    }

    const eventDetail: TerminalFailureEventDetail = failure
    expect(eventDetail.attemptCount).toBe(5)
  })

  it('should expose the CoralieHost interface to consumers', () => {
    // The assignment is intentionally compile-time focused. If CoralieHost is
    // missing from the root declaration output, this test file cannot compile.
    const host: CoralieHost | null = null
    expect(host).toBeNull()
  })
})
