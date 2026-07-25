# Coralie Browser Runtime

Coralie is a lightweight browser runtime and WebRTC mesh library for portable HTML applications.

Its primary use case is a small live application—especially a party game—in which participants are online at the same time and join through an application-defined room code. A developer can write one HTML file, host it on a static site, or import the same file into the Coralie Android application without building a separate Android project or operating a conventional multiplayer backend.

A Coralie page receives a shared `window.Coralie` API for:

- explicit peer-to-peer connections;
- binary application messaging;
- persistent key-value storage;
- HTTPS requests; and
- host-managed one-shot timers.

Browser and Android participants can use the same page and exchange application messages directly.

> [!IMPORTANT]
> Coralie removes the need for an **application gameplay server**, but it is not infrastructure-free. The browser runtime uses Nostr relays for encrypted WebRTC signalling and STUN servers for connectivity.

## Documentation

- [Coralie Runtime API v2](docs/runtime-api-v2.md) — normative page-facing API contract.
- [Browser and Android compatibility](docs/compatibility.md) — supported combinations, platform differences, and portability rules.

## Repository outputs

This repository produces two related public surfaces. The `docs/` directory is also included in the package so the README links remain valid for package consumers.

### 1. Static browser host

```text
dist/Coralie/v2/host.js
```

This standalone IIFE installs the browser implementation at:

```js
window.Coralie
```

A portable page normally consumes this output:

```html
<script src="./Coralie/v2/host.js"></script>
```

When the same page runs inside Coralie for Android, Android serves a compatible script at the same path. If the embedding environment has already installed `window.Coralie`, the browser bundle returns without replacing it.

### 2. JavaScript/TypeScript library

```text
dist/index.js
dist/index.cjs
dist/index.d.ts
dist/index.d.cts
```

The package exports the browser host, installer, connection-manager factory, public flow interfaces, and public types for applications that need programmatic access below the static facade.

Runtime exports:

```ts
BrowserCoralieHost
installBrowserCoralie
MAX_HTTP_RESPONSE_BYTES
createLiveConnectionManager
LinkState
```

The root library entry also installs `window.Coralie` automatically when imported in a browser and no host already exists. Because this is an intentional import side effect, the package metadata marks the package as side-effectful.

## Intended use cases

Coralie is suited to:

- live party games;
- classroom and workshop activities;
- small collaborative utilities;
- local or remote multiplayer prototypes;
- static-hosted applications that need direct peer messaging; and
- Android/browser applications sharing one HTML implementation.

Coralie is not intended to provide:

- matchmaking or public room discovery;
- user accounts or identity verification;
- offline message delivery;
- server-authoritative game state;
- durable shared cloud state;
- anti-cheat enforcement;
- moderation infrastructure;
- guaranteed connectivity through every NAT or firewall; or
- large-room media or file distribution.

## Current networking limitations

### Explicit joining only

Coralie does not discover nearby rooms or publish a room list. A page must obtain another participant's 64-character hexadecimal public key through an out-of-band mechanism such as:

- a reversible room-code encoding;
- a QR code;
- a copied link;
- a messaging application; or
- direct entry.

A genuinely short room code requires a directory service that maps the short code to the full public key. Such a directory is application infrastructure and is not part of Coralie.

### Browser-only rooms

In the current Coralie topology, a room containing only browser clients is not generally supported because browser ICE candidates are affected by mDNS handling. Mixed Android/browser rooms are supported, and Android-to-Android rooms are supported.

See [Browser and Android compatibility](docs/compatibility.md) for the current topology matrix.

### No TURN fallback

The default ICE configuration contains STUN servers but no TURN server. If two devices cannot establish a direct WebRTC path, the connection fails rather than relaying application traffic through TURN.

Some corporate networks, VPNs, carrier networks, firewalls, and symmetric NAT configurations may therefore be unsupported. Same-LAN operation is normally the most reliable.

### Direct links, not automatic application relaying

Coralie can announce known peer identities and attempt additional direct links. It does not automatically forward arbitrary application messages through another participant.

An application that needs replicated room state must define its own broadcast, rebroadcast, snapshot, and conflict-resolution rules.

## Quick start

### Repository layout for a static page

```text
your-site/
├── index.html
└── Coralie/
    └── v2/
        ├── host.js
        └── host.js.map
```

`host.js.map` is optional at runtime but recommended for readable browser debugging.

