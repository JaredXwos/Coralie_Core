# Browser and Android Compatibility

## Purpose

Coralie lets one HTML page run in two host environments:

- an ordinary browser using the standalone browser host; and
- the Coralie Android application using a native host behind the same facade.

Both expose Coralie Runtime API v2 through:

```js
window.Coralie
```

The API surface is shared, but browser security rules, Android permissions, storage scope, networking behaviour, and lifecycle are not identical.

This document records those differences and defines the subset that portable pages should rely on.

For method and event schemas, see [Coralie Runtime API v2](runtime-api-v2.md).

## Compatibility summary

| Area | Browser | Android | Portable expectation |
|---|---|---|---|
| API version | `2` | `2` | Require v2. |
| Host kind | `browser` | `android-native` | Use mainly for diagnostics. |
| Common script path | Static `Coralie/v2/host.js` | Virtual native-backed `Coralie/v2/host.js` | Use the relative common path. |
| Mesh identity | Fresh browser mesh session | Current Android viewer mesh session | Do not assume durability. |
| Peer messaging | WebRTC data channel | WebRTC data channel | Same application byte protocol. |
| Peer discovery | Explicit keys plus peer announcements | Explicit keys plus peer announcements | No room directory. |
| `connectedAt` | Local timestamp | `null` | Accept `number | null`. |
| Storage | Origin `localStorage`, then memory fallback | Selected persistent Space | Namespace keys and use strings. |
| HTTP | Fetch, CORS applies | Native OkHttp, permissions apply | Use absolute HTTPS and handle both failure models. |
| Redirects | Followed by Fetch | Not followed automatically | Handle final URL assumptions carefully. |
| Private/local HTTP targets | Browser policy dependent | Blocked by native DNS filter | Use publicly routable HTTPS endpoints. |
| Cookies | Omitted | No browser cookie jar through this API | Send explicit headers only when appropriate. |
| Response limit | 64 MiB | 64 MiB | Keep responses below 64 MiB. |
| Timers | Page-memory timers; browser throttling | Viewer-lifetime coroutines; survive ordinary backgrounding | Use absolute deadlines. |
| Capability prompts | None in Coralie browser host | Mesh, storage, HTTP, timers | Every call can fail or be delayed. |
| Domain prompts | None | Per HTTPS domain | Handle HTTP Promise rejection. |
| TURN | Not configured | Not configured | Some networks will fail. |

## Supported participant combinations

The current intended room combinations are:

| Room composition | Current status | Notes |
|---|---|---|
| Android ↔ Android | Supported | Subject to relay, ICE, NAT, and firewall conditions. |
| Android ↔ browser | Supported | Primary cross-platform path. |
| Multiple Android + browser clients | Supported for small rooms | Application still owns state replication and joining. |
| Browser-only room | Not generally supported | Current browser mDNS handling requires an intermediary topology. |
| Same-LAN mixed room | Usually most reliable | Still uses signalling relays to negotiate. |
| Restrictive NAT/firewall | May fail | No TURN fallback. |

“Supported” means the implementations and wire formats are intended to interoperate. It does not guarantee that every network can establish a direct route.

## Why browser-only rooms are restricted

Browsers commonly hide local ICE addresses behind mDNS hostnames. In the current Coralie implementation and tested topology, this prevents a general all-browser room from forming without an intermediary.

Portable party-game instructions should therefore state that a room needs an Android participant when browser clients are present.

This is a current implementation limitation, not part of the abstract Runtime API. Re-test and revise the matrix if ICE handling or topology support changes.

## Shared wire compatibility

Browser and Android interoperability depends on both implementations continuing to agree on:

- Nostr signalling event kind `28080`;
- the encrypted offer/answer envelope;
- public-key normalisation;
- WebRTC data-channel framing;
- application payload byte normalisation;
- peer-announcement framing;
- retry and timeout expectations; and
- the event detail schemas exposed to pages.

A page can use any application message format as long as every participant runs compatible page code.

The runtime does not negotiate an application protocol version. Include one inside the application message envelope.

