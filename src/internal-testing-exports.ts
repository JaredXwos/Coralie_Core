/**
 * Internal re-export surface — for `examples/demo.html` and Playwright
 * e2e tests ONLY. Never shipped as the package's public entry point.
 *
 * Phase 5 trimmed `src/index.ts` down to the public API
 * (`createLiveConnectionManager`, `LinkState`, etc.) and `exports.test.ts`
 * guards `dist/index.js` against leaking internals. This file is a
 * second, separate tsup entry (see `tsup.config.ts`) that builds to
 * `dist/internal-testing.global.js` — it exists so the demo page and
 * Phase 6 harness can reach the crypto/nostr/webrtc internals directly
 * (real signer, real relay socket, real initiator/answerer, real
 * connection-manager class with an injectable SignallingClient) without
 * reopening the public surface that `dist/index.global.js` ships.
 *
 * Do not import this file from `src/index.ts`.
 */

// Crypto
export { LiveSigner } from './crypto/signer'

// Nostr / signalling
export { LiveRelaySocket, RelaySocketState } from './nostr/relay-socket'
export { LiveRelaySession } from './nostr/relay-session'
export { LiveNostrSignallingClient } from './nostr/signalling-client'
export type { SignallingClient } from './nostr/signalling-client'

// WebRTC
export { LiveInitiator } from './webrtc/initiator'
export { LiveAnswerer } from './webrtc/answerer'
export { createLivePeerConnectionFactory } from './webrtc/peer-connection'
export type { PeerConnectionFactory } from './webrtc/peer-connection'

// Orchestrator (class, not just the interface) — lets the test harness
// construct a manager with a mock/injected SignallingClient the way
// the unit tests do, instead of going through the public factory.
export { LiveConnectionManager } from './connection'

// Defaults + shared enums
export { DEFAULT_MESH_ENDPOINTS } from './mesh-endpoints'
export { LinkState } from './core/types'
