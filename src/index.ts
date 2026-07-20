/**
 * Root export surface (Phase 5).
 *
 * Per §5 of the architecture doc, the public API is:
 * - `createLiveConnectionManager()` — factory function
 * - `LiveConnectionManager` — orchestrator interface
 * - `MeshPeer` — lightweight peer metadata
 * - `PeerMessage` — application-level message type
 * - `TerminalFailure` — retry exhaustion event
 * - `CreateLiveConnectionManagerOptions` — factory configuration
 *
 * Everything under `crypto/`, `nostr/`, and `webrtc/` is internal.
 * Development, testing, and examples use this single entry point.
 */

// Factory and public API
export { createLiveConnectionManager } from './create-live-connection-manager'
export type { CreateLiveConnectionManagerOptions } from './create-live-connection-manager'

// Orchestrator interface and lightweight types
export type { LiveConnectionManager, MeshPeer } from './connection/live-connection-manager.interface'

// Application-level types and enums
export { LinkState } from './core/types'
export type { PeerMessage, TerminalFailure } from './core/types'

// Shared flow for observing events
export type { StateFlow } from './core/state-flow'
export type { SharedFlow } from './core/shared-flow'