### Minimal page

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coralie quick start</title>
</head>
<body>
  <p id="status">Starting…</p>
  <p>My public key: <code id="my-key"></code></p>

  <label>
    Peer public key
    <input id="peer-key" autocomplete="off">
  </label>
  <button id="connect">Connect</button>

  <label>
    Message
    <input id="message" value="Hello from Coralie">
  </label>
  <button id="send">Send</button>

  <pre id="log"></pre>

  <script src="./Coralie/v2/host.js"></script>
  <script>
    "use strict";

    const host = window.Coralie;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const statusElement = document.querySelector("#status");
    const myKeyElement = document.querySelector("#my-key");
    const peerKeyInput = document.querySelector("#peer-key");
    const messageInput = document.querySelector("#message");
    const logElement = document.querySelector("#log");

    function log(message) {
      logElement.textContent += message + "\n";
    }

    window.addEventListener("coralie:peers", event => {
      statusElement.textContent =
        `${event.detail.length} peer(s) connected`;
    });

    window.addEventListener("coralie:message", event => {
      const detail = event.detail;
      const text = decoder.decode(
        Uint8Array.from(detail.payload),
      );

      log(`Received from ${detail.fromPubkeyHex}: ${text}`);
    });

    window.addEventListener("coralie:terminalFailure", event => {
      const detail = event.detail;
      log(
        `Connection failed for ${detail.pubkeyHex}: ` +
        (detail.reason || "retry limit reached"),
      );
    });

    document.querySelector("#connect").addEventListener(
      "click",
      async () => {
        try {
          await host.addPeer(peerKeyInput.value.trim());
          log("Connection attempt started");
        } catch (error) {
          log(error.stack || String(error));
        }
      },
    );

    document.querySelector("#send").addEventListener(
      "click",
      async () => {
        try {
          await host.sendMessage(
            peerKeyInput.value.trim(),
            encoder.encode(messageInput.value),
          );
          log("Message accepted by the connected data channel");
        } catch (error) {
          log(error.stack || String(error));
        }
      },
    );

    async function start() {
      if (!host) {
        throw new Error("window.Coralie is unavailable");
      }

      if (Number(await host.apiVersion()) !== 2) {
        throw new Error("Coralie Runtime API v2 is required");
      }

      myKeyElement.textContent = await host.getPubkey();

      // Event listeners are installed before the initial snapshot is read.
      const peers = JSON.parse(
        String(await host.getPeersJson() || "[]"),
      );
      statusElement.textContent =
        `${peers.length} peer(s) connected`;
    }

    start().catch(error => {
      statusElement.textContent = "Coralie failed to start";
      log(error.stack || String(error));
    });
  </script>
</body>
</html>
```

### Serve the page

Do not rely on opening the file through `file://`.

For local development:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Use HTTPS for non-local deployments. Static hosts such as GitHub Pages already provide HTTPS.

## Portable page rules

These rules prevent most browser/Android inconsistencies.

### Use only `window.Coralie`

Do not access:

- browser runtime classes;
- the runtime's relay sockets;
- the runtime's `RTCPeerConnection` objects;
- Android's private `CoralieNative` bridge; or
- implementation-specific internal events.

### Await every method

Several browser methods currently return synchronously, but Android operations may perform native work or wait for a permission decision.

Use:

```js
const pubkey = await window.Coralie.getPubkey();
await window.Coralie.storageSetItem("game:v1:name", "Aki");
```

### Register events before reading snapshots

```js
window.addEventListener("coralie:peers", onPeers);

const peers = JSON.parse(
  String(await window.Coralie.getPeersJson() || "[]"),
);

renderPeers(peers);
```

### Treat messages as untrusted bytes

Coralie transports bytes. It does not validate the application protocol.

```js
const payload = new TextEncoder().encode(
  JSON.stringify({
    protocol: 1,
    type: "answer-updated",
    roundId: "round-4",
    answer: "Iceland",
    sequence: 18,
  }),
);

await host.sendMessage(peerPubkeyHex, payload);
```

On receipt, validate the parsed object, sender authority, identifiers, ranges, and state transition before applying it.

### Namespace storage keys

Browser storage is origin-scoped. Pages under the same origin share `localStorage`.

```js
const STORAGE_PREFIX = "com.example.word-game:v2:";
```

### Use `null` to request a generated timer ID

```js
const id = await host.timerQueue(null, 30, "refresh");
```

An empty string is a literal timer ID on both current hosts; use `null` when the host should generate an ID.

### Use absolute deadlines for gameplay

Browser timers may be delayed when a tab is backgrounded or a device sleeps.

Replicate an absolute deadline:

```js
const deadlineMs = Date.now() + 90_000;
```

Use `timerQueue()` as a wake-up signal, then compare `Date.now()` with the replicated deadline.

## API overview

The complete contract is documented in [docs/runtime-api-v2.md](docs/runtime-api-v2.md).