```json
{
  "protocol": 1,
  "type": "state-snapshot",
  "gameId": "...",
  "sequence": 42,
  "data": {}
}
```

## Common host loading

Portable page markup should use:

```html
<script src="./Coralie/v2/host.js"></script>
```

### Browser

The relative path resolves to the copied static distribution.

The IIFE installs `BrowserCoralieHost` only when `window.Coralie` is absent.

### Android

The WebView asset loader serves a virtual JavaScript facade at the same path. That facade wraps the private `CoralieNative` JavaScript interface and publishes the public `window.Coralie` object.

The private bridge is an implementation detail. Page code must not reference it.

Android also supports a root-relative compatibility route:

```html
<script src="/Coralie/v2/host.js"></script>
```

Use the relative path for static-host compatibility.

## Method timing

Browser methods such as storage and mesh access are often synchronous. Android calls can involve native capability checks, persistence, or a permission dialog.

Portable pages must use `await`:

```js
await host.storageSetItem(key, value);
const pubkey = await host.getPubkey();
```

Do not infer that a method is cheap or immediate from browser behaviour.

## Permissions

## Browser

The Coralie browser host assumes that the page can attempt each operation.

The browser itself still enforces its normal security model, including:

- same-origin rules;
- CORS;
- secure-context requirements;
- Content Security Policy;
- browser storage restrictions; and
- WebRTC/network policy.

## Android

Imported pages declare or receive access to four native capabilities:

| Capability | Operations |
|---|---|
| `mesh` | Identity, peers, messaging, reset, close. |
| `storage` | Space-backed key-value operations. |
| `http` | Starting native HTTPS requests. |
| `timers` | Queueing, cancelling, and listing timers. |

The app can request a decision such as:

- allow once for the current session;
- always allow; or
- reject.

HTTP additionally asks for permission for the destination domain.

A rejected non-HTTP method can throw through the JavaScript bridge. HTTP permission rejection rejects the Promise with an error that can include:

```js
error.scope
error.target
error.operation
```


Portable code must display a user-actionable error rather than treating rejection as a runtime crash.

```js
try {
  await host.storageSetItem(key, value);
} catch (error) {
  showPermissionOrRuntimeError(error);
}
```

## Identity lifetime

Neither host guarantees a durable identity across page sessions.

### Browser

A new connection manager and signing identity are created when the browser host is installed. Reloading the page creates another identity.

### Android

The identity belongs to the current `AppMesh`/viewer lifecycle. `reset()`, mesh teardown, viewer exit, or process loss can replace it.

### Portable rule

A room code based on `getPubkey()` is valid only for the current mesh session.

After reload, reset, or viewer recreation:

- display the new identity;
- regenerate the room code;
- reject messages from an old game identifier; and
- make stale join failures understandable.

## Peer snapshots

Both hosts return:

```ts
interface MeshPeer {
  pubkeyHex: string;
  connectedAt: number | null;
}
```

Difference:

| Host | `connectedAt` |
|---|---|
| Browser | Local connection timestamp in milliseconds. |
| Android | `null`. |

Portable pages must not require a numeric value.

Do not use `connectedAt` for cross-device ordering or authority. It is local diagnostic metadata.

## Messaging

Both hosts expose the same message event:

```ts
interface PeerMessageEventDetail {
  fromPubkeyHex: string;
  toPubkeyHex: string;
  timestamp: number;
  payload: number[];
}
```

Both normalise incoming bytes to unsigned values from `0` to `255`.

### Shared semantics

- Messages go to one directly connected peer.
- No application broadcast method exists.
- No arbitrary message forwarding occurs automatically.
- No offline queue exists.
- Successful send is not a remote application acknowledgement.
- Pages validate all payloads.

### Timestamp

The message timestamp is generated by the receiving host. It is not signed remote time.

Do not use it alone to resolve global ordering. Use application sequence numbers and authority rules.

## Storage compatibility

## Browser storage

The browser host attempts `window.localStorage` for every operation. If storage is unavailable or throws, it uses an in-memory map for the current page load.

Scope is the browser origin:

```text
scheme + host + port
```

