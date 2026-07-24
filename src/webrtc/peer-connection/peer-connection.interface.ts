import type { SessionDescriptionData } from '../../core/types'

/**
 * Minimal subset of `RTCDataChannel` this module depends on, so tests
 * can inject an in-memory mock instead of a real browser data channel.
 */
export interface DataChannelLike {
  readonly label: string
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed'
  onopen: (() => void) | null
  onclose: (() => void) | null
  onmessage: ((ev: { data: Uint8Array }) => void) | null
  send(data: Uint8Array): void
  close(): void
}

export type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

/**
 * Optional diagnostic hooks for observing the internal WebRTC lifecycle.
 * All handlers are optional; unset ones are simply not called. This exists
 * purely for logging/telemetry and does not affect connection behavior.
 *
 * `iceCandidate` reports each gathered local candidate string (or null at
 * end-of-gathering). `iceConnectionState` and `iceGatheringState` mirror the
 * underlying RTCPeerConnection states, which the non-trickle contract
 * otherwise hides from callers.
 */
export interface PeerConnectionObserver {
  connectionState?: (state: PeerConnectionState) => void
  iceConnectionState?: (state: RTCIceConnectionState) => void
  iceGatheringState?: (state: RTCIceGatheringState) => void
  iceCandidate?: (candidate: string | null) => void
  signalingState?: (state: RTCSignalingState) => void
}

/**
 * Minimal subset of `RTCPeerConnection` this module depends on.
 *
 * Deliberately non-trickle: `createOffer()`/`createAnswer()` are
 * expected to resolve only once ICE gathering has completed, so a
 * single SDP exchange carries every candidate — no separate
 * `IceCandidate` signalling message is needed. This matches a small
 * out-of-band mesh's priorities (§1: "speed over generality", fewer
 * round trips) better than trickle ICE would.
 */
export interface PeerConnectionLike {
  readonly connectionState: PeerConnectionState
  onconnectionstatechange: (() => void) | null
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null
  createDataChannel(label: string): DataChannelLike
  /** Creates an offer, sets it as the local description, and resolves once ICE gathering completes. */
  createOffer(): Promise<SessionDescriptionData>
  /** Creates an answer, sets it as the local description, and resolves once ICE gathering completes. */
  createAnswer(): Promise<SessionDescriptionData>
  setRemoteDescription(desc: SessionDescriptionData): Promise<void>
  close(): void
}

export type PeerConnectionFactory = (observer?: PeerConnectionObserver) => PeerConnectionLike
