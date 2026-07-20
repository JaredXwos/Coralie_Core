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
 * WebRTC Session Description Protocol wrapper.
 */
interface SessionDescriptionData {
    type: 'offer' | 'answer';
    sdp: string;
}
/**
 * Frame format for data channel communication.
 *
 * Frames are JSON serialized across the WebRTC data channel.
 * Type discriminator determines the payload shape.
 */
type DataChannelFrame = {
    type: 'Offer';
    sessionDescription: SessionDescriptionData;
    attemptCount: number;
} | {
    type: 'Answer';
    sessionDescription: SessionDescriptionData;
} | {
    type: 'IceCandidate';
    candidate: RTCIceCandidateInit;
} | {
    type: 'Announce';
    pubkeys: string[];
} | {
    type: 'Data';
    payload: Uint8Array;
};
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
 * Nostr event (signed).
 */
interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
}
/**
 * Nostr event before signing.
 */
interface UnsignedNostrEvent {
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
}
/**
 * Lightweight `Result` type, mirroring the Kotlin reference's use of
 * `Result<T>` for fallible operations (e.g. a relay send that may be
 * rejected because the socket isn't open).
 */
type Result<T, E = Error> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
declare function ok<T>(value: T): Result<T, never>;
declare function err<E>(error: E): Result<never, E>;

/** Default relay + ICE endpoints. Overridable wherever they're consumed. */
declare const DEFAULT_MESH_ENDPOINTS: {
    relayUrls: string[];
    iceServers: {
        urls: string[];
    }[];
};

/**
 * StateFlow: hot observable holding latest value, replays it to new
 * subscribers, then emits every subsequent change. Inspired by
 * Kotlin's `StateFlow`.
 */
interface StateFlow<T> {
    readonly value: T;
    subscribe(listener: (value: T) => void): () => void;
}
/** A StateFlow whose value can be set, driving notifications. */
interface MutableStateFlow<T> extends StateFlow<T> {
    value: T;
    /** Exposes this flow as a read-only view (no `.value` setter). */
    asReadOnly(): StateFlow<T>;
}

declare class LiveStateFlow<T> implements MutableStateFlow<T> {
    private current;
    private readonly listeners;
    constructor(initial: T);
    get value(): T;
    set value(next: T);
    subscribe(listener: (value: T) => void): () => void;
    asReadOnly(): StateFlow<T>;
}
declare function createStateFlow<T>(initial: T): LiveStateFlow<T>;

/**
 * A StateFlow test double with the same replay/notify semantics as
 * {@link LiveStateFlow}, plus extra inspection hooks (`history`,
 * `listenerCount`) useful for asserting on subscriber behavior in
 * tests without reaching into private fields of a real flow.
 */
declare class MockStateFlow<T> implements MutableStateFlow<T> {
    private current;
    /** Every value this flow has held, in order, including the initial one. */
    readonly history: T[];
    private readonly listeners;
    constructor(initial: T);
    get value(): T;
    set value(next: T);
    /** Number of currently-active subscribers. */
    get listenerCount(): number;
    subscribe(listener: (value: T) => void): () => void;
    asReadOnly(): StateFlow<T>;
}
declare function createMockStateFlow<T>(initial: T): MockStateFlow<T>;

/**
 * SharedFlow: hot observable broadcasting events with no replay —
 * subscribers only see events emitted after they subscribed. Inspired
 * by Kotlin's `SharedFlow`.
 */
interface SharedFlow<T> {
    subscribe(listener: (value: T) => void): () => void;
}
/** A SharedFlow that can be emitted into, driving subscriber delivery. */
interface MutableSharedFlow<T> extends SharedFlow<T> {
    emit(value: T): void;
    /** Exposes this flow as a read-only view (no `.emit()`). */
    asReadOnly(): SharedFlow<T>;
}

declare class LiveSharedFlow<T> implements MutableSharedFlow<T> {
    private readonly listeners;
    emit(value: T): void;
    subscribe(listener: (value: T) => void): () => void;
    asReadOnly(): SharedFlow<T>;
}
declare function createSharedFlow<T>(): LiveSharedFlow<T>;