Different paths on one origin share keys.

## Android storage

Android stores values in the Space selected for the imported page. The storage capability must be active.

The Space can be shared deliberately between imported pages according to app configuration, so page authors should still namespace keys.

## Portable storage contract

- Keys and values are strings.
- Missing reads return `null`.
- Set is an upsert.
- Remove of a missing key succeeds.
- No enumeration API exists.
- No quota is specified by Runtime API v2.
- No encryption is provided by the runtime contract.

Use a prefix:

```js
const PREFIX = "io.example.my-game:v3:";
```

Do not rely on browser origin separation as the application's only namespace.

## HTTP compatibility

The method surface is shared:

```js
const encoded = await host.httpRequestJson(
  JSON.stringify({
    url: "https://api.example.com/items",
    method: "GET",
    headers: { accept: "application/json" },
    body: null,
  }),
);

const response = JSON.parse(encoded);
```

Both hosts:

- allow only absolute HTTPS URLs;
- accept string headers and string/null bodies;
- omit bodies for GET and HEAD;
- return status, status text, headers, and text body;
- enforce a 64 MiB response limit; and
- resolve non-permission failures as status `599`.

### Browser-specific HTTP behaviour

| Behaviour | Browser |
|---|---|
| Transport | Fetch |
| CORS | Applies |
| Redirects | Followed automatically |
| Credentials | Omitted |
| Cache | `no-store` |
| Referrer | Omitted through `no-referrer` |
| Host timeout | No Coralie-specific overall timeout |
| Private/local targets | Subject to browser rules and CORS/PNA |
| Capability prompt | None |
| Domain prompt | None |

A request can fail in the browser even when Android succeeds because the server does not permit the page's origin through CORS.

### Android-specific HTTP behaviour

| Behaviour | Android |
|---|---|
| Transport | Native OkHttp |
| CORS | Does not apply to the native request |
| Redirects | Not followed automatically |
| Credentials | No browser cookie jar through this API |
| Call timeout | 45 seconds by current implementation |
| Connect timeout | 15 seconds |
| Read timeout | 30 seconds |
| Private/local targets | Blocked by publicly-routable DNS filter |
| Capability prompt | Yes |
| Domain prompt | Yes |

A request can fail in Android even when the browser succeeds because Android blocks destinations resolving to non-public addresses or the user rejects a permission.

### Redirect portability

Because the browser follows redirects and Android returns the 3xx response, a portable page should avoid depending on implicit redirects.

Prefer the final HTTPS API URL. When redirects are unavoidable, handle 3xx responses explicitly and ensure every resulting domain is expected and authorised.

### Error portability

Handle both channels:

1. Promise rejection—principally Android permission rejection or session cancellation.
2. Resolved `HttpResponseData` with status `599`—validation, transport, size, or internal failure.

```js
async function portableHttp(request) {
  let encoded;

  try {
    encoded = await host.httpRequestJson(
      JSON.stringify(request),
    );
  } catch (error) {
    return {
      ok: false,
      kind: "rejected",
      error,
    };
  }

  const response = JSON.parse(encoded);

  if (response.status === 599) {
    let diagnostic = {};

    try {
      diagnostic = JSON.parse(response.body || "{}");
    } catch {
      diagnostic = { message: response.body };
    }

    return {
      ok: false,
      kind: "transport",
      response,
      diagnostic,
    };
  }

  return {
    ok: true,
    response,
  };
}
```

Do not branch on exact exception class names or exact diagnostic text.

## Timer compatibility

Both hosts provide named one-shot timers and the same event shape.

### Browser

- Timers live in the browser host instance.
- Reload or tab closure removes them.
- Background throttling can delay firing.
- Very long delays are scheduled in chunks below the browser timeout limit.

### Android

- Timers live in the current viewer/page coroutine scope.
- They continue through ordinary app backgrounding and screen-off while the viewer scope remains alive.
- Viewer exit cancels them.
- Process termination removes them.

### Generated IDs

Use:

```js
await host.timerQueue(null, 30, payload);
```

An empty string is a literal ID, not a generation request:

