# Coralie: Nostr + WebRTC Mesh Architecture & Implementation Plan

Fast, gossip-style WebRTC mesh networking over Nostr signalling. No relay
roster, no central server — just public keys and peers.

This is a JavaScript/TypeScript port of a working Kotlin implementation
(`LiveConnectionManager` + supporting classes). The port preserves the
Kotlin design's exact state machine and rules; only the concurrency
primitives change to fit JS's single-threaded model.

---

## 1. Design goals

- **Speed over generality.** Built for small out-of-band groups (3–10
  peers), not open discovery or large mesh fan-out. Every design choice
  in this doc trades away roster-sync correctness for fewer round trips.
- **No central roster.** There is no source of truth for "who's in the
  mesh." Membership is inferred locally from live connections. A peer
  that goes offline simply disappears from everyone's map — no
  departure broadcast, no reconciliation.
- **Ecosystem-aligned crypto.** Uses `nostr-tools` (Unlicense) and its
  `@noble`/`@scure` dependencies (MIT) rather than hand-rolled
  cryptography, for interop correctness against real public relays and
  because these libraries are independently audited.
- **Single import surface.** Internally many files; externally one
  entry point (`createLiveConnectionManager`) and a small set of types.
  No consumer ever touches the Nostr or WebRTC layers directly.

---

## 2. Core connection rules

These are the rules of the mesh, ported verbatim from the Kotlin
reference implementation. Every behavior in §3–§5 exists to implement
these six rules correctly under JS's concurrency model.

1. **New pubkey learned** — via `addPeer()` (out-of-band) or an
   `Announce` frame from an existing peer — and the pubkey is not self,
   not already `initiating`, and not already `connected` → become
   initiator: create a peer connection, send an `Offer`, attempt 1.

2. **Always open to being an answerer, with one global gate.** An
   inbound `Offer` is accepted *unless*:
   - the sender is already `connected`, or
   - **the local map of in-flight initiations is non-empty** — this
     is a global gate, not a per-pubkey gate. While initiating toward
     *anyone*, all inbound offers from *everyone* are rejected.

   This is intentional, not a simplification to fix later. In a small
   out-of-band mesh it is self-healing: a rejected offer just costs the
   sender one failed attempt (rule 4), and the relationship re-forms
   either when the initiator's own attempts resolve, or via a later
   `Announce`, or via a repeated out-of-band share.

3. **Inbound `Answer`** is matched only against the local in-flight
   initiation for that pubkey. No offer/answer correlation ID is
   needed — a stale answer (paired with an offer a retry has already
   superseded) fails safely: either it throws synchronously when
   applied, or it applies but the negotiation fails ICE later. Both
   paths cost one attempt via the same failure path as rule 4.

4. **Failure** — a rejected signalling send, a 30s handshake timeout,
   or the underlying connection reaching a failed state — tears down
   the current attempt and increments its counter. If the counter has
   reached **5**, give up entirely: remove the pubkey, emit a terminal
   failure. Otherwise: brand-new peer connection, brand-new SDP, same
   pubkey slot, resend.

   **Simultaneous mutual-initiate is an accepted edge case, not a bug.**
   If A and B learn each other's pubkeys at the same moment, both
   become initiators, both reject each other's `Offer` under rule 2,
   and both attempts run out their 5 retries and fail. This is
   intended behavior — no glare/tie-break logic is implemented.

5. **Connection reaches open** — remove from the in-flight map (a
   no-op if this was the answerer side, which was never in that map),
   add to the connected map, start reading data-channel frames, and
   broadcast an `Announce` for this new pubkey to every *other*
   connected peer. This broadcast is best-effort — no retry, no
   acknowledgement.

6. **Connection later closes or fails** (post-open) — remove from the
   connected map. No re-announce, no cleanup broadcast. This is the
   direct consequence of "no roster sync": peers age out of each
   other's maps independently and asynchronously.

---

## 3. State model

Two disjoint maps, never one tri-state map. A pubkey is in at most one
of these; absence from both means "no relationship."

