/**
 * Root export surface.
 *
 * PROVISIONAL: per §5 of the architecture doc, the eventual public API
 * is meant to be just `createLiveConnectionManager()` plus a handful
 * of types — everything under `crypto/`, `nostr/`, and `webrtc/` is
 * supposed to be internal, never re-exported. That trim happens in
 * Phase 5 once the factory exists.
 *
 * Until then, this file re-exports every component's public surface
 * (interface + Live + Mock) so the package is usable end-to-end for
 * development, the browser demo, and early integration testing.
 */

// Shared data types
export * from './core/types'
export * from './mesh-endpoints'

// Core pub/sub primitives
export * from './core/state-flow'
export * from './core/shared-flow'

// Crypto
export * from './crypto/signer'

// Nostr layer
export * from './nostr/event-sink'
export * from './nostr/relay-socket'
export * from './nostr/relay-session'
export * from './nostr/signalling-client'

// WebRTC layer
export * from './webrtc/peer-connection'
export * from './webrtc/peer-link'
export * from './webrtc/initiator'
export * from './webrtc/answerer'
