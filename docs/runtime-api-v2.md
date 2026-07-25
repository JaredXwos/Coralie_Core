# Coralie Runtime API v2

## Status

This document defines the page-facing Coralie Runtime API version 2.

It is the normative contract shared by:

- the standalone browser host at `Coralie/v2/host.js`; and
- the Coralie Android native host exposed through the same path.

Implementation details below the facade are not part of this contract unless this document explicitly says otherwise.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** describe conformance requirements.

## Scope

The API supplies four capability groups:

- **mesh** — identity, explicit peer connections, and application messages;
- **storage** — string key-value persistence;
- **http** — JSON-described HTTPS requests;
- **timers** — named one-shot deadlines.

The API does not define:

- room-code encoding;
- matchmaking;
- participant display names;
- game state;
- host election;
- message schemas;
- application-message relaying;
- conflict resolution; or
- durable shared cloud state.

## Host installation

A page loads:

```html
<script src="./Coralie/v2/host.js"></script>
```

After the script has executed successfully, the page-facing host is available as:

```js
window.Coralie
```

### Existing host rule

If `window.Coralie` already exists, the browser bundle MUST leave it unchanged.

This permits Android to install its native-compatible facade before the page loads the common script path.

The browser installer does not validate, wrap, freeze, or replace an existing host.

### Global property

The browser installer defines `window.Coralie` as a non-writable and non-configurable property. Android also publishes a fixed facade object.

Page code MUST NOT attempt to replace or mutate the host.

## TypeScript contract

The source contract is declared in `src/coralie/coralie-host.interface.ts` and emitted through `dist/index.d.ts`.

```ts
export type CoralieHostKind =
  | "browser"
  | "android-native";

export interface MeshPeer {
  pubkeyHex: string;
  connectedAt: number | null;
}

export interface PeerMessageEventDetail {
  fromPubkeyHex: string;
  toPubkeyHex: string;
  timestamp: number;
  payload: number[];
}

export interface TerminalFailureEventDetail {
  pubkeyHex: string;
  attemptCount: number;
  reason?: string;
}

export interface HttpRequestData {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface HttpFailureDiagnostic {
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

export interface TimerInfo {
  id: string;
  remainingMs: number;
}

export interface TimerFiredEventDetail {
  id: string;
  payload?: string;
}

export type CoralieBytePayload =
  | Uint8Array
  | readonly number[];

export type MaybePromise<T> = T | Promise<T>;

export interface CoralieHost {
  apiVersion(): number;
  hostKind(): CoralieHostKind;

  getPubkey(): MaybePromise<string>;
  addPeer(pubkeyHex: string): MaybePromise<void>;
  sendMessage(
    toPubkeyHex: string,
    payload: CoralieBytePayload,
  ): MaybePromise<void>;
  getPeersJson(): MaybePromise<string>;
  reset(): MaybePromise<string>;
  close(): MaybePromise<void>;

  storageGetItem(
    key: string,
  ): MaybePromise<string | null>;
  storageSetItem(
    key: string,
    value: string,
  ): MaybePromise<void>;
  storageRemoveItem(
    key: string,
  ): MaybePromise<void>;

  httpRequestJson(
    requestJson: string,
  ): MaybePromise<string>;

  timerQueue(
    id: string | null,
    delaySeconds: number,
    payload: string | null,
  ): MaybePromise<string>;
  timerCancel(id: string): MaybePromise<void>;
  timerListJson(): MaybePromise<string>;
}
```

The generated declaration also augments `Window` and `WindowEventMap`.

## General calling conventions

### Await consumed return values

Portable page code MUST assume that any method may involve asynchronous host work.

Use:

```js
const peersJson = await window.Coralie.getPeersJson();
```

not:

```js
const peersJson = window.Coralie.getPeersJson();
```

The browser implementation is synchronous for several methods. Android may perform native capability checks or other host work.