```
initiating : Map<pubkeyHex, { connection, attemptCount, startedAt }>
connected  : Map<pubkeyHex, PeerLink>
```

`initiating` holds attempts where the local side sent the `Offer`.
`connected` holds any link — initiator or answerer role — that has
reached an open data channel. Once a pubkey reaches `connected`, its
`initiating` entry (if any) is removed; the two maps are never both
populated for the same pubkey at once.

### Timing

- `handshakeTimeout = 30s` — wall-clock, not inferred from attempt
  count. Checked by a periodic tick (every 1s) over all live
  `initiating` entries.
- `maxInitiationAttempts = 5` — caps how many times the 30s cycle is
  *redone* per pubkey. The attempt cap and the timeout are independent
  knobs: the cap limits retries, the timeout drives each individual
  retry's failure.

---

## 4. Concurrency model (the one place this port genuinely diverges)

The Kotlin implementation gets state-confinement for free from a
single-threaded coroutine dispatcher (`limitedParallelism(1)`) — every
mutation of `initiating`/`connected` runs serialized on one logical
thread, so there is no possibility of two mutations interleaving.

JavaScript is single-threaded by default, which gives the same
guarantee *between* synchronous blocks of code — but an `await` yields
control, and by the time an async continuation resumes, the state it
was about to act on may have been superseded by something else that
ran in the meantime (a retry triggered by the timeout ticker, a fresh
inbound offer, a manual `addPeer()` call).

The Kotlin code already defends against exactly this with identity
checks after every `await`-equivalent (`attempt.initiator === initiator`
before acting on an async result). The JS port keeps this discipline
as its *only* concurrency mechanism — no locks, no queues, no mutex
libraries:

```ts
// After any await that might resolve into a stale world:
if (initiating.get(pubkeyHex)?.connection !== thisConnection) return
// ...otherwise safe to mutate.
```

Every async continuation in the orchestrator that later touches
`initiating` or `connected` re-checks identity before acting. This
single pattern, applied consistently, is what makes the port safe
without introducing any new concurrency primitive Kotlin didn't need.

---

## 5. Module structure

```
src/
  emitter.ts                    # tiny pub/sub primitives (StateFlow-like + SharedFlow-like)
  types.ts                      # LinkState, SessionDescriptionData, DataChannelFrame,
                                 # PeerMessage, TerminalFailure, NostrEvent, UnsignedNostrEvent
  crypto/
    signer.ts                   # Signer — generate(), sign(), ecdh(), getConvoKey()
                                 # (thin wrapper over nostr-tools/pure + nostr-tools/nip44)
  nostr/
    deduping-event-sink.ts      # DedupingEventSink — cross-relay dedup by event id
    relay-socket.ts             # LiveRelaySocket — one relay WebSocket + exponential backoff
    relay-session.ts            # LiveRelaySession — subscribe/publish on top of a socket
    signalling-client.ts        # LiveNostrSignallingClient — multi-relay fan-out,
                                 # NIP-44 encrypt/decrypt of offer/answer payloads
  webrtc/
    initiator.ts                # Initiator — offer side of handshake
    answerer.ts                 # Answerer — answer side of handshake
    peer-link.ts                # PeerLink — post-handshake, open data channel
  live-connection-manager.ts    # orchestrator — implements §2's six rules directly
  mesh-endpoints.ts             # DEFAULT_MESH_ENDPOINTS (relayUrls + iceServers), overridable
  create-live-connection-manager.ts   # factory — wires signer + relays + manager together
  index.ts                      # public exports: createLiveConnectionManager + types only
```

### Public API

```ts
export function createLiveConnectionManager(options?: {
  relayUrls?: string[]
  iceServers?: RTCIceServer[]
}): ConnectionManager

export interface ConnectionManager {
  readonly myPubkeyHex: string
  readonly peers: StateFlowLike<Set<string>>
  readonly incomingMessages: SharedFlowLike<PeerMessage>
  readonly terminalFailures: AsyncIterable<TerminalFailure>
  addPeer(pubkeyHex: string): void
  sendMessage(toPubkeyHex: string, bytes: Uint8Array): Promise<Result<void>>
  close(): void
}

export type { PeerMessage, TerminalFailure }
```