### Host information

| Method | Purpose |
|---|---|
| `apiVersion()` | Returns `2`. |
| `hostKind()` | Returns `"browser"` or `"android-native"`. |

### Mesh

| Method | Purpose |
|---|---|
| `getPubkey()` | Returns the current 64-character mesh identity. |
| `addPeer(pubkeyHex)` | Starts a connection attempt. |
| `sendMessage(toPubkeyHex, payload)` | Sends bytes to a directly connected peer. |
| `getPeersJson()` | Returns a JSON-encoded peer snapshot. |
| `reset()` | Replaces the mesh and returns the new identity. |
| `close()` | Closes the mesh without clearing storage or timers. |

### Storage

| Method | Purpose |
|---|---|
| `storageGetItem(key)` | Reads a string or returns `null`. |
| `storageSetItem(key, value)` | Stores a string. |
| `storageRemoveItem(key)` | Removes a key. |

### HTTP

| Method | Purpose |
|---|---|
| `httpRequestJson(requestJson)` | Performs a JSON-described HTTPS request. |

Both hosts enforce a 64 MiB response limit. Browser requests remain subject to CORS. Android requests are capability- and domain-permission controlled.

### Timers

| Method | Purpose |
|---|---|
| `timerQueue(id, delaySeconds, payload)` | Creates or replaces a one-shot timer. |
| `timerCancel(id)` | Cancels a timer. |
| `timerListJson()` | Returns active timer IDs and remaining time. |

### Events

| Event | Detail |
|---|---|
| `coralie:peers` | Complete directly connected peer snapshot. |
| `coralie:message` | Incoming application bytes. |
| `coralie:terminalFailure` | Connection retries were exhausted. |
| `coralie:timerFired` | A queued timer reached its deadline. |

## Room state and application protocol

Coralie supplies connections, not game semantics.

A multiplayer page should define:

- a protocol version;
- a room or game identifier;
- round or phase identifiers;
- sequence numbers or version counters;
- authority rules;
- join-state synchronisation;
- duplicate handling;
- stale-message rejection;
- participant departure behaviour; and
- bounded message and collection sizes.

A useful envelope is:

```json
{
  "protocol": 1,
  "type": "round-started",
  "gameId": "owner-key:1784955600000",
  "roundId": "round-4",
  "sequence": 18,
  "data": {}
}
```

For a small live game, a common design is:

1. one participant creates the initial room identity;
2. joiners connect to that identity using a room code;
3. peers exchange identities through Coralie's peer announcements;
4. the application distributes a bounded current-state snapshot;
5. later changes use small idempotent events; and
6. reconnecting or late participants request a fresh snapshot.

Coralie does not automatically elect a host or decide which state wins.

## Hosting

Any static host that serves the HTML page and JavaScript bundle over HTTPS can be used, including:

- GitHub Pages;
- GitLab Pages;
- Cloudflare Pages;
- Netlify;
- an ordinary HTTPS web server; or
- a local development server.

### Relative runtime path

Prefer:

```html
<script src="./Coralie/v2/host.js"></script>
```

This works for project sites such as:

```text
https://example.github.io/my-game/
```

An absolute path:

```html
<script src="/Coralie/v2/host.js"></script>
```

resolves from the domain root and often causes a `404` on project sites.

Android supports both relative and root-relative compatibility routes, but a relative path remains the portable default.

### GitHub Pages checklist

1. Commit the exact case-sensitive path `Coralie/v2/host.js`.
2. Confirm the configured Pages branch and directory contain the file.
3. Use a relative script URL.
4. Wait for deployment completion.
5. Open the runtime URL directly.
6. Check the browser Network panel for `404`, CSP, or MIME-type errors.
7. Hard-refresh if a previous failed deployment was cached.

### Content Security Policy

A strict policy must permit:

- the local runtime script;
- secure WebSocket connections to configured Nostr relays; and
- HTTPS requests needed by the page.

The required `connect-src` values depend on the runtime build's relay endpoints and the application's own HTTP destinations.

## Browser requirements

The browser host requires a modern environment with:

- `RTCPeerConnection` and WebRTC data channels;
- `WebSocket`;
- Web Crypto;
- Fetch and readable response streams;
- `TextEncoder` and `TextDecoder`;
- `Uint8Array`;
- `CustomEvent`; and
- `localStorage` for durable browser storage.

The host falls back to in-memory storage when `localStorage` is unavailable or throws.

API availability does not guarantee that every browser, operating system, and network combination can establish a WebRTC connection. Maintain a tested-browser matrix for releases.

## Networking model