`apiVersion()` and `hostKind()` are currently synchronous in both implementations, but awaiting them is harmless and keeps call sites uniform.

### JavaScript errors

A host method MAY throw synchronously or reject a returned Promise.

Page code SHOULD wrap user-triggered operations:

```js
try {
  await host.addPeer(value);
} catch (error) {
  showError(error);
}
```

### Public keys

A peer identity is a 64-character hexadecimal string representing a 32-byte public key.

Valid examples contain only:

```text
0-9 a-f A-F
```

Hosts MUST normalise accepted keys to lowercase when exposing them in method results and events.

Applications SHOULD also normalise keys before using them as map keys.

### Byte payloads

`sendMessage()` accepts:

- `Uint8Array`; or
- an array-like list of integer byte values.

Every value MUST be an integer in the inclusive range `0..255`.

Incoming event payloads MUST be exposed as ordinary JSON-compatible arrays of unsigned integers in the same range.

### JSON bridge values

The following methods exchange JSON as strings:

- `getPeersJson()`;
- `httpRequestJson()`;
- `timerListJson()`.

Page code MUST parse the returned string explicitly.

```js
const peers = JSON.parse(
  String(await host.getPeersJson() || "[]"),
);
```

### Event subscription order

A page SHOULD subscribe to events before reading the corresponding initial snapshot.

```js
window.addEventListener("coralie:peers", onPeers);
const peers = JSON.parse(await host.getPeersJson());
```

This prevents a state change from being missed during initialisation.

## Host information

### `apiVersion()`

```ts
apiVersion(): number;
```

Returns:

```js
2
```

A page SHOULD fail visibly when the version is not the version it supports.

```js
if (Number(await host.apiVersion()) !== 2) {
  throw new Error("Coralie Runtime API v2 is required");
}
```

### `hostKind()`

```ts
hostKind(): "browser" | "android-native";
```

Current values:

| Value | Meaning |
|---|---|
| `browser` | Standalone browser implementation. |
| `android-native` | Android native implementation behind the common facade. |

`hostKind()` is intended primarily for diagnostics and unavoidable platform-specific presentation.

Application protocol and state logic SHOULD NOT diverge by host.

## Mesh API

### `getPubkey()`

```ts
getPubkey(): MaybePromise<string>;
```

Returns the current mesh identity as a 64-character lowercase hexadecimal public key.

The identity belongs to the current mesh session. API v2 does not guarantee that it survives:

- `reset()`;
- page reload;
- page closure;
- Android viewer exit; or
- process termination.

A page MUST treat room information based on an old identity as stale after the mesh has been replaced.

The method MUST fail when the mesh has been closed and not yet reset.

### `addPeer(pubkeyHex)`

```ts
addPeer(
  pubkeyHex: string,
): MaybePromise<void>;
```

Starts a connection attempt to the supplied identity.

The method:

- MUST validate the 64-character hexadecimal format;
- MUST normalise the key to lowercase;
- MUST ignore a request to add the local identity;
- MUST be idempotent for a peer already initiating or connected; and
- MUST fail if the mesh is closed.

Successful return means that the request was accepted. It does **not** mean that a data channel is open.

The page MUST observe `coralie:peers` or read `getPeersJson()` to determine whether the peer became connected.

A connection attempt can later produce `coralie:terminalFailure`.

Current implementations use a 30-second handshake timeout and no more than five attempts. These values describe current behaviour but are not parameters in the page-facing v2 API.

### `sendMessage(toPubkeyHex, payload)`

```ts
sendMessage(
  toPubkeyHex: string,
  payload: Uint8Array | readonly number[],
): MaybePromise<void>;
```

Sends one application payload to one directly connected peer.

The method MUST:

- validate and normalise the destination key;
- validate every byte;
- reject an unconnected destination; and
- reject calls after the mesh has been closed.

Successful return means that the host accepted the payload for the connected data channel. It is not an end-to-end acknowledgement from the remote application.

