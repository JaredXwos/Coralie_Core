import type { SharedFlow } from '../core/shared-flow'
import type { StateFlow } from '../core/state-flow'
import type { PeerMessage, Result, TerminalFailure } from '../core/types'

/**
 * Lightweight peer metadata exposed to the application.
 */
export interface MeshPeer {
  pubkeyHex: string
  connectedAt: number
}

/**
 * Orchestrator: implements the six core mesh rules (§2) and the concurrency
 * discipline (§4) that keeps the three disjoint state maps (`initiating`,
 * `answering`, and `connected`) consistent despite JavaScript's asynchronous
 * continuations.
 *
 * Single entry point to the mesh: the application calls `addPeer()` out-of-band
 * to seed initial connections, then observes the `peers` StateFlow and
 * `incomingMessages` SharedFlow for mesh convergence and data.
 *
 * Rules implemented:
 * - §2 rule 1: New pubkey → initiator (create offer, attempt 1)
 * - §2 rule 2: Answer unrelated peers concurrently; preserve same-peer initiator
 * - §2 rule 3: Inbound answer matched only to in-flight initiation
 * - §2 rule 4: Failure → retry up to 5 times, then terminal failure
 * - §2 rule 5: Connection open → add to `connected`, broadcast `announce`
 * - §2 rule 6: Connection close → remove from `connected`, no broadcast
 */
export interface LiveConnectionManager {
  readonly myPubkeyHex: string

  /** Current set of connected peers. Replays on subscribe. */
  readonly peers: StateFlow<Set<MeshPeer>>

  /**
   * Inbound peer-to-peer messages from any connected peer.
   * Emitted as they arrive on data channels.
   */
  readonly incomingMessages: SharedFlow<PeerMessage>

  /**
   * Terminal failures: peer connections that exhausted all 5 retries.
   * Emitted once per failed pubkey.
   */
  readonly terminalFailures: SharedFlow<TerminalFailure>

  /**
   * Add a peer pubkey via out-of-band mechanism (§2 rule 1).
   * If the pubkey is new, unknown, and not self: initiate a connection
   * attempt (create peer connection, send offer, start timeout clock).
   * If already initiating, answering, or connected: no-op (idempotent).
   * If self pubkey: ignored.
   */
  addPeer(pubkeyHex: string): void

  /**
   * Send a message to a connected peer.
   * If the peer is in `connected`, sends the payload over the data channel.
   * Returns failure when the manager is closed, the peer is unavailable, or
   * the data-channel send fails.
   */
  sendToPeer(toPubkeyHex: string, payload: Uint8Array): Result<void>

  /**
   * Close all connections and clean up resources.
   */
  close(): void
}
