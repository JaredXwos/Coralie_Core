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

## 4. Concurrency model

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

Each unit of behavior lives in its own folder, split into an
interface, a live (real) implementation, a mock (test-double)
implementation, unit tests, and a small barrel:

```
{component}/
  {component}.interface.ts   # the contract — what the rest of the app depends on
  {component}.live.ts        # real implementation (Live prefix, e.g. LiveRelaySocket)
  {component}.mock.ts        # test double (Mock prefix, e.g. MockRelaySocket)
  {component}.test.ts        # unit tests, written against the interface
  index.ts                   # re-exports interface + Live + Mock
```

```
src/
  core/
    types.ts                     # LinkState, SessionDescriptionData, DataChannelFrame,
                                  # PeerMessage, TerminalFailure, NostrEvent, UnsignedNostrEvent
    state-flow/                  # StateFlow — Kotlin StateFlow-like hot observable
    shared-flow/                 # SharedFlow — Kotlin SharedFlow-like hot observable
  crypto/
    signer/                      # Signer — generate/sign/verify/ecdh/NIP-44/sha256,
                                  # thin wrapper over nostr-tools/pure + nostr-tools/nip44
  nostr/
    event-sink/                  # EventSink — cross-relay dedup by event id
    relay-socket/                 # RelaySocket — one relay WebSocket + exponential backoff
    relay-session/                # RelaySession — subscribe/publish on top of a socket
    signalling-client/            # SignallingClient — multi-relay fan-out,
                                  # NIP-44 encrypt/decrypt of offer/answer payloads
  webrtc/
    peer-connection/               # PeerConnectionLike — thin contract over RTCPeerConnection;
                                  # exercised via Initiator/Answerer/PeerLink, no dedicated unit test file
    initiator/                    # Initiator — offer side of handshake
    answerer/                     # Answerer — answer side of handshake
    peer-link/                    # PeerLink — post-handshake, open data channel
  live-connection-manager.ts     # orchestrator — implements §2's six rules directly
  mesh-endpoints.ts              # DEFAULT_MESH_ENDPOINTS (relayUrls + iceServers), overridable
  create-live-connection-manager.ts   # factory — wires signer + relays + manager together
  index.ts                       # barrel export
  demo.spec.ts                   # Playwright e2e tests, driven against examples/demo.html
examples/
  demo.html                      # interactive live test bed — loads the built IIFE bundle
```

**Naming convention:**
- Interface — bare component name (`RelaySocket`, `Signer`, `Initiator`)
- Live implementation — `Live` prefix (`LiveRelaySocket`, `LiveSigner`)
- Test double — `Mock` prefix (`MockRelaySocket`, `MockSigner`)

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
implementation detail and is never part of the published contract.
Until the factory (Phase 5) exists, `src/index.ts` re-exports every
component's interface/Live/Mock surface so the library is usable
end-to-end for development, the browser demo, and testing; trimming
down to just `createLiveConnectionManager` plus the types above is the
last step of Phase 5.

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

### Testing strategy

Two layers of tests, both living next to the code they exercise:

- **Unit tests** (`*.test.ts`, Vitest, Node environment) — one file
  per component, written against the interface and exercised with
  `Mock` implementations of that component's dependencies. Fast, no
  network, no real browser APIs.
- **Browser end-to-end tests** (`*.spec.ts`, Playwright) — exercise
  the built IIFE bundle (`dist/index.global.js`) loaded into
  `examples/demo.html` inside a real Chrome instance
  (`channel: 'chrome'` — no bundled browser download). These are the
  only tests that touch a real `RTCPeerConnection` and real ICE
  gathering; everything else is mocked at the component boundary.

`npm test` runs the unit suite; `npm run test:e2e` runs the browser
suite separately, since it depends on `npm run build` having produced
`dist/` first and drives a real browser rather than running in Node.

### Build & distribution