The API does not provide:

- broadcast;
- application-message forwarding;
- offline queuing;
- delivery receipts;
- replay after reconnection; or
- application-level deduplication.

To broadcast, a page sends separately to each peer in the current snapshot.

```js
const peers = JSON.parse(await host.getPeersJson());
const bytes = new TextEncoder().encode(message);

const results = await Promise.allSettled(
  peers.map(peer =>
    host.sendMessage(peer.pubkeyHex, bytes),
  ),
);
```

Pages SHOULD keep payloads bounded and define their own schema version, identifiers, sequence rules, and validation.

### `getPeersJson()`

```ts
getPeersJson(): MaybePromise<string>;
```

Returns a JSON-encoded array containing all directly connected peers known by the local host.

Decoded shape:

```ts
interface MeshPeer {
  pubkeyHex: string;
  connectedAt: number | null;
}
```

Example:

```json
[
  {
    "pubkeyHex": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "connectedAt": 1784955600000
  }
]
```

`connectedAt` is host-specific metadata:

- the browser currently reports a local Unix timestamp in milliseconds;
- Android currently reports `null`.

Portable page logic MUST accept either.

The returned array is a snapshot. Mutating it does not affect the host.

The method MUST fail when the mesh is closed.

### `reset()`

```ts
reset(): MaybePromise<string>;
```

Replaces the current mesh and returns the replacement public key.

Reset MUST:

- close current signalling and data-channel resources;
- clear the connected peer snapshot;
- create a new mesh identity;
- reopen a previously closed mesh; and
- leave storage, HTTP capability state, and timers outside the mesh unaffected.

Any room code derived from the previous public key becomes stale.

A page SHOULD reset its own application room state or create a new game identifier when replacing the mesh.

### `close()`

```ts
close(): MaybePromise<void>;
```

Closes only the mesh portion of the runtime.

Close MUST:

- stop signalling;
- close active peer links;
- clear the peer snapshot; and
- make mesh operations fail until `reset()`.

Close SHOULD emit `coralie:peers` with an empty array when observable cleanup occurs.

Close MUST NOT, by itself:

- erase storage;
- cancel timers;
- disable HTTP; or
- destroy the page.

Calling `close()` more than once SHOULD be harmless.

## Storage API

Storage values are strings and missing reads return `null`, matching the core semantics of `localStorage`.

The storage namespace is host-specific:

- browser: the page's origin;
- Android: the storage Space selected for the imported page.

A portable page SHOULD prefix all keys with a stable application and schema identifier.

```js
const PREFIX = "com.example.word-game:v2:";
```

API v2 does not define:

- quotas;
- encryption;
- transactional multi-key updates;
- enumeration;
- compare-and-set; or
- cross-device synchronisation.

### `storageGetItem(key)`

```ts
storageGetItem(
  key: string,
): MaybePromise<string | null>;
```

Returns the stored string or `null` when no value exists.

Hosts MAY coerce the key to a string.

Android can require a storage capability decision before completing the operation.

### `storageSetItem(key, value)`

```ts
storageSetItem(
  key: string,
  value: string,
): MaybePromise<void>;
```

Stores or replaces one string value.

Portable pages SHOULD pass explicit strings rather than rely on host coercion.

The method can fail because of capability rejection, storage unavailability, quota, or another host error.

### `storageRemoveItem(key)`

```ts
storageRemoveItem(
  key: string,
): MaybePromise<void>;
```

Removes the key when present.

Removing an absent key MUST be treated as a successful no-op.

## HTTP API

### `httpRequestJson(requestJson)`

```ts
httpRequestJson(
  requestJson: string,
): MaybePromise<string>;
```

Performs an HTTPS request described by a JSON string and returns a JSON-encoded `HttpResponseData`.

### Request schema

```ts
interface HttpRequestData {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}
```

Example:

