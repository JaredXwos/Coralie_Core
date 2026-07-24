import type { PeerConnectionObserver } from './webrtc/peer-connection'
import type { LiveConnectionManager } from './connection/live-connection-manager.interface'
import { LiveConnectionManager as LiveConnectionManagerImpl } from './connection/live-connection-manager'
import { LiveNostrSignallingClient } from './nostr/signalling-client/signalling-client.live'
import { LiveSigner } from './crypto/signer/signer.live'
import { LivePeerConnection } from './webrtc/peer-connection/peer-connection.live'
import { DEFAULT_MESH_ENDPOINTS } from './mesh-endpoints'

/**
 * Options for creating a connection manager instance.
 */
export interface CreateLiveConnectionManagerOptions {
  /**
   * Relay URLs for Nostr signalling. If omitted, uses DEFAULT_MESH_ENDPOINTS.relayUrls.
   * If provided, overrides the default list entirely (not merged).
   */
  relayUrls?: string[]

  /**
   * ICE servers for WebRTC peer connections. If omitted, uses DEFAULT_MESH_ENDPOINTS.iceServers.
   * If provided, overrides the default list entirely (not merged).
   */
  iceServers?: RTCIceServer[]

  /**
   * Optional timeout for handshake negotiations (milliseconds).
   * Defaults to 30000 (30s).
   */
  handshakeTimeoutMs?: number

  /**
   * Optional diagnostic observer factory. Called once per peer connection
   * attempt with the peer's pubkey and this side's role, returning an
   * observer whose handlers receive ICE/connection/candidate events. Purely
   * for logging/telemetry — has no effect on connection behavior. If omitted,
   * no diagnostic wiring is attached.
   */
  observerFactory?: (
    peerPubkeyHex: string,
    role: 'initiator' | 'answerer',
  ) => PeerConnectionObserver
}

/**
 * Creates and wires a LiveConnectionManager instance with default or provided options.
 *
 * - Generates a fresh Signer (new keypair) for this instance
 * - Uses provided relay/ICE lists or falls back to defaults (not merged)
 * - Constructs the signalling client to connect to relays
 * - Returns a ready-to-use orchestrator
 *
 * Each call produces a distinct identity (new public key); callers that need
 * a stable identity across multiple manager instances must generate a Signer
 * externally and pass a custom signalling client.
 */
export function createLiveConnectionManager(
  options: CreateLiveConnectionManagerOptions = {},
): LiveConnectionManager {
  // Resolve relay and ICE server lists
  const relayUrls = options.relayUrls ?? DEFAULT_MESH_ENDPOINTS.relayUrls
  const iceServers = options.iceServers ?? DEFAULT_MESH_ENDPOINTS.iceServers

  // Generate a fresh signer (new keypair) for this instance
  const signer = LiveSigner.generate()

  // Construct the signalling client with the relay list and signer
  const signalingClient = new LiveNostrSignallingClient(signer, relayUrls)

  // Create a peer connection factory with the configured ICE servers
  const peerConnectionFactory = () =>
    new LivePeerConnection(new RTCPeerConnection({ iceServers }))

  // Construct and return the orchestrator
  const manager = new LiveConnectionManagerImpl(
    signalingClient,
    peerConnectionFactory,
    options.handshakeTimeoutMs,
    options.observerFactory,
  )

  return manager
}
