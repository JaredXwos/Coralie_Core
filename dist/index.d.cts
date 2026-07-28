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
    payload: Uint8Array;
}
/**
 * Terminal failure: a peer connection attempt exhausted all retries.
 */
interface TerminalFailure$1 {
    pubkeyHex: string;
    attemptCount: number;
    reason: string;
}

type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
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
interface PeerConnectionObserver {
    connectionState?: (state: PeerConnectionState) => void;
    iceConnectionState?: (state: RTCIceConnectionState) => void;
    iceGatheringState?: (state: RTCIceGatheringState) => void;
    iceCandidate?: (candidate: string | null) => void;
    signalingState?: (state: RTCSignalingState) => void;
}

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
 * Lightweight peer metadata exposed to the application.
 */
interface MeshPeer$1 {
    pubkeyHex: string;
    connectedAt: number;
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
interface LiveConnectionManager {
    readonly myPubkeyHex: string;
    /** Current set of connected peers. Replays on subscribe. */
    readonly peers: StateFlow<Set<MeshPeer$1>>;
    /**
     * Inbound peer-to-peer messages from any connected peer.
     * Emitted as they arrive on data channels.
     */
    readonly incomingMessages: SharedFlow<PeerMessage>;
    /**
     * Terminal failures: peer connections that exhausted all 5 retries.
     * Emitted once per failed pubkey.
     */
    readonly terminalFailures: SharedFlow<TerminalFailure$1>;
    /**
     * Add a peer pubkey via out-of-band mechanism (§2 rule 1).
     * If the pubkey is new, unknown, and not self: initiate a connection
     * attempt (create peer connection, send offer, start timeout clock).
     * If already initiating, answering, or connected: no-op (idempotent).
     * If self pubkey: ignored.
     */
    addPeer(pubkeyHex: string): void;
    /**
     * Send a message to a connected peer (best-effort).
     * If the peer is in `connected`, sends the payload over the data channel.
     * If not connected: dropped silently (no queue, no return of failure).
     */
    sendToPeer(toPubkeyHex: string, payload: Uint8Array): void;
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
    /**
     * Optional diagnostic observer factory. Called once per peer connection
     * attempt with the peer's pubkey and this side's role, returning an
     * observer whose handlers receive ICE/connection/candidate events. Purely
     * for logging/telemetry — has no effect on connection behavior. If omitted,
     * no diagnostic wiring is attached.
     */
    observerFactory?: (peerPubkeyHex: string, role: 'initiator' | 'answerer') => PeerConnectionObserver;
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

/** Browser and Android implementations expose API version 2. */
type CoralieHostKind = 'browser' | 'android-native';
interface MeshPeer {
    pubkeyHex: string;
    connectedAt: number | null;
}
/** JSON-compatible detail dispatched by `coralie:message`. */
interface PeerMessageEventDetail {
    fromPubkeyHex: string;
    toPubkeyHex: string;
    timestamp: number;
    payload: number[];
}
interface TerminalFailureEventDetail {
    pubkeyHex: string;
    attemptCount: number;
    reason?: string;
}
/** Compatibility name retained for Coralie-submodule consumers. */
type TerminalFailure = TerminalFailureEventDetail;
interface HttpRequestData {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
}
interface HttpResponseData {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string | null;
}
interface HttpFailureDiagnostic {
    requestId: number;
    stage: string;
    category: string;
    method: string;
    url: string;
    elapsedMs: number;
    message: string;
    exception: string;
    rootException: string;
    causeChain: string;
    limitBytes?: number;
    observedBytes?: number;
    declaredByServer?: boolean;
}
interface TimerInfo {
    id: string;
    remainingMs: number;
}
/** Android omits `payload` when the queued value was null. */
interface TimerFiredEventDetail {
    id: string;
    payload?: string;
}
type CoralieBytePayload = Uint8Array | readonly number[];
type MaybePromise<T> = T | Promise<T>;
/**
 * Flat page-facing API shared by Android's native bridge and the browser host.
 * Page code should use `await` for consumed return values because a host
 * method may be synchronous in one implementation and asynchronous in another.
 */
interface CoralieHost {
    apiVersion(): number;
    hostKind(): CoralieHostKind;
    getPubkey(): MaybePromise<string>;
    addPeer(pubkeyHex: string): MaybePromise<void>;
    sendMessage(toPubkeyHex: string, payload: CoralieBytePayload): MaybePromise<void>;
    getPeersJson(): MaybePromise<string>;
    reset(): MaybePromise<string>;
    close(): MaybePromise<void>;
    storageGetItem(key: string): MaybePromise<string | null>;
    storageSetItem(key: string, value: string): MaybePromise<void>;
    storageRemoveItem(key: string): MaybePromise<void>;
    httpRequestJson(requestJson: string): MaybePromise<string>;
    timerQueue(id: string | null, delaySeconds: number, payload: string | null): MaybePromise<string>;
    timerCancel(id: string): MaybePromise<void>;
    timerListJson(): MaybePromise<string>;
}
declare global {
    interface Window {
        Coralie: CoralieHost;
    }
    interface WindowEventMap {
        'coralie:peers': CustomEvent<MeshPeer[]>;
        'coralie:message': CustomEvent<PeerMessageEventDetail>;
        'coralie:terminalFailure': CustomEvent<TerminalFailureEventDetail>;
        'coralie:timerFired': CustomEvent<TimerFiredEventDetail>;
    }
}

type ManagerFactory = (options: CreateLiveConnectionManagerOptions) => LiveConnectionManager;
type FetchLike = typeof fetch;
/** Fixed decoded response ceiling shared with the Android native proxy. */
declare const MAX_HTTP_RESPONSE_BYTES: number;
/**
 * Browser implementation of Android's direct-native `window.Coralie` v2
 * contract.
 *
 * The browser intentionally has no page-capability or domain prompt API.
 * Android handles those decisions inside protected operations; the browser
 * assumes the operation is permitted.
 */
declare class BrowserCoralieHost implements CoralieHost {
    private manager;
    private readonly managerFactory;
    private readonly options;
    private readonly fetchImpl;
    private managerUnsubscribers;
    private currentPeers;
    private readonly memoryStorage;
    private readonly timers;
    private meshClosed;
    constructor(options?: CreateLiveConnectionManagerOptions, managerFactory?: ManagerFactory, fetchImpl?: FetchLike);
    apiVersion(): number;
    hostKind(): 'browser';
    getPubkey(): string;
    addPeer(pubkeyHex: string): void;
    sendMessage(toPubkeyHex: string, payload: CoralieBytePayload): void;
    getPeersJson(): string;
    reset(): string;
    /**
     * Matches Android's `close()`: closes only the mesh. Storage, HTTP and timers
     * remain usable until the page itself is unloaded.
     */
    close(): void;
    storageGetItem(key: string): string | null;
    storageSetItem(key: string, value: string): void;
    storageRemoveItem(key: string): void;
    /**
     * Browser transport matching Android's JSON request/response surface.
     *
     * Differences that are intrinsic to browsers:
     * - the method returns a Promise;
     * - CORS still applies;
     * - redirects use the browser's normal redirect handling.
     *
     * Non-permission failures are encoded as status 599, matching Android.
     */
    httpRequestJson(requestJson: string): Promise<string>;
    timerQueue(id: string | null, delaySeconds: number, payload: string | null): string;
    timerCancel(id: string): void;
    timerListJson(): string;
    private scheduleTimer;
    private fireTimer;
    private bindManager;
    private unbindManager;
    private normalisePeers;
    private normaliseMessage;
    private normaliseFailure;
    private normaliseOutgoingPayload;
    private normaliseIncomingPayload;
    private dispatch;
    private clonePeers;
    private resolveLocalStorage;
    private parseHttpRequest;
    private headersToRecord;
    private readResponseBodyLimited;
    private resolveResponseCharset;
    private httpFailureResponse;
    private classifyHttpFailure;
    private safeUrlForDiagnostic;
    private generateId;
    private assertPubkey;
    private assertMeshOpen;
    private nowMs;
}

/**
 * Installs the browser host only when the embedding environment has not
 * already supplied `window.Coralie`.
 *
 * Android injects its native object before page scripts execute. Loading the
 * browser host bundle in Android is therefore a true no-op: the existing
 * object is returned unchanged and is not validated, wrapped, or replaced.
 */
declare function installBrowserCoralie(options?: CreateLiveConnectionManagerOptions): CoralieHost | undefined;

export { BrowserCoralieHost, type CoralieBytePayload, type CoralieHost, type CoralieHostKind, type CreateLiveConnectionManagerOptions, type HttpFailureDiagnostic, type HttpRequestData, type HttpResponseData, LinkState, type LiveConnectionManager, type MeshPeer$1 as LiveMeshPeer, type PeerMessage as LivePeerMessage, type TerminalFailure$1 as LiveTerminalFailure, MAX_HTTP_RESPONSE_BYTES, type MaybePromise, type MeshPeer, type PeerMessageEventDetail, type SharedFlow, type StateFlow, type TerminalFailure, type TerminalFailureEventDetail, type TimerFiredEventDetail, type TimerInfo, createLiveConnectionManager, installBrowserCoralie };
