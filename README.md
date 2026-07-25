# Coralie Browser Runtime

Coralie is a lightweight browser runtime for portable, single-file HTML applications.

A page written for Coralie can be:

- hosted as an ordinary static webpage;
- imported into the Coralie Android application; and
- used in the same live peer-to-peer session by browser and Android participants.

The runtime exposes a small `window.Coralie` API for:

- explicit peer-to-peer connections;
- binary application messaging;
- persistent key-value storage;
- HTTPS requests; and
- host-managed timers.

Coralie is designed primarily for small live applications and party games in which all participants are present at the same time and join using an application-defined room code. It deliberately does not provide matchmaking, public discovery, user accounts, or a persistent multiplayer backend.

> [!IMPORTANT]
> Coralie removes the need for an **application server** for live peer messaging, but it is not completely infrastructure-free. The browser runtime currently uses public Nostr relays for encrypted WebRTC signalling and public STUN servers for connectivity.

---

## Contents

- [Why Coralie](#why-coralie)
- [Current limitations](#current-limitations)
- [How portability works](#how-portability-works)
- [Quick start](#quick-start)
- [Hosting the runtime](#hosting-the-runtime)
- [Browser requirements](#browser-requirements)
- [API conventions](#api-conventions)
- [API reference](#api-reference)
  - [Host information](#host-information)
  - [Peer mesh](#peer-mesh)
  - [Storage](#storage)
  - [HTTP](#http)
  - [Timers](#timers)
  - [Events](#events)
- [Room codes and joining](#room-codes-and-joining)
- [Application messaging](#application-messaging)
- [Cross-platform development guidance](#cross-platform-development-guidance)
- [Networking model](#networking-model)
- [Lifecycle and persistence](#lifecycle-and-persistence)
- [Security and privacy](#security-and-privacy)
- [Performance and scalability](#performance-and-scalability)
- [Troubleshooting](#troubleshooting)
- [Developing the runtime](#developing-the-runtime)
- [Versioning](#versioning)
- [Contributing](#contributing)
- [Licence](#licence)

---

## Why Coralie

Many small multiplayer applications do not need a conventional backend.

A party game, classroom activity, workshop tool, or temporary collaborative utility often has much simpler requirements:

- all participants are online at the same time;
- participants already know one another;
- a room code is sufficient to join;
- state can be exchanged directly between devices;
- the application does not need global discovery or matchmaking; and
- developers want to edit and deploy one HTML file.

Coralie focuses on that narrower problem.

Instead of requiring separate Android and web implementations, a page uses the same host interface in both environments:

```js
window.Coralie
```

This lets developers build the application with ordinary HTML, CSS, and JavaScript, then run it:

- in a desktop or mobile browser;
- inside the Coralie Android host; or
- in a mixed Android/browser room.

The peer connection layer is intentionally small and specialised for explicit joins rather than general-purpose discovery.

---

## Current limitations

Read these before designing an application around Coralie.

### No native peer discovery

Coralie does not search for nearby rooms or list public sessions.

A page must obtain another participant's 64-character hexadecimal public key through an application-defined mechanism such as:

- a room-code encoding;
- a QR code;
- a copied link;
- a messaging application; or
- manual entry.

### Browser-only rooms are currently restricted

Because of the way browsers expose local ICE candidates through mDNS, direct browser-to-browser operation is restricted in the current Coralie topology.

Current intended combinations are:

| Participants | Current status |
|---|---|
| Android ↔ Android | Supported |
| Android ↔ browser | Supported |
| Browser-only room | Not supported as a general topology |
| Same-LAN operation | Usually the most reliable |
| Restrictive NAT or firewall | May fail |
| TURN fallback | Not available |

An Android participant can act as an application-level intermediary for a mixed room. Coralie does **not** automatically relay arbitrary application messages between peers; the application must deliberately rebroadcast or replicate any state that needs to cross such a topology.

### No TURN relay

Coralie uses STUN but does not currently provide TURN.

When two participants cannot establish a direct WebRTC route, the connection fails instead of falling back to a relayed data channel. Some corporate networks, carrier networks, VPNs, firewalls, and symmetric NAT configurations may therefore be unsupported.

### No authoritative server

All connected participants should be treated as untrusted clients.

Coralie does not provide:

- server-authoritative state;
- anti-cheat enforcement;
- account authentication;
- durable shared state;
- moderation services;
- matchmaking; or
- offline message delivery.

Applications must validate every received message and define their own state-conflict rules.

### Browser HTTP requests remain subject to CORS

`httpRequestJson()` uses the browser's Fetch API. It is not an external proxy.

The destination server must allow the page's origin through its CORS policy. The Android host uses a native request implementation and therefore has different transport constraints.

### Browser identity and timers are not durable

In the current browser implementation:

- a new mesh identity is generated when the page loads;
- reloading the page invalidates room information based on the old identity;
- queued timers exist only for the current page session; and
- timers are lost when the page is reloaded or closed.

Browser storage is persistent when `localStorage` is available.

---

## How portability works

A Coralie page loads the same runtime path in every environment:

```html
<script src="./Coralie/v2/host.js"></script>
```

On an ordinary webpage, `host.js` installs the browser implementation at:

```js
window.Coralie
```

In the Android runtime, the native host can expose its own compatible `window.Coralie` object before the script executes. The browser bundle does not overwrite an existing implementation.

This means application code should use only the public facade:

```js
const host = window.Coralie;
```

Do not depend on private browser internals or an Android JavaScript bridge.

### Runtime selection

```js
const host = window.Coralie;

console.log(await host.apiVersion()); // 2
console.log(await host.hostKind());   // "browser" or an Android host identifier
```

Although several browser methods currently return synchronously, portable application code should always use `await`. Native implementations may need to perform asynchronous work or display a permission prompt.

---

## Quick start

### 1. Add the runtime

Place the browser distribution beside your page:

```text
your-site/
├── index.html
└── Coralie/
    └── v2/
        ├── host.js
        └── host.js.map
```

`host.js.map` is optional at runtime but recommended for readable browser debugging.

### 2. Load it before application code

```html
<script src="./Coralie/v2/host.js"></script>
<script>
  // Application code runs here.
</script>
```

### 3. Use the host

The following page displays its identity, accepts another participant's public key, and exchanges text messages.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>Coralie quick start</title>
</head>
<body>
  <p id="status">Starting Coralie…</p>
  <p>
    My public key:
    <code id="my-key"></code>
  </p>

  <label>
    Peer public key
    <input id="peer-key" autocomplete="off">
  </label>
  <button id="connect">Connect</button>

  <hr>

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

    function requireApiV2() {
      if (!host) {
        throw new Error("window.Coralie is unavailable");
      }

      if (Number(host.apiVersion()) !== 2) {
        throw new Error(
          "This page requires Coralie API v2"
        );
      }
    }

    window.addEventListener("coralie:peers", event => {
      const peers = event.detail;
      statusElement.textContent =
        `${peers.length} peer(s) connected`;
    });

    window.addEventListener("coralie:message", event => {
      const message = event.detail;
      const text = decoder.decode(
        Uint8Array.from(message.payload)
      );

      log(`Received from ${message.fromPubkeyHex}: ${text}`);
    });

    window.addEventListener(
      "coralie:terminalFailure",
      event => {
        const failure = event.detail;
        log(
          `Could not connect to ${failure.pubkeyHex}: ` +
          failure.reason
        );
      }
    );

    document.querySelector("#connect").addEventListener(
      "click",
      async () => {
        try {
          await host.addPeer(peerKeyInput.value.trim());
          log("Connection attempt started");
        } catch (error) {
          log(String(error));
        }
      }
    );

    document.querySelector("#send").addEventListener(
      "click",
      async () => {
        const peer = peerKeyInput.value.trim();
        const payload = encoder.encode(messageInput.value);

        try {
          await host.sendMessage(peer, payload);
          log(`Sent to ${peer}`);
        } catch (error) {
          log(String(error));
        }
      }
    );

    async function start() {
      requireApiV2();

      myKeyElement.textContent = await host.getPubkey();

      // Register event listeners before reading the initial
      // snapshot so connection changes are not missed.
      const peers = JSON.parse(
        await host.getPeersJson()
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

### 4. Serve the files

Do not rely on opening the page through `file://`.

For local development:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Use HTTPS for non-local deployments. Static hosts such as GitHub Pages already provide HTTPS.

---

## Hosting the runtime

Coralie does not require a specialised web server. Any static host that serves the HTML page and JavaScript bundle can be used.

Examples include:

- GitHub Pages;
- GitLab Pages;
- Cloudflare Pages;
- Netlify;
- an ordinary HTTPS web server; or
- a local development server.

### Recommended path

Use a relative path from the HTML page:

```html
<script src="./Coralie/v2/host.js"></script>
```

Relative paths are especially useful on GitHub Pages project sites, where the repository name forms part of the URL.

For example:

```text
https://example.github.io/my-game/
```

resolves the runtime as:

```text
https://example.github.io/my-game/Coralie/v2/host.js
```

An absolute path such as:

```html
<script src="/Coralie/v2/host.js"></script>
```

would instead resolve from the domain root and commonly causes a `404` on project sites.

### GitHub Pages checklist

Confirm that:

1. the file is committed with the exact case-sensitive path `Coralie/v2/host.js`;
2. the Pages source branch and directory contain that path;
3. the HTML uses a relative URL;
4. the deployment has completed;
5. the runtime URL opens directly in the browser; and
6. an old `404` response is not being served from cache.

### Content Security Policy

A strict Content Security Policy must permit:

- the local runtime script;
- secure WebSocket connections to the configured Nostr relays; and
- HTTPS connections required by the page.

Exact directives depend on the application's own assets and request destinations.

---

## Browser requirements

The browser host requires a modern environment with:

- WebRTC data channels;
- WebSocket;
- Web Crypto;
- Fetch;
- readable response streams;
- `TextEncoder` and `TextDecoder`;
- `Uint8Array`;
- `CustomEvent`; and
- `localStorage` for durable browser storage.

Feature detection:

```js
const requirements = {
  RTCPeerConnection: typeof RTCPeerConnection === "function",
  WebSocket: typeof WebSocket === "function",
  crypto: typeof crypto?.getRandomValues === "function",
  fetch: typeof fetch === "function",
  TextEncoder: typeof TextEncoder === "function",
  TextDecoder: typeof TextDecoder === "function",
};

const missing = Object.entries(requirements)
  .filter(([, available]) => !available)
  .map(([name]) => name);

if (missing.length > 0) {
  throw new Error(
    `Unsupported browser; missing: ${missing.join(", ")}`
  );
}
```

Maintain a tested-browser matrix as part of each release. Do not assume that the presence of the APIs guarantees identical WebRTC behaviour on every operating system and network.

---

## API conventions

### API version

This README documents:

```text
Coralie API v2
```

Pages should fail visibly when the wrong API version is loaded.

```js
if (Number(await window.Coralie.apiVersion()) !== 2) {
  throw new Error("Coralie API v2 is required");
}
```

### Await every host call

Use:

```js
const pubkey = await host.getPubkey();
```

rather than:

```js
const pubkey = host.getPubkey();
```

The browser implementation may return immediately, but the Android implementation can perform native asynchronous work.

### JSON bridge values

Some methods accept or return JSON as strings:

- `getPeersJson()`;
- `httpRequestJson()`;
- `timerListJson()`.

This keeps the interface compatible with native JavaScript bridges.

Parse the result explicitly:

```js
const peers = JSON.parse(
  String(await host.getPeersJson() || "[]")
);
```

### Public keys

Peer identities are lowercase, 64-character hexadecimal public keys.

Methods accept uppercase hexadecimal input but normalise identities to lowercase.

Applications should normalise keys before using them as map keys:

```js
const normalized = pubkeyHex.toLowerCase();
```

### Byte payloads

Peer messages contain bytes, not JavaScript objects or strings.

Encode application data explicitly:

```js
const encoder = new TextEncoder();

const bytes = encoder.encode(
  JSON.stringify({
    type: "chat",
    text: "Hello"
  })
);

await host.sendMessage(peerPubkeyHex, bytes);
```

Decode received data:

```js
const decoder = new TextDecoder();

window.addEventListener("coralie:message", event => {
  const bytes = Uint8Array.from(event.detail.payload);
  const value = JSON.parse(decoder.decode(bytes));
});
```

---

## API reference

## Host information

### `apiVersion()`

Returns the numeric runtime API version.

```ts
apiVersion(): number | Promise<number>
```

Current value:

```js
2
```

Example:

```js
const version = Number(await host.apiVersion());
```

---

### `hostKind()`

Identifies the active host implementation.

```ts
hostKind(): string | Promise<string>
```

The browser runtime returns:

```js
"browser"
```

Use this mainly for diagnostics. Portable application behaviour should not branch by host unless the platform distinction is unavoidable.

---

## Peer mesh

### `getPubkey()`

Returns this page session's mesh identity.

```ts
getPubkey(): string | Promise<string>
```

The result is a 64-character lowercase hexadecimal public key.

```js
const myPubkeyHex = await host.getPubkey();
```

> [!WARNING]
> The browser identity is generated when the host loads and is not currently persisted. Reloading or reopening the page produces a different identity.

---

### `addPeer(pubkeyHex)`

Starts a connection attempt to another Coralie peer.

```ts
addPeer(
  pubkeyHex: string
): void | Promise<void>
```

Requirements:

- exactly 64 hexadecimal characters;
- the peer must be online;
- both peers must be able to use the configured signalling relays; and
- WebRTC must find a viable direct route.

Example:

```js
await host.addPeer(
  "0123456789abcdef0123456789abcdef" +
  "0123456789abcdef0123456789abcdef"
);
```

`addPeer()` starts the attempt. It does not mean the peer is already connected.

Wait for a `coralie:peers` event or check `getPeersJson()` before sending.

Duplicate requests for an already connected or currently initiating peer are ignored.

The current connection manager uses:

- a 30-second handshake timeout per attempt; and
- up to five attempts before emitting `coralie:terminalFailure`.

---

### `sendMessage(toPubkeyHex, payload)`

Sends one application message directly to a connected peer.

```ts
sendMessage(
  toPubkeyHex: string,
  payload: Uint8Array | number[]
): void | Promise<void>
```

Each payload element must be an integer from `0` to `255`.

Example:

```js
const payload = new TextEncoder().encode("Hello");
await host.sendMessage(peerPubkeyHex, payload);
```

The call throws when:

- the mesh has been closed;
- the key is malformed;
- the peer is not connected; or
- the payload is not byte-compatible.

Coralie does not currently expose a separate broadcast method. Broadcast by sending to each connected peer:

```js
const peers = JSON.parse(
  await host.getPeersJson()
);

const payload = new TextEncoder().encode(
  JSON.stringify({
    type: "round-started",
    round: 3
  })
);

const results = await Promise.allSettled(
  peers.map(async peer => {
    await host.sendMessage(peer.pubkeyHex, payload);
  })
);
```

Application messages are not automatically forwarded through other peers.

---

### `getPeersJson()`

Returns a JSON-encoded snapshot of directly connected peers.

```ts
getPeersJson(): string | Promise<string>
```

Decoded shape:

```ts
interface CoraliePeer {
  pubkeyHex: string;
  connectedAt: number | null;
}
```

Example result:

```json
[
  {
    "pubkeyHex": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "connectedAt": 1784955600000
  }
]
```

`connectedAt` is the local Unix timestamp in milliseconds at which the data-channel connection was recorded.

Example:

```js
const peers = JSON.parse(
  String(await host.getPeersJson() || "[]")
);
```

---

### `reset()`

Closes the current mesh, creates a new mesh, and returns the new identity.

```ts
reset(): string | Promise<string>
```

Example:

```js
const newPubkeyHex = await host.reset();
```

Resetting:

- disconnects current peers;
- creates a new public key;
- reopens the mesh if it was closed; and
- does not clear storage or timers.

Any room code based on the previous public key becomes invalid.

---

### `close()`

Closes the current peer mesh.

```ts
close(): void | Promise<void>
```

This:

- closes signalling connections;
- closes active peer data channels;
- clears the peer snapshot; and
- emits `coralie:peers` with an empty array.

It does not clear storage or cancel timers.

Call `reset()` to create a new mesh after closing.

Example:

```js
window.addEventListener("pagehide", () => {
  host.close();
});
```

---

## Storage

Browser storage uses `window.localStorage` when it is available.

If `localStorage` is unavailable or throws, the host falls back to an in-memory map for the current page session.

### Storage scope

Browser `localStorage` is scoped to the **origin**, not to an HTML file or URL path.

For example, these pages share the same browser storage:

```text
https://example.com/game-a/
https://example.com/game-b/
```

Applications hosted under the same origin should namespace every key:

```js
const STORAGE_PREFIX = "my-game:v1:";

function storageKey(name) {
  return STORAGE_PREFIX + name;
}
```

The origin includes the scheme, host, and port. These are separate storage areas:

```text
http://localhost:8000
http://localhost:8080
https://example.com
```

Values are stored as strings and are not encrypted.

---

### `storageGetItem(key)`

Reads a value.

```ts
storageGetItem(
  key: string
): string | null | Promise<string | null>
```

Returns `null` when the key is absent.

```js
const raw = await host.storageGetItem(
  "my-game:v1:settings"
);

const settings = raw === null
  ? {}
  : JSON.parse(raw);
```

---

### `storageSetItem(key, value)`

Stores a string value.

```ts
storageSetItem(
  key: string,
  value: string
): void | Promise<void>
```

Example:

```js
await host.storageSetItem(
  "my-game:v1:settings",
  JSON.stringify({
    sound: true,
    durationSeconds: 90
  })
);
```

---

### `storageRemoveItem(key)`

Removes a value.

```ts
storageRemoveItem(
  key: string
): void | Promise<void>
```

Example:

```js
await host.storageRemoveItem(
  "my-game:v1:settings"
);
```

---

## HTTP

### `httpRequestJson(requestJson)`

Performs an HTTPS request and returns a JSON-encoded response.

```ts
httpRequestJson(
  requestJson: string
): Promise<string>
```

Request shape:

```ts
interface CoralieHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}
```

Response shape:

```ts
interface CoralieHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
```

Example:

```js
const encodedResponse = await host.httpRequestJson(
  JSON.stringify({
    url: "https://api.example.com/items",
    method: "GET",
    headers: {
      "accept": "application/json"
    },
    body: null
  })
);

const response = JSON.parse(encodedResponse);

if (response.status >= 200 && response.status < 300) {
  const items = JSON.parse(response.body);
  console.log(items);
} else {
  console.error(
    response.status,
    response.statusText,
    response.body
  );
}
```

### Browser request behaviour

The current browser implementation:

- accepts only absolute `https:` URLs;
- defaults to `GET`;
- requires header values to be strings;
- accepts a string or `null` body;
- omits the body for `GET` and `HEAD`;
- omits browser credentials and cookies;
- disables HTTP caching;
- uses a no-referrer policy;
- follows redirects through Fetch;
- decodes the body as text;
- uses the response charset when declared;
- defaults to UTF-8; and
- limits the decoded response input to 64 MiB.

The destination remains subject to browser CORS rules.

### Binary responses

The HTTP API currently returns a string body. It is not intended for arbitrary binary downloads.

An endpoint that returns binary content should expose a text representation suitable for the application, such as JSON or Base64, while remaining within the response-size limit.

### Synthetic status `599`

Browser transport and validation failures are returned as a synthetic response rather than being thrown after the method has started processing the request.

Example:

```json
{
  "status": 599,
  "statusText": "Browser HTTP failure",
  "headers": {},
  "body": "{\"requestId\":1,\"stage\":\"browser-fetch\",\"category\":\"network-io\",\"method\":\"GET\",\"url\":\"https://api.example.com/items\",\"elapsedMs\":231,\"message\":\"Failed to fetch\",\"exception\":\"TypeError\",\"rootException\":\"TypeError\",\"causeChain\":\"TypeError: Failed to fetch\"}"
}
```

Parse the diagnostic body:

```js
if (response.status === 599) {
  let diagnostic = null;

  try {
    diagnostic = JSON.parse(response.body);
  } catch {
    diagnostic = {
      category: "unknown",
      message: response.body
    };
  }

  console.error("Coralie HTTP failure", diagnostic);
}
```

Possible browser categories include:

| Category | Meaning |
|---|---|
| `invalid-request` | Invalid JSON, URL, headers, method, or body |
| `network-io` | Fetch or CORS-related transport failure |
| `cancelled` | The browser aborted the operation |
| `response-too-large` | The response exceeded 64 MiB |
| `internal` | Another browser-host failure |

A `response-too-large` diagnostic may also contain:

```ts
interface ResponseTooLargeDiagnostic {
  limitBytes: number;
  observedBytes: number;
  declaredByServer: boolean;
}
```

The diagnostic URL omits query parameters and fragments to reduce accidental disclosure in logs.

---

## Timers

Coralie timers provide named, host-managed deadlines and emit a DOM event when they fire.

In the browser implementation, timer state is held in memory for the current page session. It is not durable across reloads or tab closure.

Browser background throttling and device suspension may cause a timer to fire later than its nominal deadline.

---

### `timerQueue(id, delaySeconds, payload)`

Creates or replaces a timer.

```ts
timerQueue(
  id: string | null,
  delaySeconds: number,
  payload: string | null
): string | Promise<string>
```

Rules:

- `delaySeconds` must be a positive integer;
- `null` or an empty ID generates an ID;
- reusing an ID cancels and replaces the previous timer; and
- the payload is optional and must be a string or `null`.

Example:

```js
const timerId = await host.timerQueue(
  "answering-deadline",
  90,
  JSON.stringify({
    gameId: "game-123"
  })
);
```

Generate an ID:

```js
const timerId = await host.timerQueue(
  null,
  30,
  "refresh"
);
```

---

### `timerCancel(id)`

Cancels a timer if it exists.

```ts
timerCancel(
  id: string
): void | Promise<void>
```

Example:

```js
await host.timerCancel("answering-deadline");
```

Cancelling an unknown timer has no effect.

---

### `timerListJson()`

Returns the remaining time for active timers.

```ts
timerListJson(): string | Promise<string>
```

Decoded shape:

```ts
interface CoralieTimerSummary {
  id: string;
  remainingMs: number;
}
```

Example:

```js
const timers = JSON.parse(
  String(await host.timerListJson() || "[]")
);
```

The list does not include timer payloads.

---

## Events

The runtime emits `CustomEvent` objects on `window`.

Subscribe with:

```js
window.addEventListener(
  "coralie:message",
  event => {
    console.log(event.detail);
  }
);
```

Remove listeners when appropriate:

```js
function onMessage(event) {
  console.log(event.detail);
}

window.addEventListener(
  "coralie:message",
  onMessage
);

// Later:
window.removeEventListener(
  "coralie:message",
  onMessage
);
```

### `coralie:peers`

Emitted whenever the directly connected peer snapshot changes.

```ts
CustomEvent<CoraliePeer[]>
```

Example:

```js
window.addEventListener(
  "coralie:peers",
  event => {
    for (const peer of event.detail) {
      console.log(
        peer.pubkeyHex,
        peer.connectedAt
      );
    }
  }
);
```

Treat the event detail as a complete snapshot, not a delta.

---

### `coralie:message`

Emitted when application bytes arrive from a peer.

```ts
interface CoralieIncomingMessage {
  fromPubkeyHex: string;
  toPubkeyHex: string;
  timestamp: number;
  payload: number[];
}
```

Example:

```js
window.addEventListener(
  "coralie:message",
  event => {
    const message = event.detail;
    const bytes = Uint8Array.from(message.payload);

    console.log(
      "From:",
      message.fromPubkeyHex
    );

    console.log(
      new TextDecoder().decode(bytes)
    );
  }
);
```

The payload in the event is an array of unsigned byte values from `0` to `255`.

---

### `coralie:terminalFailure`

Emitted after the host exhausts its connection attempts for a peer.

```ts
interface CoralieTerminalFailure {
  pubkeyHex: string;
  attemptCount: number;
  reason: string;
}
```

Example:

```js
window.addEventListener(
  "coralie:terminalFailure",
  event => {
    const failure = event.detail;

    showConnectionError(
      failure.pubkeyHex,
      failure.reason
    );
  }
);
```

A page can let the user retry by calling `addPeer()` again after the terminal failure.

---

### `coralie:timerFired`

Emitted when a queued timer reaches its deadline.

```ts
interface CoralieTimerFired {
  id: string;
  payload?: string;
}
```

Example:

```js
window.addEventListener(
  "coralie:timerFired",
  event => {
    const timer = event.detail;

    if (timer.id === "answering-deadline") {
      finishAnsweringRound(timer.payload);
    }
  }
);
```

---

## Room codes and joining

The runtime connection API accepts a full public key:

```js
await host.addPeer(pubkeyHex);
```

Coralie deliberately does not prescribe a room-code format.

### Without a directory

When there is no discovery service or lookup backend, the joining information must contain enough data to recover the complete 256-bit public key.

Suitable approaches include:

- a QR code containing the full key;
- a deep link containing the full key;
- a Base32, Base58, or Bech32-style reversible encoding; or
- copying the hexadecimal key directly.

A genuinely short code cannot uniquely represent the full key without some external lookup mechanism.

### With a directory

An application may operate a small directory that maps a short code to the current public key. That improves usability but introduces backend infrastructure, expiry rules, abuse controls, and availability requirements.

The directory would be application infrastructure and is not part of the Coralie runtime.

### Room host lifecycle

Because the browser identity changes on reload:

- regenerate or republish the room information after reloading;
- do not store a browser room code indefinitely;
- display a clear disconnected/restarted state; and
- treat a stale room code as an ordinary connection failure.

---

## Application messaging

Coralie transports bytes. The application owns the message protocol.

A robust protocol should include:

- a message type;
- a schema version;
- a room or game identifier;
- a sender-generated timestamp or sequence number;
- the relevant entity or round identifier; and
- validated application data.

Example envelope:

```json
{
  "protocol": 1,
  "type": "answer-updated",
  "gameId": "room-owner-key:1784955600000",
  "questionIndex": 4,
  "answer": "Iceland",
  "sequence": 18
}
```

### Validate received messages

Never trust peer data.

```js
function isAnswerMessage(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.protocol === 1 &&
    value.type === "answer-updated" &&
    typeof value.gameId === "string" &&
    Number.isSafeInteger(value.questionIndex) &&
    typeof value.answer === "string" &&
    Number.isSafeInteger(value.sequence)
  );
}
```

Drop malformed or irrelevant messages rather than allowing them to crash the page.

### Define conflict rules

Messages can arrive after state has changed. Applications should define rules such as:

- game IDs isolate separate sessions;
- round IDs isolate separate rounds;
- sequence numbers reject stale updates;
- timestamps resolve last-writer-wins fields;
- only the selected host can start a round;
- a participant may update only its own answer; and
- duplicate messages are idempotent.

### Keep payloads small

The browser host serialises application bytes into an internal data-channel frame. Large messages create considerable memory and JSON overhead.

Prefer:

- compact state changes;
- small snapshots;
- chunking for unusually large data; and
- HTTP for large public resources.

Do not use peer messages as a file-transfer mechanism without adding explicit chunking, limits, cancellation, validation, and backpressure.

---

## Cross-platform development guidance

A page intended for both browser and Android should follow these rules.

### Use only `window.Coralie`

Do not access:

- browser runtime classes;
- relay sockets;
- `RTCPeerConnection` instances owned by the runtime;
- Android bridge objects; or
- host-specific internal events.

### Await all methods

```js
await host.storageSetItem(key, value);
await host.addPeer(pubkeyHex);
await host.sendMessage(pubkeyHex, payload);
```

### Subscribe before reading snapshots

```js
window.addEventListener(
  "coralie:peers",
  onPeers
);

const initialPeers = JSON.parse(
  await host.getPeersJson()
);

renderPeers(initialPeers);
```

This avoids missing a change between application initialisation and the first read.

### Treat JSON return values defensively

```js
function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}
```

### Do not assume browser storage isolation

Namespace keys even when the Android implementation provides stronger page or storage-space isolation.

### Expect HTTP differences

A request that succeeds natively on Android can fail in a browser because of CORS.

Choose APIs that support browser clients and test both environments.

### Do not make game correctness depend on precise timers

Browsers throttle background pages. Use absolute deadlines in replicated game state and derive the visible countdown from `Date.now()`.

A timer event should trigger reevaluation of the deadline, not be the sole source of truth.

### Avoid unnecessary host branching

This is usually a warning sign:

```js
if (await host.hostKind() === "browser") {
  // Completely different application logic
}
```

Prefer one protocol and one state model. Branch only for unavoidable presentation or transport restrictions.

---

## Networking model

At a high level:

```text
┌──────────────────────────────┐
│ Static HTML application      │
│                              │
│ window.Coralie               │
└──────────────┬───────────────┘
               │
               │ encrypted signalling
               ▼
┌──────────────────────────────┐
│ Configured Nostr relays      │
│ Event kind 28080             │
└──────────────┬───────────────┘
               │
               │ SDP offer / answer exchange
               ▼
┌──────────────────────────────┐
│ WebRTC data channel          │
│ Direct application messages  │
└──────────────────────────────┘
```

### Signalling

The browser runtime currently:

- generates a Nostr-compatible secp256k1 identity;
- signs signalling events;
- encrypts signalling content using NIP-44 conversation encryption;
- publishes signalling events using Nostr event kind `28080`;
- subscribes for events addressed to its public key; and
- suppresses duplicate relay events.

Signalling relays coordinate the WebRTC handshake. They do not carry normal application messages after the data channel is connected.

### Default Nostr relays

The current distribution contains these defaults:

```text
wss://relay.damus.io
wss://nos.lol
wss://nostr.oxtr.dev
wss://purplerelay.com
```

These are external public services. Their availability, retention, policy, latency, and continued operation are not controlled by Coralie.

Production deployments should decide whether to:

- rely on the bundled defaults;
- build with an application-specific relay set; or
- operate compatible relays.

The current self-installing distribution does not expose runtime relay configuration through the public `window.Coralie` facade.

### Default STUN servers

The current distribution uses:

```text
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
stun:stun2.l.google.com:19302
stun:stun3.l.google.com:19302
stun:stun4.l.google.com:19302
stun:stun.cloudflare.com:3478
```

No TURN server is configured.

### Data channels

Application messages use WebRTC data channels.

The current runtime creates the channel with browser defaults, which ordinarily provide ordered, reliable delivery while the connection remains open. Applications must still handle:

- disconnections;
- stale state;
- duplicated application-level actions;
- peers joining part-way through a session; and
- participants leaving without a graceful message.

### Peer announcements

When connections are established, the mesh can announce newly known peers to other connected participants and initiate additional direct links.

This reduces the amount of manual peer entry required after the initial join.

It is not:

- global discovery;
- a room directory;
- guaranteed full-mesh formation; or
- automatic application-message relaying.

---

## Lifecycle and persistence

| Resource | Browser lifetime |
|---|---|
| Mesh identity | Current page load |
| Peer connections | Until disconnect, `close()`, `reset()`, or page exit |
| Storage | Origin-persistent when `localStorage` works |
| Storage fallback | Current page load |
| HTTP operation | One request |
| Timer | Current page load |
| Timer payload | Until the timer fires or is cancelled |

### Reloading

A reload:

- disconnects peers;
- creates a new mesh identity;
- loses active browser timers;
- retains successful `localStorage` values; and
- reruns all application initialisation.

A page should expose startup diagnostics instead of failing to a blank screen.

Recommended bootstrap pattern:

```js
async function bootstrap() {
  setBootStatus("Checking Coralie runtime…");

  const host = window.Coralie;

  if (!host) {
    throw new Error("window.Coralie is unavailable");
  }

  if (Number(await host.apiVersion()) !== 2) {
    throw new Error("Coralie API v2 is required");
  }

  setBootStatus("Reading identity…");
  const pubkey = await host.getPubkey();

  setBootStatus("Reading saved state…");
  const saved = await host.storageGetItem(
    "my-game:v1:state"
  );

  initialiseApplication(pubkey, saved);
  hideBootStatus();
}

bootstrap().catch(showBootFailure);
```

---

## Security and privacy

Coralie makes direct communication easier; it does not make arbitrary peer content trustworthy.

### Treat imported and hosted pages as code

A Coralie page can:

- store data;
- contact allowed HTTPS services;
- communicate with peers; and
- react to user input.

Only run pages from sources you trust.

### Validate all peer messages

A peer controls the bytes it sends.

Validate:

- type;
- length;
- required properties;
- numerical ranges;
- identifiers;
- allowed state transitions; and
- sender authority.

Set application-level payload and collection limits to prevent memory exhaustion.

### Public keys are identifiers

A Coralie public key identifies a mesh endpoint. It is not automatically:

- a legal identity;
- a user account;
- a display name;
- proof of age;
- proof of ownership outside the session; or
- permission to perform an application action.

### Network metadata

Although signalling content is encrypted, public relay operators can still observe metadata associated with relay usage, including public keys, event timing, and traffic patterns.

STUN services and connected WebRTC peers can observe network information required for connection establishment.

### Storage

Browser storage:

- is not encrypted by Coralie;
- is readable by other scripts running on the same origin;
- may be cleared by the user or browser; and
- may be unavailable in private or restricted contexts.

Do not store secrets unless the application has an appropriate encryption and key-management design.

### HTTP credentials

The browser host uses:

```text
credentials: omit
```

Cookies and ambient browser credentials are not sent.

Explicit authentication headers are application data and should be handled carefully. They remain subject to CORS and should not be persisted in plaintext unless necessary.

### Static hosting integrity

Anyone able to modify the hosted HTML or `host.js` can modify the application.

Protect the repository and deployment process, review dependency changes, and use HTTPS.

---

## Performance and scalability

Coralie is optimised for explicit joins and small live rooms.

Its narrow scope avoids the broader discovery and provider abstraction used by general-purpose peer libraries. Numerical performance claims should be accompanied by a reproducible benchmark rather than presented without test conditions.

A useful connection benchmark should record:

- Coralie version;
- comparison-library version and provider;
- browser and operating-system versions;
- Android version where relevant;
- LAN or internet conditions;
- relay configuration;
- STUN/TURN configuration;
- cold versus already-open relay sockets;
- number of participants;
- time from join request to data-channel open;
- sample count;
- median;
- p95; and
- failure rate.

### Mesh growth

A full mesh can require a direct connection between every pair of participants.

The number of possible links grows approximately as:

```text
n × (n - 1) / 2
```

Coralie is therefore not intended as a substitute for server-based distribution to large rooms.

Test the intended maximum room size on representative devices and networks.

### Application-state design

Prefer:

- event messages for small changes;
- occasional bounded snapshots for recovery;
- deterministic reducers;
- idempotent operations;
- clear ownership rules; and
- explicit join-state synchronisation.

Avoid broadcasting an entire unbounded state object on every input event.

---

## Troubleshooting

## `window.Coralie is unavailable`

Likely causes:

1. `host.js` returned `404`;
2. the script path has incorrect letter casing;
3. application code ran before the runtime script;
4. a Content Security Policy blocked the script;
5. the deployed branch does not contain the runtime; or
6. the browser is showing a cached deployment.

Check the Network panel and open the runtime URL directly.

Correct order:

```html
<script src="./Coralie/v2/host.js"></script>
<script src="./app.js"></script>
```

---

## GitHub Pages returns `404` for `host.js`

For a project site, use:

```html
<script src="./Coralie/v2/host.js"></script>
```

rather than:

```html
<script src="/Coralie/v2/host.js"></script>
```

Confirm the deployed URL includes the repository path.

---

## The runtime loads but an existing `window.Coralie` remains

This is deliberate.

The browser bundle does not replace an existing host implementation. This is required so the same page can use the Android-provided facade.

Inspect:

```js
console.log(
  await window.Coralie.hostKind()
);
```

---

## `addPeer()` returns but no peer appears

`addPeer()` starts the attempt; it does not wait for a completed connection.

Listen for:

```text
coralie:peers
coralie:terminalFailure
```

Also verify:

- the complete 64-character key;
- the peer has not reloaded;
- both participants are online;
- secure WebSockets to the relays are permitted;
- UDP/WebRTC traffic is not blocked;
- the network topology is supported; and
- the room is not relying on unsupported browser-only direct links.

---

## `Peer is not connected`

Do not send immediately after `addPeer()`.

Wait until the target appears in `getPeersJson()` or `coralie:peers`.

```js
function waitForPeer(pubkeyHex, timeoutMs = 30000) {
  const target = pubkeyHex.toLowerCase();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener(
        "coralie:peers",
        onPeers
      );

      reject(new Error("Peer connection timed out"));
    }, timeoutMs);

    function onPeers(event) {
      const connected = event.detail.some(
        peer => peer.pubkeyHex === target
      );

      if (!connected) return;

      clearTimeout(timeout);
      window.removeEventListener(
        "coralie:peers",
        onPeers
      );
      resolve();
    }

    window.addEventListener(
      "coralie:peers",
      onPeers
    );
  });
}
```

---

## `coralie:terminalFailure` is emitted

The runtime exhausted its retry attempts.

The user may:

- confirm the room information;
- check connectivity;
- disable an interfering VPN;
- switch networks;
- ensure an Android intermediary is present where required; or
- retry the join.

A retry is a new call to `addPeer()`.

---

## HTTP returns status `599`

Parse the response body and inspect:

- `stage`;
- `category`;
- `message`;
- `elapsedMs`; and
- size-limit fields when present.

Common causes:

- invalid request JSON;
- a non-HTTPS URL;
- CORS rejection;
- DNS or network failure;
- a blocked request;
- an unsupported method or header; or
- a response exceeding 64 MiB.

Remember that a successful Android request does not prove that the endpoint permits browser CORS.

---

## Storage disappears after reload

Possible causes:

- `localStorage` is unavailable;
- the browser used the in-memory fallback;
- private browsing restrictions;
- storage was cleared;
- the origin changed;
- the localhost port changed; or
- the key name changed.

Log the full origin while debugging:

```js
console.log(location.origin);
```

---

## Different applications overwrite each other's storage

Browser storage is origin-scoped.

Prefix every key:

```js
const KEY = "developer.example.my-game:v2:state";
```

---

## A timer fires late

Browsers can throttle background tabs and suspend work while a device sleeps.

Replicate an absolute deadline:

```js
const deadlineMs = Date.now() + 90_000;
```

When the event fires, compare the current time to the deadline rather than assuming exactly 90 seconds elapsed.

---

## A room stops working after the host reloads

The browser host generated a new identity.

Display and distribute the new room information.

---

## Developing the runtime

The distributed `host.js` file is generated output. Prefer editing the source modules rather than patching the minified bundle directly.

A conventional repository workflow is:

```bash
npm ci
npm test
npm run build
```

The build should produce:

```text
Coralie/v2/host.js
Coralie/v2/host.js.map
```

Adjust the command names to match the scripts declared in the repository's `package.json`.

### Required test coverage

At minimum, test:

- browser host installation;
- refusal to overwrite an existing host;
- API version and host kind;
- public-key validation and normalisation;
- initial empty peer snapshot;
- peer connection success;
- retry exhaustion;
- peer departure;
- binary payload normalisation;
- malformed signalling frames;
- malformed data-channel frames;
- mesh reset;
- mesh close;
- storage with `localStorage`;
- memory storage fallback;
- HTTPS-only request validation;
- request-header validation;
- CORS/network failure diagnostics;
- the 64 MiB response limit;
- timer replacement;
- timer cancellation;
- timer listing;
- timer events; and
- Android/browser facade conformance.

### Conformance tests

The browser and Android hosts should run against the same page-facing contract.

Recommended conformance assertions:

```text
apiVersion() returns 2
all required methods exist
public keys are 64-character lowercase hex
peer events contain complete snapshots
message payloads contain unsigned bytes
missing storage keys return null
HTTP responses use the same top-level fields
timer events use the same detail fields
reset returns a replacement identity
close emits an empty peer snapshot
```

### Do not expose implementation internals accidentally

The public API is the `window.Coralie` facade.

Internal classes, relay sessions, signer objects, peer connections, and native bridge details should remain implementation-specific.

---

## Versioning

The distribution path includes the major API version:

```text
Coralie/v2/host.js
```

Guidelines:

- preserve API v2 behaviour for the lifetime of the `v2` path;
- add backward-compatible fixes without renaming methods;
- document observable behaviour changes;
- introduce breaking changes under a new major path such as `v3`;
- keep page feature detection explicit; and
- publish Android and browser conformance results for each release.

A page should require the version it was written against:

```js
const requiredVersion = 2;
const actualVersion = Number(
  await window.Coralie.apiVersion()
);

if (actualVersion !== requiredVersion) {
  throw new Error(
    `Coralie API v${requiredVersion} required; ` +
    `found v${actualVersion}`
  );
}
```

---

## Contributing

Contributions should preserve the core design goals:

- one portable page-facing API;
- single-file application development;
- static browser deployment;
- Android/browser interoperability;
- explicit joining without native discovery;
- small, understandable networking components; and
- clear failure behaviour.

Before submitting a change:

1. add or update tests;
2. confirm browser/Android API conformance;
3. update this README for observable behaviour;
4. avoid adding application-specific behaviour to the runtime; and
5. document new infrastructure or privacy implications.

Report security issues privately through the repository's security contact rather than opening a public issue containing exploit details.

---

## Licence

This project is distributed under the terms described in [LICENSE](LICENSE).

The generated browser bundle may contain third-party open-source software. Preserve bundled licence notices and review the dependency licence report when publishing a release.
