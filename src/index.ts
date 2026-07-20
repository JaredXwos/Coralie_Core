/**
 * Nostr + WebRTC Mesh — Public API
 * 
 * Phase 0: Only types and crypto are exported.
 * Phase 6 will export createLiveConnectionManager and public types.
 */

export type { LinkState, SessionDescriptionData, DataChannelFrame, PeerMessage, TerminalFailure, NostrEvent, UnsignedNostrEvent } from './types'
export { Signer } from './crypto/signer'
export { createStateFlow, createSharedFlow } from './core/emitter'