/**
 * A SharedFlow test double with the same fan-out semantics as
 * {@link LiveSharedFlow}, plus an `emissions` history for assertions
 * that don't want to wire up their own subscriber.
 */
declare class MockSharedFlow<T> implements MutableSharedFlow<T> {
    /** Every value ever emitted, in order. */
    readonly emissions: T[];
    private readonly listeners;
    emit(value: T): void;
    get listenerCount(): number;
    subscribe(listener: (value: T) => void): () => void;
    asReadOnly(): SharedFlow<T>;
}
declare function createMockSharedFlow<T>(): MockSharedFlow<T>;

/**
 * Identity + signing/encryption operations needed by the Nostr and
 * WebRTC layers. Deliberately thin — every method is a pass-through to
 * an audited library implementation (see `signer.live.ts`), never a
 * hand-rolled primitive (§1: "ecosystem-aligned crypto").
 */
interface Signer {
    readonly pubkeyHex: string;
    /** Builds and signs an event with this identity's key. */
    sign(kind: number, tags: string[][], content: string, createdAt?: number): NostrEvent;
    /** Validates an event's id hash and signature. */
    verify(event: NostrEvent): boolean;
    /**
     * Derives the shared NIP-44 conversation key with another pubkey.
     * Symmetric: `A.getConvoKey(B.pubkeyHex) === B.getConvoKey(A.pubkeyHex)`.
     */
    getConvoKey(theirPubkeyHex: string): Uint8Array;
    /** NIP-44 v2 encrypt, given a conversation key from {@link getConvoKey}. */
    encryptNip44(plaintext: string, convoKey: Uint8Array): string;
    /** NIP-44 v2 decrypt, given a conversation key from {@link getConvoKey}. */
    decryptNip44(payload: string, convoKey: Uint8Array): string;
}

/**
 * Thin wrapper over `nostr-tools/pure` and `nostr-tools/nip44`.
 *
 * Deliberately does not hand-roll any cryptographic primitive — see
 * §1 of the architecture doc ("ecosystem-aligned crypto"). Everything
 * here is a direct pass-through to the audited library so this port
 * stays byte-for-byte interoperable with other Nostr clients.
 */
declare class LiveSigner implements Signer {
    private readonly secretKey;
    readonly pubkeyHex: string;
    private constructor();
    /** Generates a fresh random identity. No persistence, no restore path. */
    static generate(): LiveSigner;
    /** Builds an identity from an existing 32-byte secret key. */
    static fromSecretKey(secretKey: Uint8Array): LiveSigner;
    sign(kind: number, tags: string[][], content: string, createdAt?: number): NostrEvent;
    verify(event: NostrEvent): boolean;
    getConvoKey(theirPubkeyHex: string): Uint8Array;
    encryptNip44(plaintext: string, convoKey: Uint8Array): string;
    decryptNip44(payload: string, convoKey: Uint8Array): string;
}

/**
 * A `Signer` test double with deterministic key material.
 *
 * This is not fake crypto — signing, verification, and NIP-44 still
 * run through the real `nostr-tools` implementation via delegation to
 * {@link LiveSigner} (a signer that lies about signature validity
 * would make every consumer's decrypt/verify test meaningless). What's
 * "mocked" is only the source of randomness: `MockSigner.fromSeed()`
 * derives a 32-byte secret key deterministically from a string, so
 * tests get a stable, reproducible pubkey instead of a fresh random
 * one on every run.
 */
declare class MockSigner implements Signer {
    private readonly live;
    private constructor();
    /** Deterministic identity derived from `seed` (sha256(seed) as the secret key). */
    static fromSeed(seed: string): MockSigner;
    get pubkeyHex(): string;
    sign(kind: number, tags: string[][], content: string, createdAt?: number): NostrEvent;
    verify(event: Parameters<Signer['verify']>[0]): boolean;
    getConvoKey(theirPubkeyHex: string): Uint8Array;
    encryptNip44(plaintext: string, convoKey: Uint8Array): string;
    decryptNip44(payload: string, convoKey: Uint8Array): string;
}
declare function pubkeyForSeed(seed: string): string;