```text
┌──────────────────────────────┐
│ Static HTML application      │
│ window.Coralie               │
└──────────────┬───────────────┘
               │ encrypted signalling
               ▼
┌──────────────────────────────┐
│ Configured Nostr relays      │
│ Event kind 28080             │
└──────────────┬───────────────┘
               │ SDP offer/answer exchange
               ▼
┌──────────────────────────────┐
│ WebRTC data channel          │
│ Direct application messages  │
└──────────────────────────────┘
```

The default browser build currently uses these Nostr relays:

```text
wss://relay.damus.io
wss://nos.lol
wss://nostr.oxtr.dev
wss://purplerelay.com
```

The default ICE configuration currently uses:

```text
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
stun:stun2.l.google.com:19302
stun:stun3.l.google.com:19302
stun:stun4.l.google.com:19302
stun:stun.cloudflare.com:3478
```

These are external services and are not controlled by Coralie. Their availability, policy, latency, and continued operation are not guaranteed.

The standalone `host.js` facade does not expose runtime endpoint configuration. The lower-level library accepts relay and ICE options when creating a connection manager.

## Library use

After building the repository, the root entry exports the low-level mesh factory:

```ts
import {
  createLiveConnectionManager,
  type LiveConnectionManager,
} from "./dist/index.js";

const manager = createLiveConnectionManager({
  relayUrls: ["wss://relay.example.com"],
  iceServers: [
    { urls: ["stun:stun.example.com:3478"] },
  ],
});
```

The manager exposes:

- `myPubkeyHex`;
- a replaying `peers` state flow;
- `incomingMessages`;
- `terminalFailures`;
- `addPeer()`;
- `sendToPeer()`; and
- `close()`.

The lower-level API is useful for framework integrations or custom hosts. Page applications intended to run on both browser and Android should prefer `window.Coralie`.

### TypeScript declarations

The library build already generates:

```text
dist/index.d.ts
```

It includes:

- all exported package interfaces and types;
- the `CoralieHost` interface; and
- global declarations for `window.Coralie` and Coralie DOM events.

A second handwritten declaration file is not required for package consumers. A separate `dist/Coralie/v2/host.d.ts` would only be useful as an optional editor aid for standalone HTML projects that copy `host.js` without installing the package.

## Security and privacy

### Treat pages as code

A Coralie page can store data, contact HTTPS services, and communicate with peers. Run pages only from trusted sources.

### Treat peers as untrusted

A public key identifies a mesh endpoint. It is not proof of a real-world identity, account ownership, age, or permission to perform an application action.

Validate all received data and enforce application-level authority rules.

### Signalling metadata

Signalling content is encrypted, but public relay operators can observe metadata such as public keys, event timing, and traffic patterns.

STUN services and connected WebRTC peers receive network information required for connection establishment.

### Browser storage

Browser storage:

- is not encrypted by Coralie;
- is readable by scripts on the same origin;
- can be cleared by the user or browser; and
- can be unavailable in restricted contexts.

Do not store secrets without a separate encryption and key-management design.

### HTTP credentials

The browser host uses `credentials: "omit"` and `referrerPolicy: "no-referrer"`. Ambient cookies and browser credentials are not sent.

Explicit authentication headers remain application data and should be handled carefully.

## Performance and scale

Coralie is designed for small explicit rooms.

A full mesh can require a direct connection between every pair of participants:

```text
n × (n - 1) / 2
```

The number of links therefore grows quadratically.

Keep application messages compact. The runtime serialises byte payloads into an internal frame, so very large messages create memory and encoding overhead. Use bounded snapshots and small state changes rather than unbounded full-state broadcasts.

Numerical comparisons with other libraries should include a reproducible benchmark recording:

- library versions;
- signalling provider and endpoints;
- browser, Android, and operating-system versions;
- LAN or internet conditions;
- cold or warm relay connections;
- participant count;
- measurement start and end points;
- sample count;
- median and p95 connection times; and
- failure rate.

## Repository structure

```text
docs/
├── runtime-api-v2.md
└── compatibility.md

dist/
├── Coralie/v2/
│   ├── host.js
│   └── host.js.map
├── index.js
├── index.cjs
├── index.d.ts
├── index.d.cts
└── source maps

examples/
└── demo.html

scripts/
└── clean.mjs

src/
├── connection/       # mesh orchestration
├── coralie/          # window.Coralie facade and shared API types
├── core/             # flows and shared public types
├── crypto/           # signing implementation
├── nostr/            # relay and signalling stack
├── webrtc/           # peer connection and data-channel stack
├── create-live-connection-manager.ts
├── internal-testing-exports.ts
├── mesh-endpoints.ts
└── index.ts

test-dist/            # generated internal browser test harness; not packaged
```

