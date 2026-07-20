# Phase 0 — Scaffolding Checklist

## ✅ Completed

- [x] `package.json` — dependencies, scripts, exports field
- [x] `tsconfig.json` — strict TypeScript config targeting ES2020
- [x] `vitest.config.ts` — test runner with globals enabled
- [x] `.gitignore` — Node.js, build, IDE patterns
- [x] `README.md` — project overview and development quickstart
- [x] `src/` directory structure (all phases pre-created)

## ✅ Phase 0 Implementations

### Core Types (`src/types.ts`)
- [x] `LinkState` enum — connection states (Initiating, Offering, Answering, Connecting, Connected, Failed, Closed)
- [x] `SessionDescriptionData` — WebRTC SDP wrapper
- [x] `DataChannelFrame` — discriminated union of frame types (Offer, Answer, IceCandidate, Announce, Data)
- [x] `PeerMessage` — application-level peer message
- [x] `TerminalFailure` — failure record with pubkey and attempt count
- [x] `NostrEvent` & `UnsignedNostrEvent` — Nostr event types

### Pub/Sub (`src/emitter.ts`)
- [x] `StateFlow<T>` interface — hot observable with latest value
- [x] `SharedFlow<T>` interface — hot event broadcaster
- [x] `createStateFlow()` — factory with emit/subscribe/asReadOnly
- [x] `createSharedFlow()` — factory with emit/subscribe/asReadOnly

### Crypto (`src/crypto/signer.ts`)
- [x] `Signer` class wrapping `nostr-tools`
- [x] `Signer.generate()` — random key pair
- [x] `Signer.fromSecretKeyHex()` — restore from hex
- [x] `Signer.sign()` — sign Nostr events (finalizes with id, sig)
- [x] `Signer.verify()` — verify event signatures
- [x] `Signer.ecdh()` — shared secret derivation
- [x] `Signer.encryptNip44()` / `decryptNip44()` — NIP-44 v2 encryption
- [x] `Signer.sha256()` / `sha256Hex()` — hashing utilities

### Public API (`src/index.ts`)
- [x] Exports types, Signer, emitter factories (Phase 6 will add createLiveConnectionManager)

## ✅ Phase 0 Tests

### `src/crypto/signer.test.ts`
- [x] `Signer.generate()` creates fresh random pubkeys
- [x] `sign()` produces valid events with id and sig
- [x] `verify()` accepts signed events, rejects tampered ones
- [x] ECDH shared secrets match between peers
- [x] NIP-44 encrypt/decrypt round-trips correctly
- [x] Secret key export/import round-trips
- [x] `sha256()` hash utilities

### `src/emitter.test.ts`
- [x] StateFlow holds initial value
- [x] StateFlow notifies subscribers on emit
- [x] Multiple subscribers all receive updates
- [x] Unsubscribe stops notifications
- [x] SharedFlow only broadcasts to current subscribers (future events)
- [x] asReadOnly() hides emit method

## ⏭️ Next Steps

### Before proceeding to Phase 1:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run tests:**
   ```bash
   npm test
   ```
   All Phase 0 tests should pass. You should see ~20 passing tests.

3. **Verify build works:**
   ```bash
   npm run build
   ```
   Should generate:
   - `dist/index.mjs` — ESM (for npm)
   - `dist/index.cjs` — CommonJS (for npm)
   - `dist/index.umd.js` — UMD browser bundle ✅
   - `dist/index.d.ts` — TypeScript definitions

4. **Test the browser bundle locally:**
   ```bash
   # Serve current directory
   python3 -m http.server 8000
   # or: npx http-server
   
   # Open http://localhost:8000/demo.html
   ```
   You should see the interactive demo. Try "Generate Identity" and "Sign & Verify".

4. **Commit to git:**
   ```bash
   git init
   git add .
   git commit -m "Phase 0: Scaffolding, types, crypto, pub/sub"
   ```

### Phase 1 (when ready):

**Deduping event sink** — Start implementing `src/nostr/deduping-event-sink.ts`:
- Cross-relay deduplication by event ID
- Holds incoming Nostr events temporarily
- Garbage-collects by age to prevent memory leak

See ARCHITECTURE.md §5 Phase 1 for full spec.

---

## Project Layout

```
nostr-webrtc-mesh/
├── package.json                 # Dependencies: nostr-tools, vitest, tsup, etc.
├── tsconfig.json               # Strict ES2020, ESNext modules
├── vitest.config.ts            # Test runner config
├── .gitignore
├── README.md
├── ARCHITECTURE.md             # Design spec (7 phases)
├── PHASE_0_CHECKLIST.md        # This file
│
├── src/
│   ├── index.ts                # Public API (re-exports)
│   ├── types.ts                # Core types (LinkState, DataChannelFrame, etc.)
│   ├── emitter.ts              # StateFlow, SharedFlow
│   ├── emitter.test.ts         # Tests for pub/sub
│   │
│   ├── crypto/
│   │   ├── signer.ts           # Signer (crypto operations)
│   │   └── signer.test.ts      # Tests for signing, encryption
│   │
│   ├── nostr/                  # Phase 2–3: Signalling layer
│   ├── webrtc/                 # Phase 4: WebRTC peer connections
│   └── orchestrator/            # Phase 5: State machine (6 rules)
│
└── dist/                        # Build output (created by npm run build)
    ├── index.mjs
    ├── index.cjs
    ├── index.d.ts
    └── (other generated files)
```

## Development Commands

```bash
npm test                # Run unit tests once
npm test:watch        # Watch mode (re-run on change)
npm test:integration  # Run slow integration tests (Phase 7)
npm run build         # Compile src/ → dist/
```

## Notes

- **Concurrency model**: JS single-threaded with identity checks after awaits (no locks).
- **Crypto**: All cryptography via `nostr-tools` + `@noble` audited libs.
- **State pattern**: Two disjoint maps (`initiating`, `connected`) — Phase 5 will implement orchestrator.
- **WebRTC testing**: Phase 4+ will need browser runtime (Vitest + `@vitest/browser`).

Proceed to Phase 1 when ready! 🚀
