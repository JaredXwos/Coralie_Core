/**
 * SharedFlow: hot observable broadcasting events with no replay —
 * subscribers only see events emitted after they subscribed. Inspired
 * by Kotlin's `SharedFlow`.
 */
interface SharedFlow<T> {
    subscribe(listener: (value: T) => void): () => void;
}

/**
 * StateFlow: hot observable holding latest value, replays it to new
 * subscribers, then emits every subsequent change. Inspired by
 * Kotlin's `StateFlow`.
 */
interface StateFlow<T> {
    readonly value: T;
    subscribe(listener: (value: T) => void): () => void;
}

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
declare enum LinkState {
    Initiating = "Initiating",
    Offering = "Offering",
    Answering = "Answering",
    Connecting = "Connecting",
    Connected = "Connected",
    Failed = "Failed",
    Closed = "Closed"
}
/**
 * Application-level message sent peer-to-peer.
 */
interface PeerMessage {
    from: string;
    to: string;
    timestamp: number;
    payload: unknown;
}
/**
 * Terminal failure: a peer connection attempt exhausted all retries.
 */
interface TerminalFailure {
    pubkeyHex: string;
    attemptCount: number;
    reason: string;
}

/**
 * Lightweight peer metadata exposed to the application.
 */
interface MeshPeer {
    pubkeyHex: string;
    connectedAt: number;
}
/**
 * Orchestrator: implements the six core mesh rules (§2) and the concurrency
 * discipline (§4) that keeps the two disjoint state maps (`initiating` and
 * `connected`) consistent despite JavaScript's asynchronous continuations.
 *
 * Single entry point to the mesh: the application calls `addPeer()` out-of-band
 * to seed initial connections, then observes the `peers` StateFlow and
 * `incomingMessages` SharedFlow for mesh convergence and data.
 *
 * Rules implemented:
 * - §2 rule 1: New pubkey → initiator (create offer, attempt 1)
 * - §2 rule 2: Always open to answering, gated by empty `initiating`
 * - §2 rule 3: Inbound answer matched only to in-flight initiation
 * - §2 rule 4: Failure → retry up to 5 times, then terminal failure
 * - §2 rule 5: Connection open → add to `connected`, broadcast `Announce`
 * - §2 rule 6: Connection close → remove from `connected`, no broadcast
 */
interface LiveConnectionManager {
    readonly myPubkeyHex: string;
    /** Current set of connected peers. Replays on subscribe. */
    readonly peers: StateFlow<Set<MeshPeer>>;
    /**
     * Inbound peer-to-peer messages from any connected peer.
     * Emitted as they arrive on data channels.
     */
    readonly incomingMessages: SharedFlow<PeerMessage>;
    /**
     * Terminal failures: peer connections that exhausted all 5 retries.
     * Emitted once per failed pubkey.
     */
    readonly terminalFailures: SharedFlow<TerminalFailure>;
    /**
     * Add a peer pubkey via out-of-band mechanism (§2 rule 1).
     * If the pubkey is new, unknown, and not self: initiate a connection
     * attempt (create peer connection, send offer, start timeout clock).
     * If already initiating or connected: no-op (idempotent).
     * If self pubkey: ignored.
     */
    addPeer(pubkeyHex: string): void;
    /**
     * Send a message to a connected peer (best-effort).
     * If the peer is in `connected`, sends the payload over the data channel.
     * If not connected: dropped silently (no queue, no return of failure).
     */
    sendToPeer(toPubkeyHex: string, payload: unknown): void;
    /**
     * Close all connections and clean up resources.
     */
    close(): void;
}

/**
 * Options for creating a connection manager instance.
 */
interface CreateLiveConnectionManagerOptions {
    /**
     * Relay URLs for Nostr signalling. If omitted, uses DEFAULT_MESH_ENDPOINTS.relayUrls.
     * If provided, overrides the default list entirely (not merged).
     */
    relayUrls?: string[];
    /**
     * ICE servers for WebRTC peer connections. If omitted, uses DEFAULT_MESH_ENDPOINTS.iceServers.
     * If provided, overrides the default list entirely (not merged).
     */
    iceServers?: RTCIceServer[];
    /**
     * Optional timeout for handshake negotiations (milliseconds).
     * Defaults to 30000 (30s).
     */
    handshakeTimeoutMs?: number;
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
declare function createLiveConnectionManager(options?: CreateLiveConnectionManagerOptions): LiveConnectionManager;

export { type CreateLiveConnectionManagerOptions, LinkState, type LiveConnectionManager, type MeshPeer, type PeerMessage, type SharedFlow, type StateFlow, type TerminalFailure, createLiveConnectionManager };