| Input ID | Browser | Android |
|---|---|---|
| `null` | Generates ID | Generates ID |
| `""` | Uses empty string as ID | Uses empty string as ID |

Use `null` when a generated ID is required.

### Gameplay clock

On both hosts, replicate an absolute deadline:

```js
const deadlineMs = Date.now() + durationMs;
```

Use `coralie:timerFired` to wake the page, then check the current clock and replicated game phase.

## Mesh close and reset

### `close()`

Both implementations close the mesh while leaving the other capability groups available for the page session.

After close:

- `getPubkey()` fails;
- `addPeer()` fails;
- `sendMessage()` fails;
- `getPeersJson()` fails;
- storage remains usable;
- HTTP remains usable subject to permissions; and
- timers remain usable.

### `reset()`

Both implementations create a replacement mesh and return a replacement identity.

Reset does not clear application storage or active timers.

A page should usually create a new application game ID when resetting.

## Browser and Android lifecycle

| Event | Browser effect | Android effect |
|---|---|---|
| Page reload | New host, identity, peers, and timers; persistent origin storage remains. | Not applicable in the same form; WebView reload can recreate page state and should be treated as session loss. |
| Browser tab close | Connections and timers end. | Not applicable. |
| App background | Browser may throttle timers and networking. | Viewer mesh/timers are intended to continue while its scope remains alive. |
| Viewer exit | Not applicable. | Connections, HTTP work, and timers are torn down. |
| Process kill | Everything in memory is lost. | Everything in memory is lost. |
| `close()` | Mesh only. | Mesh only. |
| `reset()` | New browser mesh identity. | New Android mesh identity. |

Portable pages should save user preferences and recoverable local state promptly rather than waiting for a graceful unload event.

## Direct page networking

The shared `httpRequestJson()` API is the portable request path.

A page should not assume that direct use of:

- `fetch()`;
- `XMLHttpRequest`;
- `WebSocket`; or
- arbitrary subresources

behaves identically in the Android WebView and an ordinary browser.

The Android app can apply WebView network restrictions and route approved HTTP through the native host. Browser pages remain under ordinary browser policy.

Use direct browser networking only for assets or behaviour explicitly accepted as non-portable.

## Static assets

A single-file page is the safest portable unit because it avoids path, CORS, and Android asset-import differences.

When a page references external resources:

- use HTTPS;
- expect Content Security Policy restrictions;
- expect Android WebView policy differences;
- avoid assuming cookies;
- provide visible load errors; and
- test both environments.

Fonts and public static assets may be usable depending on the host's WebView policy and the remote server's browser headers.

## Room-code design

The runtime accepts a full public key, not a short room code.

### Reversible code

A code can encode the full key using Base32, Base58, Bech32-style text, a QR code, or a URL fragment.

The result cannot be extremely short without losing information.

### Directory-backed code

A short numeric or word code can refer to a directory record containing the full key.

That introduces:

- a backend;
- expiry;
- collision handling;
- abuse controls;
- availability requirements; and
- privacy considerations.

### Session expiry

Because identities are session-scoped, directory records and shared links should expire quickly and be replaced after reset or reload.

## Application-state portability

Use one application protocol on both hosts.

Do not create separate browser and Android message formats.

A recommended state model includes:

- `protocol` — application protocol version;
- `gameId` — isolates separate rooms and restarts;
- `phase` or `roundId` — rejects late messages;
- `sequence` — rejects stale state;
- `sender` rules — defines who may perform an action;
- bounded data — prevents memory abuse; and
- idempotent reducers — tolerates repeated actions.

Example validation:

```js
function isRoundStart(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.protocol === 1 &&
    value.type === "round-started" &&
    typeof value.gameId === "string" &&
    typeof value.roundId === "string" &&
    Number.isSafeInteger(value.sequence) &&
    Number.isFinite(value.deadlineMs)
  );
}
```

## Portability traps

### Assuming `addPeer()` waits for connection

It only starts the attempt. Wait for the peer snapshot.

### Sending immediately after `addPeer()`