Everything under `crypto/`, `nostr/`, and `webrtc/` is internal
implementation detail, never re-exported. Consumers get one function
and a handful of types — nothing else is part of the contract.

### Defaults

```ts
const DEFAULT_MESH_ENDPOINTS = {
  relayUrls: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://nostr.oxtr.dev',
    'wss://purplerelay.com',
  ],
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun2.l.google.com:19302'] },
    { urls: ['stun:stun3.l.google.com:19302'] },
    { urls: ['stun:stun4.l.google.com:19302'] },
    { urls: ['stun:stun.cloudflare.com:3478'] },
  ],
}
```

STUN-only, no TURN — matches the Kotlin reference. Both lists are
overridable via `createLiveConnectionManager()` options; the defaults
apply only for whichever list the caller omits.

### Identity

No persistence, no restore path. `createLiveConnectionManager()`
always generates a fresh keypair via `nostr-tools/pure`
(`generateSecretKey` + `getPublicKey`). The identity lives for the
lifetime of one manager instance — it survives peer disconnects and
reconnects within that lifetime, but a new manager (e.g. after a page
reload) always means a new identity. This is a deliberate product
decision carried over from the Kotlin app, not a limitation to fix.

### Data-channel framing

One frame type multiplexed over each peer's single data channel:

```ts
type DataChannelFrame =
  | { type: 'app'; payload: Uint8Array }
  | { type: 'announce'; pubkeyHex: string }
```

`Announce` travels peer-to-peer over an already-open data channel, not
via Nostr — the relay layer only ever carries `Offer`/`Answer`
signalling for the initial handshake. Malformed frames are logged and
dropped; they never crash the reader loop for that peer.

### Dependencies

| Package | Role | License |
|---|---|---|
| `nostr-tools` | event signing/id (`pure`), NIP-44 encrypt/decrypt, conversation-key derivation | Unlicense |
| `@noble/curves` (transitive) | secp256k1/Schnorr primitives | MIT |
| `@noble/hashes` (transitive) | SHA-256, HMAC, HKDF | MIT |
| `@noble/ciphers` (transitive) | ChaCha20 for NIP-44 | MIT |
| `@scure/base` (transitive) | base64 framing for NIP-44 | MIT |

All audited, all permissively licensed, no copyleft, no attribution
burden beyond standard `node_modules` license files. `nostr-wasm` is a
transitive optional dependency of `nostr-tools` that is never
exercised — the pure-JS path (`nostr-tools/pure`) is used throughout,
not the WASM signing path.

---

## 6. Implementation phases

Each phase produces working, independently-tested code — later phases
depend on earlier ones being correct, so tests are not deferred to the
end. Unit tests accompany the module they test, within the same phase.
Integration tests are called out separately where they span modules.

### Phase 0 — Scaffolding, types, crypto ✅ COMPLETE

**Builds:** `package.json`, `tsconfig.json`, vitest config, `src/core/types.ts`, `src/core/emitter.ts`, `src/crypto/signer.ts`

- Package setup: `package.json` with `nostr-tools` (crypto), `vitest` (testing), `tsup` (bundling)
- TypeScript config (strict, ES2020 target, ESNext modules)
- Vitest config with recursive test glob (`src/**/*.test.ts`)
- **Core types:** `LinkState`, `SessionDescriptionData`, `DataChannelFrame`, `PeerMessage`, `TerminalFailure`, `NostrEvent`, `UnsignedNostrEvent`
- **Pub/sub primitives:** `StateFlow<T>` and `SharedFlow<T>` (Kotlin Flow-like hot observables)
- **Crypto layer:** `Signer` class wrapping `nostr-tools`:
  - `generate()` — random identity
  - `sign()` — finalize + sign Nostr events
  - `verify()` — validate signatures
  - `ecdh()` — shared secret derivation
  - `encryptNip44()` / `decryptNip44()` — NIP-44 v2 encryption
  - `sha256()` — hashing utilities