/**
 * Fan-in point for de-duplicating Nostr events arriving from multiple
 * relays. Named to match the Kotlin reference's `EventSink`.
 */
interface EventSink {
    /**
     * Offer an event to the sink.
     *
     * @returns `true` if this is the first time this event id has been
     *   seen within the current retention window (i.e. it should be
     *   forwarded downstream); `false` if it's a duplicate and should be
     *   dropped.
     */
    offer(event: NostrEvent): boolean;
}

/** Options for {@link LiveDedupingEventSink}. */
interface DedupingEventSinkOptions {
    /**
     * How long a seen event id is remembered before it's eligible to be
     * accepted again. Default: 5 minutes.
     */
    retentionWindowMs?: number;
    /**
     * Hard cap on how many event ids are tracked at once, independent of
     * age. Once exceeded, the oldest-inserted id is evicted regardless of
     * whether it has expired yet. Default: 10,000.
     */
    maxEntries?: number;
    /**
     * Clock injection point for deterministic tests. Defaults to
     * `Date.now`. Must be non-decreasing across calls — the eviction
     * sweep relies on insertion order approximating arrival-time order.
     */
    now?: () => number;
}
/**
 * De-duplicates Nostr events by id across multiple relays.
 *
 * A small out-of-band mesh subscribes to several relays for redundancy,
 * so the same event routinely arrives more than once (once per relay
 * that relayed it, plus possible re-delivery on reconnect/re-`REQ`).
 * `LiveDedupingEventSink` is the single fan-in point every relay
 * consumer calls into: `offer()` returns `true` exactly once per
 * distinct event id, and `false` for every subsequent duplicate, so
 * downstream decrypt/verify/forward logic only ever sees an event once.
 *
 * Entries are tracked in a `Map`, which preserves insertion order in
 * JS — this doubles as the arrival-time order needed for eviction, the
 * same trick the Kotlin reference gets from `LinkedHashMap`. Eviction
 * happens two ways:
 *   - age-based: entries older than `retentionWindowMs` are swept out
 *     at the start of every `offer()` call (oldest-first, stopping at
 *     the first still-live entry).
 *   - size-based: if `maxEntries` is exceeded after inserting a new id,
 *     the single oldest entry is evicted, regardless of its age.
 *
 * Everything here is synchronous — there is no `await` between reading
 * and mutating `seenAt`, so JS's single-threaded execution already
 * guarantees no interleaving. No identity-check-after-await discipline
 * is needed for this class specifically (unlike the orchestrator in
 * §4), because it never yields mid-operation.
 */
declare class LiveDedupingEventSink implements EventSink {
    private readonly retentionWindowMs;
    private readonly maxEntries;
    private readonly now;
    private readonly seenAt;
    constructor(options?: DedupingEventSinkOptions);
    offer(event: NostrEvent): boolean;
    /** Number of event ids currently tracked. Exposed for tests/inspection. */
    get size(): number;
    private evictExpired;
    private evictOverCapacity;
}

/**
 * A minimal `EventSink` test double. By default every offered event is
 * accepted exactly once (tracked by id, no expiry) — enough to test a
 * consumer's "don't process duplicates" wiring without pulling in the
 * real sink's time-based eviction logic. Every offered event is also
 * recorded in `offered`, in order, for assertions.
 */
declare class MockEventSink implements EventSink {
    /** Every event passed to `offer()`, in call order (including duplicates). */
    readonly offered: NostrEvent[];
    private readonly seenIds;
    offer(event: NostrEvent): boolean;
    /** Test helper: forget an id, so the next offer() of it is accepted again. */
    forget(eventId: string): void;
}

/** Connection lifecycle of a single relay socket. */
declare enum RelaySocketState {
    Connecting = "Connecting",
    Open = "Open",
    Reconnecting = "Reconnecting",
    /** Terminal — only reached via explicit close(); never auto-recovers. */
    Closed = "Closed"
}
/**
 * Returns the delay in ms to wait before the given (0-indexed) retry
 * attempt. Exposed as a pluggable strategy so tests can inject a fast
 * or fully deterministic schedule.
 */