The browser facade rejects an unconnected peer, and Android's mesh send also fails. Wait for `coralie:peers`.

### Requiring numeric `connectedAt`

Android reports `null`.

### Using browser-only CORS success as proof of Android success

Android can reject permissions, redirects, non-public DNS destinations, or timeouts.

### Using Android success as proof of browser success

The browser endpoint must permit CORS.

### Using empty timer IDs as generated IDs

Use `null`.

### Depending on precise timer firing

Use absolute deadlines.

### Persisting the room public key

It is not guaranteed to survive the page/viewer session.

### Assuming every peer can reach every other peer

No TURN exists, browser-only topology is restricted, and application relaying is not automatic.

### Branching the game protocol by `hostKind()`

Keep one protocol. Branch only for unavoidable UI explanation or platform-specific diagnostics.

### Using exact failure reason text

Reason and exception strings are diagnostic and differ between implementations.

## Recommended cross-platform bootstrap

```js
async function startCoraliePage() {
  const host = window.Coralie;

  if (!host) {
    throw new Error("window.Coralie is unavailable");
  }

  const version = Number(await host.apiVersion());
  if (version !== 2) {
    throw new Error(
      `Coralie Runtime API v2 required; found v${version}`,
    );
  }

  const state = {
    peers: [],
    messages: [],
  };

  window.addEventListener("coralie:peers", event => {
    state.peers = event.detail;
    renderPeers(state.peers);
  });

  window.addEventListener("coralie:message", event => {
    receiveApplicationMessage(event.detail);
  });

  window.addEventListener(
    "coralie:terminalFailure",
    event => showJoinFailure(event.detail),
  );

  window.addEventListener("coralie:timerFired", event => {
    handleTimerWakeup(event.detail);
  });

  const [pubkeyHex, peersJson, saved] = await Promise.all([
    host.getPubkey(),
    host.getPeersJson(),
    host.storageGetItem("com.example.game:v1:state"),
  ]);

  state.peers = JSON.parse(String(peersJson || "[]"));
  initialiseUi({
    hostKind: await host.hostKind(),
    pubkeyHex,
    peers: state.peers,
    saved,
  });
}

startCoraliePage().catch(showFatalStartupError);
```

## Test matrix

A release should test at least:

### Browser unit tests

- host installation and existing-host no-op;
- public-key validation;
- payload validation;
- peer/message/failure event normalisation;
- local storage and fallback;
- HTTP request validation;
- CORS/network diagnostic handling;
- response-size limit;
- timer behaviour;
- close and reset.

### Android unit/instrumented tests

- capability decisions;
- domain decisions;
- native HTTP response limit;
- blocked private DNS destinations;
- timer lifecycle;
- JavaScript facade conversion;
- event normalisation;
- Space storage semantics;
- mesh close and rebuild.

### Cross-host tests

- Android connects to browser;
- browser connects through the supported mixed topology;
- both exchange byte payloads;
- peer snapshots match the common schema;
- application JSON round-trips;
- disconnect is observed;
- retry exhaustion is observed;
- reset invalidates old room information;
- browser CORS failure is handled;
- Android permission rejection is handled;
- HTTP 3xx behaviour is understood; and
- timer events drive the same application reducer.

### Network matrix

Where possible, test:

- same Wi-Fi LAN;
- separate residential networks;
- mobile carrier network;
- corporate or university Wi-Fi;
- VPN enabled and disabled;
- IPv4-only and dual-stack networks; and
- at least one known restrictive NAT environment.

Record failures rather than assuming a successful LAN test proves internet compatibility.

## Compatibility versioning

A change is cross-platform breaking when it changes any of:

- public method names;
- argument or return semantics;
- JSON response shape;
- event name or detail shape;
- public-key normalisation;
- byte encoding;
- signalling kind/envelope;
- data-channel frame format;
- close/reset lifecycle; or
- error channel relied upon by portable pages.

Such changes require coordinated browser and Android releases and normally a new Runtime API major version.

Platform-specific improvements that preserve the common contract—such as better diagnostics or broader ICE support—can remain within v2 and should update this compatibility matrix.
