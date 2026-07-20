/**
 * Core types for Nostr + WebRTC mesh.
 * 
 * Phase 0 types:
 * - LinkState: enum of connection states
 * - SessionDescriptionData: WebRTC SDP wrapper
 * - DataChannelFrame: message frame format
 * - PeerMessage: application-level message
 * - TerminalFailure: failure with pubkey and attempt count
 * - NostrEvent: signed Nostr event
 * - UnsignedNostrEvent: pre-signature event
 */

/**
 * State of a peer link connection.
 * 
 * Initiator side flow:
 *   Initiating → Offering → Connecting → Connected
 *                         ↘ Failed ↗
 * 
 * Answerer side flow:
 *   Answering → Answering → Connecting → Connected
 *                         ↘ Failed ↗
 */
export enum LinkState {
  Initiating = 'Initiating',
  Offering = 'Offering',
  Answering = 'Answering',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Failed = 'Failed',
  Closed = 'Closed',
}

/**
 * WebRTC Session Description Protocol wrapper.
 */
export interface SessionDescriptionData {
  type: 'offer' | 'answer'
  sdp: string
}

/**
 * Frame format for data channel communication.
 * 
 * Frames are JSON serialized across the WebRTC data channel.
 * Type discriminator determines the payload shape.
 */
export type DataChannelFrame =
  | { type: 'Offer'; sessionDescription: SessionDescriptionData; attemptCount: number }
  | { type: 'Answer'; sessionDescription: SessionDescriptionData }
  | { type: 'IceCandidate'; candidate: RTCIceCandidateInit }
  | { type: 'Announce'; pubkeys: string[] }
  | { type: 'Data'; payload: Uint8Array }

/**
 * Application-level message sent peer-to-peer.
 */
export interface PeerMessage {
  from: string // sender's pubkey hex
  to: string   // recipient's pubkey hex
  timestamp: number
  payload: unknown
}

/**
 * Terminal failure: a peer connection attempt exhausted all retries.
 */
export interface TerminalFailure {
  pubkeyHex: string
  attemptCount: number
  reason: string
}

/**
 * Nostr event (signed).
 */
export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/**
 * Nostr event before signing.
 */
export interface UnsignedNostrEvent {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}