type BackoffStrategy = (attempt: number) => number;
/**
 * Minimal subset of the WebSocket API the Live implementation depends
 * on, so tests can inject a fake instead of a real browser/Node
 * WebSocket.
 */
interface WebSocketLike {
    onopen: (() => void) | null;
    onclose: ((ev: {
        code: number;
        reason: string;
    }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onmessage: ((ev: {
        data: string;
    }) => void) | null;
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}
interface RelaySocket {
    readonly url: string;
    readonly state: StateFlow<RelaySocketState>;
    readonly messages: SharedFlow<string>;
    /**
     * Sends a text frame.
     *
     * Resolves the architecture doc's §7 open question ("queued vs
     * rejected sends on a not-yet-open socket"): rejected, not queued.
     * A send while not `Open` returns a failure `Result` immediately
     * rather than buffering — callers (relay-session, signalling-client)
     * are expected to retry at the semantic layer once the socket
     * reports `Open` again, the same way a failed WebRTC signalling send
     * feeds into rule 4's retry path in the orchestrator.
     */
    send(data: string): Result<void>;
    close(): void;
}

declare function exponentialBackoff(attempt: number, options?: {
    baseMs?: number;
    maxMs?: number;
}): number;
interface LiveRelaySocketOptions {
    backoffStrategy?: BackoffStrategy;
    webSocketFactory?: (url: string) => WebSocketLike;
}
/**
 * One WebSocket connection to a single Nostr relay, with automatic
 * reconnect-with-backoff on unexpected drop. Connects immediately on
 * construction; call `close()` to tear down permanently (no further
 * reconnect attempts after that).
 */
declare class LiveRelaySocket implements RelaySocket {
    readonly url: string;
    private readonly backoffStrategy;
    private readonly webSocketFactory;
    private readonly stateFlow;
    private readonly messagesFlow;
    private ws;
    private attempt;
    private reconnectTimer;
    private closedByCaller;
    constructor(url: string, options?: LiveRelaySocketOptions);
    get state(): StateFlow<RelaySocketState>;
    get messages(): SharedFlow<string>;
    send(data: string): Result<void>;
    close(): void;
    private openSocket;
    private scheduleReconnect;
}

/**
 * A `RelaySocket` test double for exercising consumers (`RelaySession`,
 * `SignallingClient`) without a real or fake WebSocket underneath.
 * Tests drive it directly via `open()`/`reconnecting()`/`deliver()`
 * and inspect what was sent via `sent`.
 */
declare class MockRelaySocket implements RelaySocket {
    readonly url: string;
    private readonly stateFlow;
    private readonly messagesFlow;
    /** Every frame handed to `send()`, in order. */
    readonly sent: string[];
    closed: boolean;
    private sendResult;
    constructor(url?: string);
    get state(): StateFlow<RelaySocketState>;
    get messages(): SharedFlow<string>;
    send(data: string): Result<void>;
    close(): void;
    open(): void;
    reconnecting(): void;
    /** Configures every subsequent `send()` to report failure. */
    failSends(error?: Error): void;
    /** Simulates an inbound raw text frame from the relay. */
    deliver(raw: string): void;
}

/**
 * Subscribe/publish semantics (NIP-01) layered on top of a raw relay
 * socket. Filters inbound events by the `#p` tag matching
 * `myPubkeyHex` — the mesh only ever cares about events addressed to
 * it, never open discovery.
 */
interface RelaySession {
    readonly url: string;
    readonly connectionState: StateFlow<RelaySocketState>;
    /** Nostr events matching this session's subscription. */
    readonly events: SharedFlow<NostrEvent>;
    publish(event: NostrEvent): Result<void>;
    close(): void;
}

/**
 * Wraps a {@link RelaySocket} with a REQ subscription filtered by
 * `#p` = `myPubkeyHex`, and a publish() that wraps `["EVENT", event]`.
 *
 * The REQ subscription is (re)sent every time the underlying socket
 * transitions to `Open` — including after a reconnect — since NIP-01
 * subscriptions don't survive a dropped connection.
 */
declare class LiveRelaySession implements RelaySession {
    private readonly socket;
    private readonly myPubkeyHex;
    private readonly kinds?;
    private readonly eventsFlow;
    private unsubscribeSocketState;
    private unsubscribeSocketMessages;
    constructor(socket: RelaySocket, myPubkeyHex: string, kinds?: number[] | undefined);
    get url(): string;
    get connectionState(): StateFlow<RelaySocketState>;
    get events(): SharedFlow<NostrEvent>;
    publish(event: NostrEvent): Result<void>;
    close(): void;
    private sendSubscription;
    private handleMessage;
}

/**
 * A `RelaySession` test double for exercising consumers
 * (`SignallingClient`) without a real socket underneath. Tests inspect
 * `published` and drive inbound traffic via `deliver()`.
 */
declare class MockRelaySession implements RelaySession {
    readonly url: string;
    private readonly stateFlow;
    private readonly eventsFlow;
    /** Every event handed to `publish()`, in order. */
    readonly published: NostrEvent[];
    private publishResult;
    constructor(url?: string);
    get connectionState(): StateFlow<RelaySocketState>;
    get events(): SharedFlow<NostrEvent>;
    publish(event: NostrEvent): Result<void>;
    close(): void;
    /** Configures every subsequent `publish()` to report failure. */
    failPublishes(error?: Error): void;
    /** Simulates an inbound event delivered by this relay. */
    deliver(event: NostrEvent): void;
}

/** Ephemeral Nostr event kind used for handshake signalling traffic. */
declare const SIGNALLING_KIND = 25050;
/** A decrypted inbound signalling payload, addressed to this identity. */
interface SignallingMessage {
    fromPubkeyHex: string;
    payload: string;
}
interface SignallingClient {
    readonly myPubkeyHex: string;
    readonly inbound: SharedFlow<SignallingMessage>;
    /**
     * Encrypts `payload` for `toPubkeyHex` and fans it out to every
     * configured relay. Best-effort, like rule 5's Announce broadcast —
     * returns success if at least one relay accepted the send.
     */
    send(toPubkeyHex: string, payload: string): Result<void>;
    close(): void;
}

interface SignallingClientOptions {
    eventSink?: EventSink;
    relaySocketOptions?: LiveRelaySocketOptions;
    /** Injection point for tests — bypasses real WebSocket/relay-session construction. */
    createRelaySession?: (url: string, myPubkeyHex: string) => RelaySession;
}
/**
 * Fans a single logical send/subscribe out across all configured
 * relays. Encrypts outbound payloads and decrypts inbound ones via
 * NIP-44 using the given {@link Signer}, and de-duplicates inbound
 * events (the same event commonly arrives via more than one relay)
 * through a shared {@link EventSink} before decrypting.
 */
declare class LiveNostrSignallingClient implements SignallingClient {
    private readonly signer;
    private readonly sink;
    private readonly sessions;
    private readonly inboundFlow;
    private readonly unsubscribes;
    constructor(signer: Signer, relayUrls: string[], options?: SignallingClientOptions);
    get myPubkeyHex(): string;
    get inbound(): SharedFlow<SignallingMessage>;
    send(toPubkeyHex: string, payload: string): Result<void>;
    close(): void;
    private handleInboundEvent;
}

/**
 * A `SignallingClient` test double. `send()` just records what was
 * sent (no real encryption/relay fan-out); tests drive inbound
 * traffic directly via `deliver()`.
 */
declare class MockSignallingClient implements SignallingClient {
    readonly myPubkeyHex: string;
    private readonly inboundFlow;
    /** Every `send()` call, in order. */
    readonly sent: Array<{
        toPubkeyHex: string;
        payload: string;
    }>;
    private sendResult;
    constructor(myPubkeyHex: string);
    get inbound(): SharedFlow<SignallingMessage>;
    send(toPubkeyHex: string, payload: string): Result<void>;
    close(): void;
    /** Configures every subsequent `send()` to report failure. */
    failSends(error?: Error): void;
    /** Simulates a decrypted inbound message arriving from `fromPubkeyHex`. */
    deliver(fromPubkeyHex: string, payload: string): void;
}

/**
 * Minimal subset of `RTCDataChannel` this module depends on, so tests
 * can inject an in-memory mock instead of a real browser data channel.
 */
interface DataChannelLike {
    readonly label: string;
    readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onmessage: ((ev: {
        data: Uint8Array;
    }) => void) | null;
    send(data: Uint8Array): void;
    close(): void;
}
type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
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
interface PeerConnectionLike {
    readonly connectionState: PeerConnectionState;
    onconnectionstatechange: (() => void) | null;
    ondatachannel: ((ev: {
        channel: DataChannelLike;
    }) => void) | null;
    createDataChannel(label: string): DataChannelLike;
    /** Creates an offer, sets it as the local description, and resolves once ICE gathering completes. */
    createOffer(): Promise<SessionDescriptionData>;
    /** Creates an answer, sets it as the local description, and resolves once ICE gathering completes. */
    createAnswer(): Promise<SessionDescriptionData>;
    setRemoteDescription(desc: SessionDescriptionData): Promise<void>;
    close(): void;
}
type PeerConnectionFactory = () => PeerConnectionLike;

interface LivePeerConnectionOptions {
    iceServers?: RTCIceServer[];
}
/**
 * Wraps the real browser `RTCPeerConnection`, adapting its trickle-ICE
 * default into the non-trickle contract `PeerConnectionLike` expects:
 * `createOffer()`/`createAnswer()` don't resolve until ICE gathering
 * reaches `complete`, at which point `pc.localDescription.sdp` already
 * has every candidate folded in (the standard "vanilla ICE" pattern) —
 * so the returned SDP is immediately ready to hand to signalling.
 */
declare class LivePeerConnection implements PeerConnectionLike {
    private readonly pc;
    onconnectionstatechange: (() => void) | null;
    ondatachannel: ((ev: {
        channel: DataChannelLike;
    }) => void) | null;
    constructor(pc: RTCPeerConnection);
    get connectionState(): PeerConnectionState;
    createDataChannel(label: string): DataChannelLike;
    createOffer(): Promise<SessionDescriptionData>;
    createAnswer(): Promise<SessionDescriptionData>;
    setRemoteDescription(desc: SessionDescriptionData): Promise<void>;
    close(): void;
    private currentLocalDescription;
    private waitForIceGatheringComplete;
}
/** Default factory: builds a `LivePeerConnection` around a real `RTCPeerConnection`. */
declare function createLivePeerConnectionFactory(options?: LivePeerConnectionOptions): PeerConnectionFactory;

declare class MockDataChannel implements DataChannelLike {
    readonly label: string;
    readyState: DataChannelLike['readyState'];
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onmessage: ((ev: {
        data: Uint8Array;
    }) => void) | null;
    peer: MockDataChannel | null;
    sent: Uint8Array[];
    constructor(label: string);
    open(): void;
    send(data: Uint8Array): void;
    close(): void;
}
/**
 * A `PeerConnectionLike` test double that "cheats" real signalling:
 * two linked instances share direct references to each other (via
 * `remote`) instead of exchanging opaque SDP over the network. This
 * is enough to exercise the state machines in `Initiator`/`Answerer`/
 * `PeerLink` without a browser — offer/answer content is opaque
 * placeholder text, never actually parsed.
 */
declare class MockPeerConnection implements PeerConnectionLike {
    connectionState: PeerConnectionState;
    onconnectionstatechange: (() => void) | null;
    ondatachannel: ((ev: {
        channel: DataChannelLike;
    }) => void) | null;
    dataChannel: MockDataChannel | null;
    remote: MockPeerConnection | null;
    createDataChannel(label: string): DataChannelLike;
    createOffer(): Promise<SessionDescriptionData>;
    createAnswer(): Promise<SessionDescriptionData>;
    setRemoteDescription(desc: SessionDescriptionData): Promise<void>;
    close(): void;
    markConnected(): void;
    simulateFailure(): void;
}
/** Creates two `MockPeerConnection`s wired to each other. */
declare function createLinkedMockPeerConnections(): [MockPeerConnection, MockPeerConnection];

type PeerLinkState = 'open' | 'closed';
/**
 * Wraps an already-open data channel. Constructed once a channel
 * reaches `open` — see Initiator/Answerer, which each expose a
 * `PeerLink` only after their connection reaches `Connected`.
 */
interface PeerLink {
    readonly state: StateFlow<PeerLinkState>;
    readonly incomingBytes: SharedFlow<Uint8Array>;
    send(data: Uint8Array): void;
    close(): void;
}

declare class LivePeerLink implements PeerLink {
    private readonly channel;
    private readonly stateFlow;
    private readonly incomingBytesFlow;
    constructor(channel: DataChannelLike);
    get state(): StateFlow<PeerLinkState>;
    get incomingBytes(): SharedFlow<Uint8Array>;
    send(data: Uint8Array): void;
    close(): void;
}

/**
 * A `PeerLink` test double for exercising consumers (e.g. the future
 * orchestrator) without a real or mock data channel underneath. Tests
 * inspect `sent` and drive inbound bytes via `simulateIncoming()`.
 */
declare class MockPeerLink implements PeerLink {
    private readonly stateFlow;
    private readonly incomingBytesFlow;
    /** Every payload handed to `send()`, in order. */
    readonly sent: Uint8Array[];
    get state(): StateFlow<PeerLinkState>;
    get incomingBytes(): SharedFlow<Uint8Array>;
    send(data: Uint8Array): void;
    close(): void;
    /** Simulates bytes arriving from the remote peer. */
    simulateIncoming(data: Uint8Array): void;
}

/**
 * Offer side of the handshake (§2 rule 1).
 *
 * Initiator → Offering → Connecting → Connected
 *                       ↘ Failed ↗
 *
 * Owns the handshake-timeout check — the Answerer does not, since only
 * initiators retry (rule 4).
 */
interface Initiator {
    readonly state: StateFlow<LinkState>;
    /** The open data channel, once `state` reaches `Connected`. Otherwise `null`. */
    readonly peerLink: PeerLink | null;
    /**
     * Creates the data channel and an SDP offer, sets it as the local
     * description, and starts the handshake-timeout clock. The caller
     * is responsible for sending the returned offer to the remote peer
     * via signalling.
     */
    createOffer(): Promise<SessionDescriptionData>;
    /** Applies a remote answer received via signalling (rule 3). */
    acceptAnswer(answer: SessionDescriptionData): Promise<void>;
    close(): void;
}

interface LiveInitiatorOptions {
    peerConnectionFactory: PeerConnectionFactory;
    /** Wall-clock timeout for the whole offer→connected cycle. Default 30s (§3). */
    handshakeTimeoutMs?: number;
}
declare class LiveInitiator implements Initiator {
    private readonly stateFlow;
    private readonly pc;
    private readonly handshakeTimeoutMs;
    private timeoutHandle;
    private link;
    constructor(options: LiveInitiatorOptions);
    get state(): StateFlow<LinkState>;
    get peerLink(): PeerLink | null;
    createOffer(): Promise<SessionDescriptionData>;
    acceptAnswer(answer: SessionDescriptionData): Promise<void>;
    close(): void;
    private wireDataChannel;
    private handleConnectionStateChange;
    private fail;
    private startHandshakeTimeout;
    private clearHandshakeTimeout;
}

/**
 * An `Initiator` test double with no real (or mock) `RTCPeerConnection`
 * underneath — just the state machine, driven manually by tests.
 * Useful for testing the future orchestrator without pulling in the
 * WebRTC seam at all.
 */
declare class MockInitiator implements Initiator {
    private readonly stateFlow;
    private link;
    /** Every offer returned by `createOffer()`, in order. */
    readonly offersCreated: SessionDescriptionData[];
    /** Every answer passed to `acceptAnswer()`, in order. */
    readonly answersAccepted: SessionDescriptionData[];
    get state(): StateFlow<LinkState>;
    get peerLink(): PeerLink | null;
    createOffer(): Promise<SessionDescriptionData>;
    acceptAnswer(answer: SessionDescriptionData): Promise<void>;
    close(): void;
    /** Forces the state machine to Connected, attaching the given PeerLink. */
    simulateConnected(link: PeerLink): void;
    /** Forces the state machine to Failed (connection failure or handshake timeout). */
    simulateFailed(): void;
}

/**
 * Answer side of the handshake (§2 rule 2 — always open to being an
 * answerer, gated only at the orchestrator level, not here).
 *
 * Answering → Connecting → Connected
 *                        ↘ Failed ↗
 *
 * No handshake timeout: only initiators retry (rule 4).
 */
interface Answerer {
    readonly state: StateFlow<LinkState>;
    /** The open data channel, once `state` reaches `Connected`. Otherwise `null`. */
    readonly peerLink: PeerLink | null;
    /**
     * Applies the remote offer, creates an SDP answer, and sets it as
     * the local description. The caller sends the returned answer back
     * to the initiator via signalling.
     */
    createAnswer(offer: SessionDescriptionData): Promise<SessionDescriptionData>;
    close(): void;
}

interface LiveAnswererOptions {
    peerConnectionFactory: PeerConnectionFactory;
}
declare class LiveAnswerer implements Answerer {
    private readonly stateFlow;
    private readonly pc;
    private link;
    constructor(options: LiveAnswererOptions);
    get state(): StateFlow<LinkState>;
    get peerLink(): PeerLink | null;
    createAnswer(offer: SessionDescriptionData): Promise<SessionDescriptionData>;
    close(): void;
    private wireDataChannel;
    private handleConnectionStateChange;
}

/**
 * An `Answerer` test double with no real (or mock) `RTCPeerConnection`
 * underneath — just the state machine, driven manually by tests.
 */
declare class MockAnswerer implements Answerer {
    private readonly stateFlow;
    private link;
    /** Every offer passed to `createAnswer()`, in order. */
    readonly offersReceived: SessionDescriptionData[];
    get state(): StateFlow<LinkState>;
    get peerLink(): PeerLink | null;
    createAnswer(offer: SessionDescriptionData): Promise<SessionDescriptionData>;
    close(): void;
    /** Forces the state machine to Connected, attaching the given PeerLink. */
    simulateConnected(link: PeerLink): void;
    /** Forces the state machine to Failed. */
    simulateFailed(): void;
}

export { type Answerer, type BackoffStrategy, DEFAULT_MESH_ENDPOINTS, type DataChannelFrame, type DataChannelLike, type DedupingEventSinkOptions, type EventSink, type Initiator, LinkState, LiveAnswerer, type LiveAnswererOptions, LiveDedupingEventSink, LiveInitiator, type LiveInitiatorOptions, LiveNostrSignallingClient, LivePeerConnection, type LivePeerConnectionOptions, LivePeerLink, LiveRelaySession, LiveRelaySocket, type LiveRelaySocketOptions, LiveSharedFlow, LiveSigner, LiveStateFlow, MockAnswerer, MockDataChannel, MockEventSink, MockInitiator, MockPeerConnection, MockPeerLink, MockRelaySession, MockRelaySocket, MockSharedFlow, MockSignallingClient, MockSigner, MockStateFlow, type MutableSharedFlow, type MutableStateFlow, type NostrEvent, type PeerConnectionFactory, type PeerConnectionLike, type PeerConnectionState, type PeerLink, type PeerLinkState, type PeerMessage, type RelaySession, type RelaySocket, RelaySocketState, type Result, SIGNALLING_KIND, type SessionDescriptionData, type SharedFlow, type SignallingClient, type SignallingClientOptions, type SignallingMessage, type Signer, type StateFlow, type TerminalFailure, type UnsignedNostrEvent, type WebSocketLike, createLinkedMockPeerConnections, createLivePeerConnectionFactory, createMockSharedFlow, createMockStateFlow, createSharedFlow, createStateFlow, err, exponentialBackoff, ok, pubkeyForSeed };