`examples/demo.html` is a developer test bed for the connection stack. It uses internal testing exports and should not be treated as the minimal portable page example.

## Development

Install dependencies:

```bash
npm ci
```

Run unit tests:

```bash
npm test
```

Run TypeScript checking:

```bash
npm run typecheck
```

Remove generated outputs:

```bash
npm run clean
```

Build both public distributions and the internal test harness:

```bash
npm run build
```

Build only the package library:

```bash
npm run build:library
```

Build only the standalone host:

```bash
npm run build:host
```

Build only the internal browser test harness:

```bash
npm run build:test-harness
```

The test harness is written to `test-dist/`, outside the package's public `dist/` directory.

Run Playwright tests:

```bash
npm run test:e2e
```

Run the relay integration suite headlessly:

```bash
npm run test:integration:headless
```

Run the relay integration suite in a visible browser:

```bash
npm run test:integration
```

Integration tests use real browser networking and may depend on external relay availability.

### Generated output

Edit source files under `src/`; do not patch minified `dist/Coralie/v2/host.js` directly.

A release build should produce:

```text
dist/index.js
dist/index.cjs
dist/index.d.ts
dist/index.d.cts
dist/Coralie/v2/host.js
dist/Coralie/v2/host.js.map
```

### Required conformance coverage

Browser and Android should be tested against the same page-facing contract, including:

- API version and host kind;
- required method presence;
- public-key validation and normalisation;
- peer snapshot schema;
- unsigned incoming byte arrays;
- terminal-failure schema;
- storage missing-key behaviour;
- HTTP response shape and 64 MiB limit;
- timer replacement, cancellation, listing, and events;
- `reset()` identity replacement; and
- `close()` peer cleanup.

See the conformance section in [docs/runtime-api-v2.md](docs/runtime-api-v2.md).

## Troubleshooting

### `window.Coralie` is unavailable

Check that:

1. `host.js` did not return `404`;
2. the path uses the correct letter casing;
3. the runtime script appears before application scripts;
4. Content Security Policy permits the script;
5. the deployed branch includes the file; and
6. a stale deployment is not cached.

### The runtime loads but keeps an existing host

This is deliberate. The standalone browser bundle does not overwrite an existing `window.Coralie`, allowing Android to provide the compatible native implementation.

```js
console.log(await window.Coralie.hostKind());
```

### `addPeer()` returns but no peer appears

`addPeer()` starts an attempt. It does not wait for the data channel to open.

Listen for:

```text
coralie:peers
coralie:terminalFailure
```

Also verify the full key, peer availability, relay access, network topology, and TURN limitation.

### `Peer is not connected`

Wait until the peer appears in `coralie:peers` or `getPeersJson()` before calling `sendMessage()`.

### HTTP returns status `599`

Parse the JSON string in `response.body`. It includes the stage, category, safe URL, elapsed time, exception names, and response-limit fields when applicable.

Common causes are invalid request JSON, a non-HTTPS URL, CORS, DNS or transport failure, cancellation, and responses over 64 MiB.

### Storage disappears

Possible causes include unavailable `localStorage`, private browsing restrictions, user clearing, an origin or port change, or use of the in-memory fallback.

### The room stops working after reload

The browser host generated a new mesh identity. Generate and distribute new room information.

### A timer fires late

Browsers throttle background work. Compare the current time against an absolute deadline rather than treating the callback as precise elapsed time.

## Versioning

The static host path contains the major API version:

```text
Coralie/v2/host.js
```

Maintain observable v2 behaviour for the lifetime of that path. Breaking page-facing changes should use a new path such as `Coralie/v3/host.js`.

Pages should verify the version they require:

```js
const required = 2;
const actual = Number(await window.Coralie.apiVersion());

if (actual !== required) {
  throw new Error(
    `Coralie API v${required} required; found v${actual}`,
  );
}
```

## Contributing

Changes should preserve:

- one portable page-facing API;
- single-file HTML application development;
- static browser deployment;
- Android/browser interoperability;
- explicit joins without native discovery;
- small, understandable networking components; and
- visible, actionable failures.

Before submitting a change:

1. add or update tests;
2. run type checking and unit tests;
3. run relevant Playwright tests;
4. confirm browser/Android contract compatibility;
5. update documentation for observable behaviour; and
6. document new infrastructure, security, or privacy implications.

## No licence

This repository is not distributed under an open-source licence. The package metadata uses `UNLICENSED` to make that explicit. No permission to use, copy, modify, or redistribute the project is granted except where separately authorised by the copyright holder.

Third-party dependencies remain subject to their own licences.
