/**
 * Connection lifecycle state for a single peer link.
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
  to: string // recipient's pubkey hex
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

/**
 * Lightweight `Result` type, mirroring the Kotlin reference's use of
 * `Result<T>` for fallible operations (e.g. a relay send that may be
 * rejected because the socket isn't open).
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