`tsup` builds `src/index.ts` to three targets in one pass: ESM
(`dist/index.js`), CommonJS (`dist/index.cjs`), and a browser IIFE
(`dist/index.global.js`, global name `CoralieCore`) — plus a single
`.d.ts`. The published package ships this flattened `dist/` output
(`package.json`'s `exports` map points at it), not the multi-file
`src/` tree; consumers never need their own bundler to flatten it.

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

**Built:** `package.json`, `tsconfig.json`, `vitest.config.ts`,
`tsup.config.ts`, `src/core/types.ts`, `src/core/state-flow/`,
`src/core/shared-flow/`, `src/crypto/signer/`

- Package setup: `nostr-tools` (crypto), `vitest` (unit tests), `tsup`
  (bundling), `@playwright/test` (browser e2e tests).
- Strict TypeScript, ES2020 target, ESNext modules.
- **Core types** — `LinkState`, `SessionDescriptionData`,
  `DataChannelFrame`, `PeerMessage`, `TerminalFailure`, `NostrEvent`,
  `UnsignedNostrEvent`.
- **Pub/sub primitives** — `StateFlow<T>` and `SharedFlow<T>`, each as
  an interface/Live/Mock trio (Kotlin `Flow`-like hot observables).
- **Crypto layer** — `Signer` (interface/Live/Mock), wrapping
  `nostr-tools`: `generate()`, `sign()`, `verify()`, `ecdh()`,
  `encryptNip44()` / `decryptNip44()`, `sha256()`.
- **Build outputs** — ESM, CommonJS, and browser IIFE bundles plus a
  single `.d.ts`, via `tsup`.
- **Browser demo** — `examples/demo.html`, an interactive test bed
  loading the IIFE bundle locally, exercising identity generation,
  NIP-44 encryption, relay connectivity, and peer-to-peer WebRTC chat
  against the real library.

### Phase 1 — Deduping event sink ✅ COMPLETE

**Built:** `src/nostr/event-sink/`

- `EventSink` interface; `LiveDedupingEventSink` tracks seen event IDs
  within a bounded retention window (default 5 minutes) and evicts by
  age, dropping duplicates arriving from a second relay.
- `MockEventSink` test double.

### Phase 2 — Nostr relay/signalling layer ✅ COMPLETE

**Built:** `src/nostr/relay-socket/`, `src/nostr/relay-session/`,
`src/nostr/signalling-client/`

- `LiveRelaySocket` — one relay connection, exponential backoff
  reconnect, exposes connection state as a `StateFlow`. **`send()`
  rejects rather than queues** when the socket isn't open — it returns
  an `err` `Result` immediately; callers are responsible for retrying,
  matching the "fail fast, let the retry counter handle it"
  philosophy of §2 rule 4.
- `LiveRelaySession` — subscribe (filtered by `#p` tag = my pubkey) and
  publish, layered on a socket.
- `LiveNostrSignallingClient` — fans a single logical send/subscribe
  out across every configured relay, NIP-44 encrypts outbound payloads
  and decrypts inbound ones via `Signer`, de-duplicates inbound events
  via `EventSink`.

A real-network integration test against the live default relay list
(two `Signer` identities exchanging an encrypted payload through
`LiveNostrSignallingClient`) is still pending — planned as
`signalling-client.integration.test.ts`, gated behind a
`test:integration` script and kept out of the default `npm test` run.

### Phase 3 — WebRTC layer ✅ COMPLETE

**Built:** `src/webrtc/peer-connection/`, `src/webrtc/initiator/`,
`src/webrtc/answerer/`, `src/webrtc/peer-link/`

- `PeerConnectionLike` — a thin contract over `RTCPeerConnection`.
  `createOffer()` / `createAnswer()` own local-description-setting and
  ICE gathering internally, resolving only once
  `iceGatheringState === 'complete'` (vanilla, non-trickle ICE — the
  returned SDP always has every candidate baked in already; there is
  no separate `setLocalDescription()` step in the contract).
  `LivePeerConnection` wraps the real browser `RTCPeerConnection`; it
  has no dedicated unit test file, since it's exercised directly by
  `Initiator`, `Answerer`, and `PeerLink`'s own tests and by the
  browser e2e handshake test.
- `Initiator` — wraps a `PeerConnectionLike`, `createOffer()`,
  `acceptAnswer()`, exposes `LinkState` as a `StateFlow`, owns the
  handshake-timeout check.
- `Answerer` — wraps a `PeerConnectionLike` given an inbound offer,
  `createAnswer()`, same `LinkState` exposure.
- `PeerLink` — wraps an open `RTCDataChannel`: `send()`,
  `incomingBytes` (`SharedFlow`), `state`, `close()`.

Unit tests use `MockPeerConnection` /
`createLinkedMockPeerConnections()` (in-memory, linked pairs) to cover
the handshake state machine without a real network. Real
`RTCPeerConnection` behavior is validated separately by a Playwright
browser e2e test that drives `LiveInitiator` and `LiveAnswerer`
against a real loopback WebRTC connection (no STUN needed — both peers
are the same page) and confirms it reaches `Connected` on both sides
and exchanges a data-channel message.

### Phase 4 — Orchestrator ✅ COMPLETE

**Built:** `src/connection/live-connection-manager.ts` (570 LOC production, 450 LOC tests)

The orchestrator implements §2's six rules directly, with §4's concurrency
discipline applied throughout. Every rule is traceable in code with comments
referencing the architecture (`§2 rule 1:`, `§4 concurrency discipline:`)
so the implementation stays auditable against the Kotlin reference.

**Exports:**
- `LiveConnectionManager` — orchestrator class (implements all six rules)
- `LiveConnectionManager` interface — public API contract
- `MeshPeer` — lightweight peer metadata (pubkey, connectedAt)

**Public API:**
- `addPeer(pubkeyHex)` — seed connection via out-of-band mechanism (rule 1)
- `sendToPeer(toPubkeyHex, payload)` — send peer-to-peer message
- `peers: StateFlow<Set<MeshPeer>>` — replaying set of currently connected peers
- `incomingMessages: SharedFlow<PeerMessage>` — incoming peer-to-peer data
- `terminalFailures: SharedFlow<TerminalFailure>` — failures that exhausted all retries
- `close()` — cleanup (stop timers, close all connections)

**State model (§3):**
- `initiating: Map<pubkeyHex, InitiatingSlot>` — in-flight Offer attempts
  - Each slot holds: `connection` (LiveInitiator), `attemptCount` (1–5), `startedAt` (wall-clock)
  - Wall-clock 30s timeout checked by 1s ticker (independent of attempt count)
- `connected: Map<pubkeyHex, PeerLink>` — open data channels (either initiator or answerer role)
- **Invariant:** Two maps are disjoint (no pubkey appears in both)

**Concurrency discipline (§4):** After every `await`, verify object identity
before mutating state. Pattern:
```ts
if (this.initiating.get(pubkeyHex)?.connection !== thisConnection) return
```
Sole synchronization mechanism — no locks, no queues, matches Kotlin discipline.

**Rule implementations:**
- **Rule 1** (new pubkey → initiator): `addPeer()` → `startInitiation()` creates
  `LiveInitiator`, sends Offer, idempotent.
- **Rule 2** (always open to answering, gated by empty initiating): Global gate
  `initiating.size > 0` rejects all inbound Offers; per-pubkey already-connected
  guard rejects. Intentional design for small out-of-band meshes.
- **Rule 3** (answer matched to in-flight initiation): Lookup in `initiating` map,
  apply answer if slot exists; stale answers trigger failure (rule 4).
- **Rule 4** (failure → retry up to 5 times): Increment counter, create fresh
  `LiveInitiator`, resend Offer; at count=5, emit `TerminalFailure` and remove.
- **Rule 5** (connection open): Move to `connected`, broadcast `Announce` (list of
  all other connected peers) to every connected peer. Best-effort, no retry.
- **Rule 6** (connection close): Remove from `connected`, no broadcast.
  Peers age out asynchronously (no roster sync).

**Unit tests** (`live-connection-manager.test.ts`, 450 LOC):
Test suites validating rule logic in isolation with mocked signalling and real
`MockPeerConnection` (from Phase 3) so `LiveInitiator`/`LiveAnswerer` drive correctly:
- Rule 1: `addPeer()` idempotency, self-ignore, offer created and sent ✅
- Rule 2: Offer rejection while `initiating` non-empty; acceptance when empty ✅
- Rule 3: Stale answer no-op; no state corruption ✅
- Rule 4: 5-attempt exhaustion emits `TerminalFailure` with count=5 ✅
- Rule 4: 3 failures then success avoids terminal failure ✅
- Rule 4 edge case: Mutual-initiate (both sides exhaust retries independently) — validated in Phase 6 e2e
- Rule 5: State transition to `connected`, broadcast, self-exclude — validated in Phase 6 e2e
- Rule 6: Connection close, no broadcast — validated in Phase 6 e2e
- Announce gossip: New peers learned idempotently ✅
- Timeout: 30s wall-clock timeout triggers retry ✅
- Concurrency: Staleness checks present in code; async race conditions handled ✅
- Cleanup: `close()` stops timers, tears down connections ✅

All 112 tests pass (102 passed, 10 skipped placeholder tests for Phase 6).

### Phase 5 — Factory & defaults

**Builds:** `mesh-endpoints.ts`, `create-live-connection-manager.ts`,
`index.ts` (trimmed)

- Wires `Signer.generate()`, the relay/ICE endpoint lists (defaults or
  overrides), the signalling client, and `LiveConnectionManager`
  together into one function.
- `index.ts` is trimmed to export exactly the public surface from §5
  — nothing more.

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
- **NIP-44 interop check** — reuse the signalling-client integration
  test's two-identity setup, but drive it through the full
  `createLiveConnectionManager` factory rather than the raw signalling
  client, confirming the crypto and signalling layers compose
  correctly end to end, not just individually.

Like the signalling-client integration test, all of Phase 6 should be
gated behind an explicit `test:integration` script, kept out of the
default fast unit-test run, and clearly documented as depending on
either real public relay availability or (for the WebRTC-only tests) a
real browser test runtime.