```json
{
  "url": "https://api.example.com/items",
  "method": "GET",
  "headers": {
    "accept": "application/json"
  },
  "body": null
}
```

Rules:

- `url` MUST be a non-empty absolute URL;
- only the `https:` scheme is permitted;
- `method` defaults to `GET` and is normalised to uppercase;
- header names are strings by JSON construction;
- every header value MUST be a string;
- `body` MUST be a string or `null`; and
- the body is omitted for `GET` and `HEAD`.

### Response schema

```ts
interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
}
```

Example:

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/json; charset=utf-8"
  },
  "body": "{\"items\":[]}"
}
```

Response header names MAY be normalised by the transport.

The body is text. API v2 does not expose arbitrary binary response bytes.

### Response limit

Both hosts enforce a maximum response body size of:

```text
64 MiB = 67,108,864 bytes
```

The limit is checked against declared content length when available and against observed bytes while reading.

### Character decoding

Hosts decode the response using the declared response charset where supported and UTF-8 otherwise.

Pages SHOULD prefer UTF-8 JSON and text endpoints.

### Browser behaviour

The browser implementation uses Fetch with:

```text
credentials: omit
cache: no-store
referrerPolicy: no-referrer
redirect: follow
```

Browser requests remain subject to CORS and browser network policy.

### Android behaviour

Android performs the request through the native HTTP stack after:

- HTTP capability authorisation; and
- per-domain authorisation.

Android does not follow redirects automatically. A 3xx response is returned to the page for explicit handling.

Android blocks DNS results that resolve only to non-public addresses, including loopback, link-local, private/site-local, multicast, unique-local IPv6, and carrier-grade NAT ranges.

### Status `599`

Non-permission transport, parsing, size, and internal HTTP failures resolve as a synthetic response with:

```json
{
  "status": 599,
  "statusText": "Browser HTTP failure",
  "headers": {},
  "body": "{...diagnostic JSON...}"
}
```

The exact `statusText` is host- and category-specific.

The diagnostic body follows this general shape:

```ts
interface HttpFailureDiagnostic {
  requestId: number | string;
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
```

The TypeScript package currently types the browser request ID as a number. Portable application code SHOULD treat diagnostic fields as logging data rather than as a strict cross-host business schema.

Common categories include:

| Category | Meaning |
|---|---|
| `invalid-request` | Invalid JSON, URL, headers, method, or body. |
| `network-io` | DNS, CORS, connection, TLS, or other transport failure. |
| `cancelled` | Request or page session was cancelled. |
| `response-too-large` | Response exceeded 64 MiB. |
| `internal` | Another host failure. |

### Permission rejection

Android permission rejection rejects the `httpRequestJson()` Promise with an `Error` rather than returning status `599`.

The error can include:

```ts
interface CoraliePermissionError extends Error {
  scope?: string;
  target?: string;
  operation?: string;
}
```

The browser host has no Coralie capability or domain prompt and therefore does not produce this rejection type.

### Portable request pattern

```js
async function requestJson(request) {
  let encoded;

  try {
    encoded = await host.httpRequestJson(
      JSON.stringify(request),
    );
  } catch (error) {
    // Android permission rejection or page/session cancellation.
    throw error;
  }

  const response = JSON.parse(encoded);

  if (response.status === 599) {
    let diagnostic;

    try {
      diagnostic = JSON.parse(response.body || "{}");
    } catch {
      diagnostic = { message: response.body || "HTTP failure" };
    }

    const error = new Error(
      diagnostic.message || response.statusText,
    );
    error.diagnostic = diagnostic;
    throw error;
  }

  return response;
}
```

## Timer API

Timers are named one-shot wake-up events.

They are page/session scoped, not durable alarms.

A timer can be delayed by browser throttling, device sleep, Android scheduling, or process suspension. Applications MUST NOT use timer callback precision as the authoritative game clock.

Replicate an absolute deadline and recompute remaining time from the current clock.

### `timerQueue(id, delaySeconds, payload)`

```ts
timerQueue(
  id: string | null,
  delaySeconds: number,
  payload: string | null,
): MaybePromise<string>;
```

Creates or replaces a timer and returns its ID.

Portable rules:

- `delaySeconds` MUST be a positive integer;
- pass `null` to request a generated ID;
- a non-null ID identifies the timer;
- queuing an existing ID MUST replace the prior timer;
- `payload` MUST be a string or `null`; and
- the payload is delivered only in the fired event.

Passing `null` requests a generated ID. An empty string is a literal timer ID on both current hosts.

Example:

```js
const id = await host.timerQueue(
  null,
  30,
  JSON.stringify({ action: "refresh" }),
);
```

### `timerCancel(id)`

```ts
timerCancel(
  id: string,
): MaybePromise<void>;
```

Cancels a pending timer.

Cancelling an unknown ID MUST be a successful no-op.

### `timerListJson()`

```ts
timerListJson(): MaybePromise<string>;
```

Returns a JSON-encoded array:

```ts
interface TimerInfo {
  id: string;
  remainingMs: number;
}
```

Example:

```json
[
  {
    "id": "answering-deadline",
    "remainingMs": 48211
  }
]
```

The list does not include timer payloads.

`remainingMs` is a snapshot and can reach zero before the event has been dispatched.

## DOM events

Hosts dispatch `CustomEvent` objects on `window`.

```js
window.addEventListener("coralie:message", event => {
  console.log(event.detail);
});
```

Event details are JSON-compatible and SHOULD be treated as immutable snapshots.

### `coralie:peers`

```ts
CustomEvent<MeshPeer[]>
```

The detail is the complete current directly connected peer snapshot, not a delta.

Hosts dispatch the event when the snapshot changes. A state-flow-backed implementation can also dispatch an initial empty snapshot while the host is installed.

Example:

```js
window.addEventListener("coralie:peers", event => {
  renderPeers(event.detail);
});
```

### `coralie:message`

```ts
interface PeerMessageEventDetail {
  fromPubkeyHex: string;
  toPubkeyHex: string;
  timestamp: number;
  payload: number[];
}
```

Semantics:

- `fromPubkeyHex` is the directly connected sender;
- `toPubkeyHex` is the local identity;
- `timestamp` is the receiving host's local Unix time in milliseconds; and
- `payload` is an unsigned byte array.

The timestamp is not a trusted remote clock and MUST NOT be used alone to establish application authority or global ordering.

### `coralie:terminalFailure`

```ts
interface TerminalFailureEventDetail {
  pubkeyHex: string;
  attemptCount: number;
  reason?: string;
}
```

Emitted after the host stops retrying a connection to the specified peer.

The reason string is diagnostic and can differ between hosts. Application logic SHOULD key behaviour on the event itself rather than exact reason text.

A page MAY let the user retry by calling `addPeer()` again.

### `coralie:timerFired`

```ts
interface TimerFiredEventDetail {
  id: string;
  payload?: string;
}
```

Emitted once when a pending timer reaches its deadline.

When the queued payload was `null`, the `payload` property is omitted.

The timer is removed before or as the event is dispatched.

## Lifecycle

| Resource | Browser | Android |
|---|---|---|
| Mesh identity | Current page/mesh session | Current viewer/mesh session |
| Peer links | Until disconnect, reset, close, or page exit | Until disconnect, reset, close, or viewer exit |
| Storage | Origin-persistent when `localStorage` succeeds | Persistent in selected Space |
| Storage fallback | In-memory for current page | Not applicable to the native Space store |
| HTTP request | One request; cancelled by browser/page conditions | One request; cancelled on viewer/session exit |
| Timers | Current page load | Current viewer page lifetime; not process-persistent |

### Page reload or exit

A portable page MUST assume that reload or viewer exit:

- closes peer connections;
- invalidates the current mesh identity;
- cancels in-flight HTTP work;
- removes active timers; and
- preserves only successfully persisted storage.

#### `close()` versus page exit

`close()` is a mesh operation, not complete runtime teardown.

Storage, HTTP, and timers remain available after `close()` until the page or viewer session itself ends.

#### `reset()` after close

`reset()` reopens the mesh and returns a replacement identity.

## Application protocol requirements

Coralie does not inspect application payloads. A robust page SHOULD include:

- a protocol version;
- game/room identifier;
- round/phase identifier;
- message type;
- sender-authority checks;
- sequence number or version;
- bounds on strings, arrays, and object depth;
- duplicate handling;
- stale-state rejection; and
- a join-state snapshot mechanism.

Example:

```ts
interface GameMessage {
  protocol: 1;
  type: string;
  gameId: string;
  roundId?: string;
  sequence: number;
  data: unknown;
}
```

Every received message MUST be considered untrusted.

## Non-guarantees

API v2 does not guarantee:

- peer discovery;
- browser-only room connectivity;
- TURN relay fallback;
- connection success on every network;
- stable identities across sessions;
- exact timer scheduling;
- cross-host equality of `connectedAt`;
- cross-host equality of diagnostic error text;
- automatic message broadcast or relay;
- remote receipt acknowledgement;
- persistent peer queues;
- application-state consistency; or
- authentication of real-world users.

## Conformance requirements

A host claiming Coralie Runtime API v2 SHOULD pass a shared conformance suite.

### Surface

- `window.Coralie` exists after the common host path loads.
- Every documented method exists.
- `apiVersion()` returns `2`.
- `hostKind()` returns a documented value.
- An existing host is not overwritten.

### Mesh

- Local and remote public keys are lowercase 64-character hexadecimal strings.
- Invalid keys fail visibly.
- Self-add is harmless.
- Duplicate add is harmless.
- Peer events contain complete snapshots.
- Incoming payload values are unsigned bytes.
- Sending to an unconnected peer fails.
- Retry exhaustion emits `coralie:terminalFailure`.
- `reset()` replaces the identity and clears peers.
- `close()` clears peers and disables mesh methods.
- Storage, HTTP, and timers remain usable after mesh close.

### Storage

- Missing reads return `null`.
- Set replaces an existing value.
- Remove on an absent key succeeds.
- Values round-trip as strings.

### HTTP

- Only absolute HTTPS URLs are accepted.
- GET and HEAD omit the body.
- Response shape matches `HttpResponseData`.
- Response body limit is 64 MiB.
- Oversized responses resolve with status `599`.
- Non-permission transport failures resolve with status `599`.
- Android permission rejection rejects the Promise.

### Timers

- Positive integer delays are accepted.
- `null` generates an ID.
- Reusing an ID replaces the timer.
- Unknown cancellation succeeds.
- Listing returns ID and remaining milliseconds.
- Firing removes the timer and dispatches `coralie:timerFired`.
- A null payload is omitted from the event detail.

### Events

- Events use `CustomEvent` on `window`.
- Detail values are JSON-compatible.
- Host-specific internal events are not required for page operation.

## Type declaration policy

The repository already emits `dist/index.d.ts`, and that file includes the global `window.Coralie` and event declarations.

A separate handwritten declaration is not required and would create a second contract that could drift.

Maintain the source interface and generated declaration together:

```text
src/coralie/coralie-host.interface.ts
          ↓ build
 dist/index.d.ts
```

An optional `dist/Coralie/v2/host.d.ts` MAY be generated from the same source if standalone HTML authors need editor autocomplete without installing the package. It SHOULD NOT be maintained by hand.

## Versioning

The major API version appears in both:

- `apiVersion()`; and
- the static path `Coralie/v2/host.js`.

Backward-compatible corrections can remain in v2. A change that breaks page-visible method names, argument meaning, return shape, event shape, or established lifecycle behaviour requires a new major version path.