- **Build outputs:** ESM (`.mjs`), CommonJS (`.cjs`), IIFE browser bundle (`.global.js`), TypeScript definitions (`.d.ts`)
- **Browser demo:** `examples/demo.html` — interactive tests for key generation, signing, encryption (loads IIFE bundle locally)

**Unit tests:** ~22 passing
- `src/core/emitter.test.ts` — StateFlow/SharedFlow semantics
- `src/crypto/signer.test.ts` — signing, verification, ECDH, NIP-44 encryption

**Directory structure:** `src/core/` (primitives), `src/crypto/` (signing), `src/nostr/`, `src/webrtc/`, `src/orchestrator/` (stubbed for future phases), `docs/`, `examples/`

### Phase 1 — Deduping event sink

**Builds:** `nostr/deduping-event-sink.ts`

- `DedupingEventSink` — tracks seen event IDs (bounded, evict oldest),
  drops duplicates arriving from a second relay.
- Configurable retention window (default: 5 minutes).
- Garbage-collects stale entries by age.
- Thread-safe (or JS-equivalent: identity-checked after every await).

**Unit tests:**
- `deduping-event-sink.test.ts`:
  - Same event ID from two relays → second is dropped.
  - Event ID expires after retention window → is accepted again.
  - Adding a new event before expiry → is accepted (new ID).
  - Retention window respects insertion order (oldest evicted first).

### Phase 2 — Nostr relay/signalling layer

**Builds:** `nostr/relay-socket.ts`, `nostr/relay-session.ts`, `nostr/signalling-client.ts`

- `LiveRelaySocket` — one relay connection, exponential backoff
  reconnect, exposes connect state.
- `LiveRelaySession` — subscribe (filter by `#p` tag = my pubkey),
  publish, layered on a socket.
- `LiveNostrSignallingClient` — fans a single logical
  send/subscribe out across all configured relays, encrypts outbound
  payloads and decrypts inbound ones via NIP-44 using `Signer`,
  de-duplicates inbound events via the sink.

**Unit tests:**
- `deduping-event-sink.test.ts` — same event ID delivered twice is
  only emitted once; different event IDs both pass through; eviction
  doesn't cause false "new" positives for an already-seen-then-evicted
  ID within a test's practical timeframe (document the bound, don't
  necessarily test the eviction edge exhaustively).
- `relay-socket.test.ts` (mocked WebSocket) — backoff timing follows
  the expected curve on repeated failures; a successful connection
  resets the backoff counter; messages sent before the socket is open
  are queued or rejected per spec (pin down which — see open question
  in §7).
- `signalling-client.test.ts` (mocked relay sockets) — an outbound
  message is NIP-44 encrypted before being handed to every relay; an
  inbound event is decrypted and only surfaces once even if multiple
  mock relays deliver the identical event; a message that fails to
  decrypt (wrong key, corrupt payload) is dropped, not thrown past the
  caller.

**Integration test (Phase 3, real network — separately gated):**
- `signalling-client.integration.test.ts` — two `Signer` identities,
  two `LiveNostrSignallingClient`s pointed at the real default relay
  list, one sends an encrypted payload addressed to the other's
  pubkey, the other receives and correctly decrypts it. This is the
  first point in the plan where "does this actually work against
  public relays" gets verified, and it should run against the literal
  default relay list since that's what ships. Gate this behind an
  explicit npm script (e.g. `test:integration`), not the default `test`
  run, since it depends on external network state and public relay
  availability/latency.

### Phase 3 — WebRTC layer

**Builds:** `webrtc/initiator.ts`, `webrtc/answerer.ts`,
`webrtc/peer-link.ts`

- `Initiator` — wraps `RTCPeerConnection`, `createOffer()`,
  `acceptAnswer()`, exposes `LinkState` as a `StateFlow`-like emitter,
  owns the handshake-timeout check.
- `Answerer` — wraps `RTCPeerConnection` given an inbound offer,
  `createAnswer()`, same `LinkState` exposure.
- `PeerLink` — wraps an open `RTCDataChannel`: `send()`,
  `incomingBytes` (SharedFlow-like), `state`, `close()`.

**Unit tests** (using a WebRTC-capable test environment — see §7 open
question on runtime):
- `initiator.test.ts` / `answerer.test.ts` — offer/answer exchanged
  directly in-process (no signalling layer involved, no network)
  between an `Initiator` and an `Answerer` reaches `Connected` state;
  an `Initiator` with no matching answerer times out at the configured
  `handshakeTimeout` and transitions to `HandshakeTimedOut`.
- `peer-link.test.ts` — once two linked peer connections are open,
  `send()` on one side is observed via `incomingBytes` on the other;
  closing one side's connection surfaces as a state transition on the
  other.

*No integration test needed at this phase specifically* — Phase 5's
integration tests cover WebRTC + signalling together, which is the
combination that actually matters.

### Phase 4 — Orchestrator

**Builds:** `live-connection-manager.ts`

This is where §2's six rules get implemented directly, and where the
concurrency discipline from §4 is applied throughout. Every method
described in the architecture — `onNewPeerLearned`, `sendOffer`,
`onAttemptFailed`, `onLinkConnected`, `watchLinkState`,
`broadcastAnnounce`, `onInboundOffer`, `onInboundAnswer` — is a direct,
traceable port of the Kotlin reference, and should carry the same rule
references in comments (mirroring the Kotlin's `§6.x` style) so the
two implementations stay auditable against each other.

**Unit tests** (signalling and WebRTC layers mocked/faked — this phase
tests *rule logic*, not real networking):
- `live-connection-manager.test.ts`:
  - Rule 1: `addPeer(newPubkey)` creates an `initiating` entry and
    triggers an offer send; calling it again with the same pubkey
    while still `initiating` is a no-op; calling it with a pubkey
    that's already `connected` is a no-op; calling it with own pubkey
    is a no-op.
  - Rule 2: while any `initiating` entry exists, an inbound offer from
    any third pubkey is rejected — assert no `Answerer` is created and
    no `Answer` is sent. Once `initiating` is empty, the same inbound
    offer is accepted.
  - Rule 3: an inbound answer with no matching `initiating` entry is a
    no-op (no throw, no side effect). An inbound answer matching a
    *stale* attempt (superseded by a retry) does not corrupt the fresh
    attempt's state.
  - Rule 4: simulate 5 consecutive failures for one pubkey — assert a
    fresh connection object is created each time, the attempt counter
    increments each time, and after the 5th failure the pubkey is
    removed and a `TerminalFailure` is emitted with the correct
    pubkey/count. Simulate 3 failures then a success — assert no
    terminal failure fires and the pubkey ends up `connected`.
  - Rule 4 (mutual-initiate edge case): simulate both sides
    initiating toward each other simultaneously — assert both attempts
    independently exhaust their 5 retries and both terminal-fail,
    with neither side ever completing a handshake. This is the
    explicit regression test for the intended (not accidental)
    deadlock behavior described in §2.4.
  - Rule 5: a connection reaching open removes it from `initiating`
    (or confirms it was never there, for the answerer path), adds it
    to `connected`, and triggers exactly one `Announce` broadcast to
    every *other* currently-connected peer — assert the new peer
    itself does not receive its own announce.
  - Rule 6: a `connected` link closing removes it from `connected` and
    does **not** trigger any broadcast — assert no message is sent to
    any remaining peer as a result.
  - Announce handling: receiving an `Announce` frame for a pubkey
    already `connected` or already `initiating` is a no-op (same
    idempotency guard as rule 1, since both paths funnel through the
    same entry point).
  - Concurrency/staleness: an async continuation (e.g. a signalling
    send's promise resolving) that resolves *after* a retry has
    already superseded the attempt it belongs to must not mutate
    state — assert the fresh attempt survives untouched.

### Phase 5 — Factory & defaults

**Builds:** `mesh-endpoints.ts`, `create-live-connection-manager.ts`,
`index.ts`

- Wires `Signer.generate()`, the relay/ICE endpoint lists (defaults or
  overrides), the signalling client, and `LiveConnectionManager`
  together into one function.
- `index.ts` exports exactly the public surface from §5 — nothing more.

**Unit tests:**
- `create-live-connection-manager.test.ts` — omitting `relayUrls`
  falls back to `DEFAULT_MESH_ENDPOINTS.relayUrls`; providing an
  override list is used verbatim (not merged with defaults); same for
  `iceServers`; the returned manager's `myPubkeyHex` is a fresh,
  valid, distinct identity on every call (two calls in the same test
  never produce the same pubkey).
- A build-output test (can run in CI, not necessarily under the same
  test runner): import from the published entry point and assert only
  the documented exports are present — guards against accidentally
  leaking an internal module through a stray re-export.

### Phase 6 — End-to-end integration tests

Everything up to here has been unit-level with mocks at the module
boundary. This phase exercises real `RTCPeerConnection`s and, where
gated, real public relays together — this is the level at which the
six rules in §2 are actually validated as *emergent* behavior, not
just unit-tested in isolation.

- **Two-peer happy path** — two full `ConnectionManager` instances
  (real WebRTC, mocked or real signalling per test variant), one calls
  `addPeer(other.myPubkeyHex)`, assert both sides' `peers` StateFlow
  converges to `{ eachOther }`, and a message sent from one arrives on
  the other via `incomingMessages`.
- **Three-peer gossip** — A connects to B (out-of-band), B connects to
  C (out-of-band). Assert A eventually has C in its `peers` set purely
  via the `Announce` gossip path — without ever calling
  `addPeer(C.pubkey)` on A directly. This is the key test proving
  rule 5's broadcast actually produces mesh convergence, not just that
  the broadcast function is called.
- **Peer departure** — in a connected 3-peer mesh, forcibly close one
  peer's connection to a second. Assert the closed pair drop each
  other from their respective `peers` sets, and — importantly — assert
  the *third*, uninvolved peer's `peers` set is unaffected (proving
  "no roster sync" is real: departure is not broadcast). This is also
  the regression test for the product behavior that a peer whose
  connections all drop appears alone to everyone else, and needs a
  fresh out-of-band pubkey to rejoin.
- **Retry exhaustion against a real network condition** — one peer
  targets a pubkey that will never answer (no corresponding manager
  exists); assert exactly 5 attempts occur, spaced by real handshake
  timeouts, and a `TerminalFailure` surfaces with `attemptCount === 5`.
  This test is inherently slow (5 × 30s in the worst case unless the
  timeout is made configurable and shortened for this test run — the
  constructor already exposes this as a tunable, so the test should
  use a short timeout rather than accept a 2.5-minute test).
- **NIP-44 interop check** — reuse the Phase 3 integration test's
  two-identity setup, but drive it through the full
  `createLiveConnectionManager` factory rather than the raw signalling
  client, confirming the crypto and signalling layers compose
  correctly end to end, not just individually.

Like Phase 3's integration test, all of Phase 7 should be gated behind
an explicit `test:integration` script, kept out of the default fast
unit-test run, and clearly documented as depending on either real
public relay availability or (for the WebRTC-only tests) a
WebRTC-capable test runtime.

---

## 7. Open questions to resolve before/during implementation

These don't block starting Phase 0–2, but should be settled before the
phases that depend on them:

- **Test runtime for WebRTC.** `RTCPeerConnection` isn't available in
  plain Node without a shim. Options: run WebRTC-touching tests
  (Phases 4, 7) in a real browser via Playwright/`@vitest/browser`, or
  use a Node WebRTC implementation (e.g. `node-datachannel` or similar)
  as a test-only dependency. This choice affects Phase 4's test setup
  directly and should be settled before that phase starts.
- **Queued-vs-rejected sends on a not-yet-open relay socket.** Called
  out inline in Phase 3 — needs a concrete answer before
  `relay-socket.test.ts` can be written precisely.
- **Bundling/distribution shape.** Whether the published package is a
  single flattened bundle or ships the multi-file `src/` structure for
  the consumer's own bundler to flatten — doesn't block writing the
  module itself, but affects Phase 0's tooling setup and Phase 6's
  build-output test.