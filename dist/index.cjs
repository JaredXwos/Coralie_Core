"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  DEFAULT_MESH_ENDPOINTS: () => DEFAULT_MESH_ENDPOINTS,
  LinkState: () => LinkState,
  LiveAnswerer: () => LiveAnswerer,
  LiveDedupingEventSink: () => LiveDedupingEventSink,
  LiveInitiator: () => LiveInitiator,
  LiveNostrSignallingClient: () => LiveNostrSignallingClient,
  LivePeerConnection: () => LivePeerConnection,
  LivePeerLink: () => LivePeerLink,
  LiveRelaySession: () => LiveRelaySession,
  LiveRelaySocket: () => LiveRelaySocket,
  LiveSharedFlow: () => LiveSharedFlow,
  LiveSigner: () => LiveSigner,
  LiveStateFlow: () => LiveStateFlow,
  MockAnswerer: () => MockAnswerer,
  MockDataChannel: () => MockDataChannel,
  MockEventSink: () => MockEventSink,
  MockInitiator: () => MockInitiator,
  MockPeerConnection: () => MockPeerConnection,
  MockPeerLink: () => MockPeerLink,
  MockRelaySession: () => MockRelaySession,
  MockRelaySocket: () => MockRelaySocket,
  MockSharedFlow: () => MockSharedFlow,
  MockSignallingClient: () => MockSignallingClient,
  MockSigner: () => MockSigner,
  MockStateFlow: () => MockStateFlow,
  RelaySocketState: () => RelaySocketState,
  SIGNALLING_KIND: () => SIGNALLING_KIND,
  createLinkedMockPeerConnections: () => createLinkedMockPeerConnections,
  createLivePeerConnectionFactory: () => createLivePeerConnectionFactory,
  createMockSharedFlow: () => createMockSharedFlow,
  createMockStateFlow: () => createMockStateFlow,
  createSharedFlow: () => createSharedFlow,
  createStateFlow: () => createStateFlow,
  err: () => err,
  exponentialBackoff: () => exponentialBackoff,
  ok: () => ok,
  pubkeyForSeed: () => pubkeyForSeed
});
module.exports = __toCommonJS(index_exports);

// src/core/types.ts
var LinkState = /* @__PURE__ */ ((LinkState2) => {
  LinkState2["Initiating"] = "Initiating";
  LinkState2["Offering"] = "Offering";
  LinkState2["Answering"] = "Answering";
  LinkState2["Connecting"] = "Connecting";
  LinkState2["Connected"] = "Connected";
  LinkState2["Failed"] = "Failed";
  LinkState2["Closed"] = "Closed";
  return LinkState2;
})(LinkState || {});
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}

// src/mesh-endpoints.ts
var DEFAULT_MESH_ENDPOINTS = {
  relayUrls: ["wss://relay.damus.io", "wss://nos.lol", "wss://nostr.oxtr.dev", "wss://purplerelay.com"],
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun2.l.google.com:19302"] },
    { urls: ["stun:stun3.l.google.com:19302"] },
    { urls: ["stun:stun4.l.google.com:19302"] },
    { urls: ["stun:stun.cloudflare.com:3478"] }
  ]
};

// src/core/state-flow/state-flow.live.ts
var LiveStateFlow = class {
  constructor(initial) {
    this.listeners = /* @__PURE__ */ new Set();
    this.current = initial;
  }
  get value() {
    return this.current;
  }
  set value(next) {
    this.current = next;
    for (const listener of this.listeners) listener(this.current);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
  asReadOnly() {
    const self = this;
    return {
      get value() {
        return self.value;
      },
      subscribe: (listener) => self.subscribe(listener)
    };
  }
};
function createStateFlow(initial) {
  return new LiveStateFlow(initial);
}

// src/core/state-flow/state-flow.mock.ts
var MockStateFlow = class {
  constructor(initial) {
    this.listeners = /* @__PURE__ */ new Set();
    this.current = initial;
    this.history = [initial];
  }
  get value() {
    return this.current;
  }
  set value(next) {
    this.current = next;
    this.history.push(next);
    for (const listener of this.listeners) listener(this.current);
  }
  /** Number of currently-active subscribers. */
  get listenerCount() {
    return this.listeners.size;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
  asReadOnly() {
    const self = this;
    return {
      get value() {
        return self.value;
      },
      subscribe: (listener) => self.subscribe(listener)
    };
  }
};
function createMockStateFlow(initial) {
  return new MockStateFlow(initial);
}

// src/core/shared-flow/shared-flow.live.ts
var LiveSharedFlow = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Set();
  }
  emit(value) {
    for (const listener of this.listeners) listener(value);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  asReadOnly() {
    return { subscribe: (listener) => this.subscribe(listener) };
  }
};
function createSharedFlow() {
  return new LiveSharedFlow();
}

// src/core/shared-flow/shared-flow.mock.ts
var MockSharedFlow = class {
  constructor() {
    /** Every value ever emitted, in order. */
    this.emissions = [];
    this.listeners = /* @__PURE__ */ new Set();
  }
  emit(value) {
    this.emissions.push(value);
    for (const listener of this.listeners) listener(value);
  }
  get listenerCount() {
    return this.listeners.size;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  asReadOnly() {
    return { subscribe: (listener) => this.subscribe(listener) };
  }
};
function createMockSharedFlow() {
  return new MockSharedFlow();
}

// src/crypto/signer/signer.live.ts
var import_pure = require("nostr-tools/pure");
var nip44 = __toESM(require("nostr-tools/nip44"), 1);
var LiveSigner = class _LiveSigner {
  constructor(secretKey, pubkeyHex) {
    this.secretKey = secretKey;
    this.pubkeyHex = pubkeyHex;
  }
  /** Generates a fresh random identity. No persistence, no restore path. */
  static generate() {
    const secretKey = (0, import_pure.generateSecretKey)();
    return new _LiveSigner(secretKey, (0, import_pure.getPublicKey)(secretKey));
  }
  /** Builds an identity from an existing 32-byte secret key. */
  static fromSecretKey(secretKey) {
    return new _LiveSigner(secretKey, (0, import_pure.getPublicKey)(secretKey));
  }
  sign(kind, tags, content, createdAt = Math.floor(Date.now() / 1e3)) {
    const unsigned = {
      pubkey: this.pubkeyHex,
      created_at: createdAt,
      kind,
      tags,
      content
    };
    return (0, import_pure.finalizeEvent)(unsigned, this.secretKey);
  }
  verify(event) {
    return (0, import_pure.verifyEvent)(event);
  }
  getConvoKey(theirPubkeyHex) {
    assertPubkeyHex(theirPubkeyHex);
    return nip44.v2.utils.getConversationKey(this.secretKey, theirPubkeyHex);
  }
  encryptNip44(plaintext, convoKey) {
    return nip44.v2.encrypt(plaintext, convoKey);
  }
  decryptNip44(payload, convoKey) {
    return nip44.v2.decrypt(payload, convoKey);
  }
};
var HEX_64_RE = /^[0-9a-f]{64}$/i;
function assertPubkeyHex(pubkeyHex) {
  if (!HEX_64_RE.test(pubkeyHex)) {
    throw new Error(`invalid pubkey hex: expected 64 hex chars, got ${JSON.stringify(pubkeyHex)}`);
  }
}

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error('"digestInto() output" expected to be of length >=' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function createHasher(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
var oidNist = (suffix) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  constructor(blockLen, outputLen, padOffset, isLE) {
    __publicField(this, "blockLen");
    __publicField(this, "outputLen");
    __publicField(this, "padOffset");
    __publicField(this, "isLE");
    // For partial updates less than block size
    __publicField(this, "buffer");
    __publicField(this, "view");
    __publicField(this, "finished", false);
    __publicField(this, "length", 0);
    __publicField(this, "pos", 0);
    __publicField(this, "destroyed", false);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32);
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    __publicField(this, "A", SHA256_IV[0] | 0);
    __publicField(this, "B", SHA256_IV[1] | 0);
    __publicField(this, "C", SHA256_IV[2] | 0);
    __publicField(this, "D", SHA256_IV[3] | 0);
    __publicField(this, "E", SHA256_IV[4] | 0);
    __publicField(this, "F", SHA256_IV[5] | 0);
    __publicField(this, "G", SHA256_IV[6] | 0);
    __publicField(this, "H", SHA256_IV[7] | 0);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// src/crypto/signer/signer.mock.ts
var import_pure2 = require("nostr-tools/pure");
var MockSigner = class _MockSigner {
  constructor(live) {
    this.live = live;
  }
  /** Deterministic identity derived from `seed` (sha256(seed) as the secret key). */
  static fromSeed(seed) {
    const secretKey = sha256(new TextEncoder().encode(seed));
    return new _MockSigner(LiveSigner.fromSecretKey(secretKey));
  }
  get pubkeyHex() {
    return this.live.pubkeyHex;
  }
  sign(kind, tags, content, createdAt) {
    return this.live.sign(kind, tags, content, createdAt);
  }
  verify(event) {
    return this.live.verify(event);
  }
  getConvoKey(theirPubkeyHex) {
    return this.live.getConvoKey(theirPubkeyHex);
  }
  encryptNip44(plaintext, convoKey) {
    return this.live.encryptNip44(plaintext, convoKey);
  }
  decryptNip44(payload, convoKey) {
    return this.live.decryptNip44(payload, convoKey);
  }
};
function pubkeyForSeed(seed) {
  const secretKey = sha256(new TextEncoder().encode(seed));
  return (0, import_pure2.getPublicKey)(secretKey);
}

// src/nostr/event-sink/event-sink.live.ts
var DEFAULT_RETENTION_WINDOW_MS = 5 * 60 * 1e3;
var DEFAULT_MAX_ENTRIES = 1e4;
var LiveDedupingEventSink = class {
  constructor(options = {}) {
    this.seenAt = /* @__PURE__ */ new Map();
    this.retentionWindowMs = options.retentionWindowMs ?? DEFAULT_RETENTION_WINDOW_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }
  offer(event) {
    const now = this.now();
    this.evictExpired(now);
    if (this.seenAt.has(event.id)) {
      return false;
    }
    this.seenAt.set(event.id, now);
    this.evictOverCapacity();
    return true;
  }
  /** Number of event ids currently tracked. Exposed for tests/inspection. */
  get size() {
    return this.seenAt.size;
  }
  evictExpired(now) {
    const cutoff = now - this.retentionWindowMs;
    for (const [id, seenAt] of this.seenAt) {
      if (seenAt <= cutoff) {
        this.seenAt.delete(id);
      } else {
        break;
      }
    }
  }
  evictOverCapacity() {
    while (this.seenAt.size > this.maxEntries) {
      const oldestId = this.seenAt.keys().next().value;
      if (oldestId === void 0) break;
      this.seenAt.delete(oldestId);
    }
  }
};

// src/nostr/event-sink/event-sink.mock.ts
var MockEventSink = class {
  constructor() {
    /** Every event passed to `offer()`, in call order (including duplicates). */
    this.offered = [];
    this.seenIds = /* @__PURE__ */ new Set();
  }
  offer(event) {
    this.offered.push(event);
    if (this.seenIds.has(event.id)) return false;
    this.seenIds.add(event.id);
    return true;
  }
  /** Test helper: forget an id, so the next offer() of it is accepted again. */
  forget(eventId) {
    this.seenIds.delete(eventId);
  }
};

// src/nostr/relay-socket/relay-socket.interface.ts
var RelaySocketState = /* @__PURE__ */ ((RelaySocketState2) => {
  RelaySocketState2["Connecting"] = "Connecting";
  RelaySocketState2["Open"] = "Open";
  RelaySocketState2["Reconnecting"] = "Reconnecting";
  RelaySocketState2["Closed"] = "Closed";
  return RelaySocketState2;
})(RelaySocketState || {});

// src/nostr/relay-socket/relay-socket.live.ts
function exponentialBackoff(attempt, options) {
  const base = options?.baseMs ?? 500;
  const max = options?.maxMs ?? 3e4;
  return Math.min(max, base * 2 ** attempt);
}
var OPEN_READY_STATE = 1;
var LiveRelaySocket = class {
  constructor(url, options = {}) {
    this.url = url;
    this.stateFlow = createStateFlow("Connecting" /* Connecting */);
    this.messagesFlow = createSharedFlow();
    this.ws = null;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.closedByCaller = false;
    this.backoffStrategy = options.backoffStrategy ?? exponentialBackoff;
    this.webSocketFactory = options.webSocketFactory ?? ((u) => new WebSocket(u));
    this.openSocket();
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get messages() {
    return this.messagesFlow.asReadOnly();
  }
  send(data) {
    if (this.stateFlow.value !== "Open" /* Open */ || !this.ws) {
      return err(new Error(`relay ${this.url}: not open`));
    }
    if (this.ws.readyState !== OPEN_READY_STATE) {
      return err(new Error(`relay ${this.url}: socket not ready`));
    }
    this.ws.send(data);
    return ok(void 0);
  }
  close() {
    if (this.closedByCaller) return;
    this.closedByCaller = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stateFlow.value = "Closed" /* Closed */;
    this.ws?.close(1e3, "client closing");
    this.ws = null;
  }
  openSocket() {
    if (this.closedByCaller) return;
    this.stateFlow.value = this.attempt === 0 ? "Connecting" /* Connecting */ : "Reconnecting" /* Reconnecting */;
    const socket = this.webSocketFactory(this.url);
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.attempt = 0;
      this.stateFlow.value = "Open" /* Open */;
    };
    socket.onmessage = (ev) => {
      if (this.ws !== socket) return;
      this.messagesFlow.emit(ev.data);
    };
    socket.onerror = () => {
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      if (this.closedByCaller) return;
      this.scheduleReconnect();
    };
  }
  scheduleReconnect() {
    const delay = this.backoffStrategy(this.attempt);
    this.attempt += 1;
    this.stateFlow.value = "Reconnecting" /* Reconnecting */;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
};

// src/nostr/relay-socket/relay-socket.mock.ts
var MockRelaySocket = class {
  constructor(url = "wss://relay.example") {
    this.url = url;
    this.stateFlow = createStateFlow("Connecting" /* Connecting */);
    this.messagesFlow = createSharedFlow();
    /** Every frame handed to `send()`, in order. */
    this.sent = [];
    this.closed = false;
    this.sendResult = ok(void 0);
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get messages() {
    return this.messagesFlow.asReadOnly();
  }
  send(data) {
    this.sent.push(data);
    return this.sendResult;
  }
  close() {
    this.closed = true;
    this.stateFlow.value = "Closed" /* Closed */;
  }
  // --- test-only driver methods ---
  open() {
    this.stateFlow.value = "Open" /* Open */;
  }
  reconnecting() {
    this.stateFlow.value = "Reconnecting" /* Reconnecting */;
  }
  /** Configures every subsequent `send()` to report failure. */
  failSends(error = new Error("mock relay rejected send")) {
    this.sendResult = { ok: false, error };
  }
  /** Simulates an inbound raw text frame from the relay. */
  deliver(raw) {
    this.messagesFlow.emit(raw);
  }
};

// src/nostr/relay-session/relay-session.live.ts
var SUBSCRIPTION_ID = "mesh";
var LiveRelaySession = class {
  constructor(socket, myPubkeyHex, kinds) {
    this.socket = socket;
    this.myPubkeyHex = myPubkeyHex;
    this.kinds = kinds;
    this.eventsFlow = createSharedFlow();
    this.unsubscribeSocketState = this.socket.state.subscribe((state) => {
      if (state === "Open" /* Open */) {
        this.sendSubscription();
      }
    });
    this.unsubscribeSocketMessages = this.socket.messages.subscribe((raw) => {
      this.handleMessage(raw);
    });
  }
  get url() {
    return this.socket.url;
  }
  get connectionState() {
    return this.socket.state;
  }
  get events() {
    return this.eventsFlow.asReadOnly();
  }
  publish(event) {
    return this.socket.send(JSON.stringify(["EVENT", event]));
  }
  close() {
    this.unsubscribeSocketState();
    this.unsubscribeSocketMessages();
    this.socket.close();
  }
  sendSubscription() {
    const filter = { "#p": [this.myPubkeyHex] };
    if (this.kinds) filter.kinds = this.kinds;
    this.socket.send(JSON.stringify(["REQ", SUBSCRIPTION_ID, filter]));
  }
  handleMessage(raw) {
    const parsed = parseRelayMessage(raw);
    if (!parsed.ok) return;
    const [type, ...rest] = parsed.value;
    if (type === "EVENT" && rest[0] === SUBSCRIPTION_ID) {
      const event = rest[1];
      this.eventsFlow.emit(event);
    }
  }
};
function parseRelayMessage(raw) {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== "string") {
      return err(new Error("malformed relay frame: not a [type, ...] array"));
    }
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

// src/nostr/relay-session/relay-session.mock.ts
var MockRelaySession = class {
  constructor(url = "wss://relay.example") {
    this.url = url;
    this.stateFlow = createStateFlow("Open" /* Open */);
    this.eventsFlow = createSharedFlow();
    /** Every event handed to `publish()`, in order. */
    this.published = [];
    this.publishResult = ok(void 0);
  }
  get connectionState() {
    return this.stateFlow.asReadOnly();
  }
  get events() {
    return this.eventsFlow.asReadOnly();
  }
  publish(event) {
    this.published.push(event);
    return this.publishResult;
  }
  close() {
    this.stateFlow.value = "Closed" /* Closed */;
  }
  // --- test-only driver methods ---
  /** Configures every subsequent `publish()` to report failure. */
  failPublishes(error = new Error("mock relay rejected publish")) {
    this.publishResult = { ok: false, error };
  }
  /** Simulates an inbound event delivered by this relay. */
  deliver(event) {
    this.eventsFlow.emit(event);
  }
};

// src/nostr/signalling-client/signalling-client.interface.ts
var SIGNALLING_KIND = 25050;

// src/nostr/signalling-client/signalling-client.live.ts
var LiveNostrSignallingClient = class {
  constructor(signer, relayUrls, options = {}) {
    this.signer = signer;
    this.inboundFlow = createSharedFlow();
    this.unsubscribes = [];
    this.sink = options.eventSink ?? new LiveDedupingEventSink();
    const createSession = options.createRelaySession ?? ((url, myPubkeyHex) => {
      const socket = new LiveRelaySocket(url, options.relaySocketOptions);
      return new LiveRelaySession(socket, myPubkeyHex, [SIGNALLING_KIND]);
    });
    this.sessions = relayUrls.map((url) => createSession(url, this.signer.pubkeyHex));
    for (const session of this.sessions) {
      const unsubscribe = session.events.subscribe((event) => this.handleInboundEvent(event));
      this.unsubscribes.push(unsubscribe);
    }
  }
  get myPubkeyHex() {
    return this.signer.pubkeyHex;
  }
  get inbound() {
    return this.inboundFlow.asReadOnly();
  }
  send(toPubkeyHex, payload) {
    const convoKey = this.signer.getConvoKey(toPubkeyHex);
    const ciphertext = this.signer.encryptNip44(payload, convoKey);
    const event = this.signer.sign(SIGNALLING_KIND, [["p", toPubkeyHex]], ciphertext);
    let anySucceeded = false;
    let lastError = new Error("no relays configured");
    for (const session of this.sessions) {
      const result = session.publish(event);
      if (result.ok) {
        anySucceeded = true;
      } else {
        lastError = result.error;
      }
    }
    return anySucceeded ? ok(void 0) : err(lastError);
  }
  close() {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    for (const session of this.sessions) session.close();
  }
  handleInboundEvent(event) {
    if (!this.sink.offer(event)) return;
    let convoKey;
    try {
      convoKey = this.signer.getConvoKey(event.pubkey);
    } catch {
      return;
    }
    let plaintext;
    try {
      plaintext = this.signer.decryptNip44(event.content, convoKey);
    } catch {
      return;
    }
    this.inboundFlow.emit({ fromPubkeyHex: event.pubkey, payload: plaintext });
  }
};

// src/nostr/signalling-client/signalling-client.mock.ts
var MockSignallingClient = class {
  constructor(myPubkeyHex) {
    this.myPubkeyHex = myPubkeyHex;
    this.inboundFlow = createSharedFlow();
    /** Every `send()` call, in order. */
    this.sent = [];
    this.sendResult = ok(void 0);
  }
  get inbound() {
    return this.inboundFlow.asReadOnly();
  }
  send(toPubkeyHex, payload) {
    this.sent.push({ toPubkeyHex, payload });
    return this.sendResult;
  }
  close() {
  }
  // --- test-only driver methods ---
  /** Configures every subsequent `send()` to report failure. */
  failSends(error = new Error("mock signalling client rejected send")) {
    this.sendResult = { ok: false, error };
  }
  /** Simulates a decrypted inbound message arriving from `fromPubkeyHex`. */
  deliver(fromPubkeyHex, payload) {
    this.inboundFlow.emit({ fromPubkeyHex, payload });
  }
};

// src/webrtc/peer-connection/peer-connection.live.ts
var LiveDataChannel = class {
  constructor(channel) {
    this.channel = channel;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.onopen?.();
    channel.onclose = () => this.onclose?.();
    channel.onmessage = (ev) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(0);
      this.onmessage?.({ data });
    };
  }
  get label() {
    return this.channel.label;
  }
  get readyState() {
    return this.channel.readyState;
  }
  send(data) {
    this.channel.send(data);
  }
  close() {
    this.channel.close();
  }
};
var LivePeerConnection = class {
  constructor(pc) {
    this.pc = pc;
    this.onconnectionstatechange = null;
    this.ondatachannel = null;
    this.pc.onconnectionstatechange = () => this.onconnectionstatechange?.();
    this.pc.ondatachannel = (ev) => {
      this.ondatachannel?.({ channel: new LiveDataChannel(ev.channel) });
    };
  }
  get connectionState() {
    return this.pc.connectionState;
  }
  createDataChannel(label) {
    return new LiveDataChannel(this.pc.createDataChannel(label));
  }
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForIceGatheringComplete();
    return this.currentLocalDescription("offer");
  }
  async createAnswer() {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIceGatheringComplete();
    return this.currentLocalDescription("answer");
  }
  async setRemoteDescription(desc) {
    await this.pc.setRemoteDescription(desc);
  }
  close() {
    this.pc.close();
  }
  currentLocalDescription(type) {
    const local = this.pc.localDescription;
    if (!local) throw new Error(`localDescription missing after create${type === "offer" ? "Offer" : "Answer"}()`);
    return { type, sdp: local.sdp };
  }
  waitForIceGatheringComplete() {
    if (this.pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.pc.iceGatheringState === "complete") {
          this.pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      this.pc.addEventListener("icegatheringstatechange", check);
    });
  }
};
function createLivePeerConnectionFactory(options = {}) {
  return () => new LivePeerConnection(new RTCPeerConnection({ iceServers: options.iceServers }));
}

// src/webrtc/peer-connection/peer-connection.mock.ts
var MockDataChannel = class {
  constructor(label) {
    this.label = label;
    this.readyState = "connecting";
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.peer = null;
    this.sent = [];
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  send(data) {
    this.sent.push(data);
    this.peer?.onmessage?.({ data });
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
};
var MockPeerConnection = class {
  constructor() {
    this.connectionState = "new";
    this.onconnectionstatechange = null;
    this.ondatachannel = null;
    this.dataChannel = null;
    this.remote = null;
  }
  createDataChannel(label) {
    const channel = new MockDataChannel(label);
    this.dataChannel = channel;
    return channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "mock-offer-sdp" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "mock-answer-sdp" };
  }
  async setRemoteDescription(desc) {
    if (desc.type === "offer") {
      const remoteChannel = this.remote?.dataChannel;
      if (remoteChannel) {
        const localChannel = new MockDataChannel(remoteChannel.label);
        localChannel.peer = remoteChannel;
        remoteChannel.peer = localChannel;
        this.dataChannel = localChannel;
        this.ondatachannel?.({ channel: localChannel });
      }
    } else {
      this.markConnected();
      this.remote?.markConnected();
      this.dataChannel?.open();
      this.remote?.dataChannel?.open();
    }
  }
  close() {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
  markConnected() {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }
  simulateFailure() {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
};
function createLinkedMockPeerConnections() {
  const a = new MockPeerConnection();
  const b = new MockPeerConnection();
  a.remote = b;
  b.remote = a;
  return [a, b];
}

// src/webrtc/peer-link/peer-link.live.ts
var LivePeerLink = class {
  constructor(channel) {
    this.channel = channel;
    this.stateFlow = createStateFlow("open");
    this.incomingBytesFlow = createSharedFlow();
    this.channel.onmessage = (ev) => {
      this.incomingBytesFlow.emit(ev.data);
    };
    this.channel.onclose = () => {
      this.stateFlow.value = "closed";
    };
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get incomingBytes() {
    return this.incomingBytesFlow.asReadOnly();
  }
  send(data) {
    if (this.stateFlow.value !== "open") {
      throw new Error("cannot send on a closed PeerLink");
    }
    this.channel.send(data);
  }
  close() {
    if (this.stateFlow.value === "closed") return;
    this.stateFlow.value = "closed";
    this.channel.close();
  }
};

// src/webrtc/peer-link/peer-link.mock.ts
var MockPeerLink = class {
  constructor() {
    this.stateFlow = createStateFlow("open");
    this.incomingBytesFlow = createSharedFlow();
    /** Every payload handed to `send()`, in order. */
    this.sent = [];
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get incomingBytes() {
    return this.incomingBytesFlow.asReadOnly();
  }
  send(data) {
    if (this.stateFlow.value !== "open") {
      throw new Error("cannot send on a closed PeerLink");
    }
    this.sent.push(data);
  }
  close() {
    this.stateFlow.value = "closed";
  }
  // --- test-only driver methods ---
  /** Simulates bytes arriving from the remote peer. */
  simulateIncoming(data) {
    this.incomingBytesFlow.emit(data);
  }
};

// src/webrtc/initiator/initiator.live.ts
var DEFAULT_HANDSHAKE_TIMEOUT_MS = 3e4;
var DATA_CHANNEL_LABEL = "mesh";
var LiveInitiator = class {
  constructor(options) {
    this.stateFlow = createStateFlow("Initiating" /* Initiating */);
    this.timeoutHandle = null;
    this.link = null;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.pc = options.peerConnectionFactory();
    this.pc.onconnectionstatechange = () => this.handleConnectionStateChange();
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get peerLink() {
    return this.link;
  }
  async createOffer() {
    const channel = this.pc.createDataChannel(DATA_CHANNEL_LABEL);
    this.wireDataChannel(channel);
    this.stateFlow.value = "Offering" /* Offering */;
    const offer = await this.pc.createOffer();
    this.stateFlow.value = "Connecting" /* Connecting */;
    this.startHandshakeTimeout();
    return offer;
  }
  async acceptAnswer(answer) {
    if (this.stateFlow.value !== "Connecting" /* Connecting */) return;
    await this.pc.setRemoteDescription(answer);
  }
  close() {
    this.clearHandshakeTimeout();
    this.link?.close();
    this.pc.close();
    this.stateFlow.value = "Closed" /* Closed */;
  }
  wireDataChannel(channel) {
    channel.onopen = () => {
      if (this.stateFlow.value !== "Connecting" /* Connecting */) return;
      this.link = new LivePeerLink(channel);
      this.clearHandshakeTimeout();
      this.stateFlow.value = "Connected" /* Connected */;
    };
  }
  handleConnectionStateChange() {
    if (this.pc.connectionState === "failed") this.fail();
  }
  fail() {
    if (this.stateFlow.value === "Failed" /* Failed */ || this.stateFlow.value === "Closed" /* Closed */) return;
    this.clearHandshakeTimeout();
    this.stateFlow.value = "Failed" /* Failed */;
  }
  startHandshakeTimeout() {
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      if (this.stateFlow.value !== "Connected" /* Connected */) this.fail();
    }, this.handshakeTimeoutMs);
  }
  clearHandshakeTimeout() {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
};

// src/webrtc/initiator/initiator.mock.ts
var MockInitiator = class {
  constructor() {
    this.stateFlow = createStateFlow("Initiating" /* Initiating */);
    this.link = null;
    /** Every offer returned by `createOffer()`, in order. */
    this.offersCreated = [];
    /** Every answer passed to `acceptAnswer()`, in order. */
    this.answersAccepted = [];
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get peerLink() {
    return this.link;
  }
  async createOffer() {
    this.stateFlow.value = "Offering" /* Offering */;
    const offer = { type: "offer", sdp: "mock-offer-sdp" };
    this.offersCreated.push(offer);
    this.stateFlow.value = "Connecting" /* Connecting */;
    return offer;
  }
  async acceptAnswer(answer) {
    if (this.stateFlow.value !== "Connecting" /* Connecting */) return;
    this.answersAccepted.push(answer);
  }
  close() {
    this.link?.close();
    this.stateFlow.value = "Closed" /* Closed */;
  }
  // --- test-only driver methods ---
  /** Forces the state machine to Connected, attaching the given PeerLink. */
  simulateConnected(link) {
    this.link = link;
    this.stateFlow.value = "Connected" /* Connected */;
  }
  /** Forces the state machine to Failed (connection failure or handshake timeout). */
  simulateFailed() {
    if (this.stateFlow.value === "Closed" /* Closed */) return;
    this.stateFlow.value = "Failed" /* Failed */;
  }
};

// src/webrtc/answerer/answerer.live.ts
var LiveAnswerer = class {
  constructor(options) {
    this.stateFlow = createStateFlow("Answering" /* Answering */);
    this.link = null;
    this.pc = options.peerConnectionFactory();
    this.pc.onconnectionstatechange = () => this.handleConnectionStateChange();
    this.pc.ondatachannel = (ev) => this.wireDataChannel(ev.channel);
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get peerLink() {
    return this.link;
  }
  async createAnswer(offer) {
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    this.stateFlow.value = "Connecting" /* Connecting */;
    return answer;
  }
  close() {
    this.link?.close();
    this.pc.close();
    this.stateFlow.value = "Closed" /* Closed */;
  }
  wireDataChannel(channel) {
    channel.onopen = () => {
      if (this.stateFlow.value !== "Connecting" /* Connecting */) return;
      this.link = new LivePeerLink(channel);
      this.stateFlow.value = "Connected" /* Connected */;
    };
  }
  handleConnectionStateChange() {
    if (this.pc.connectionState !== "failed") return;
    if (this.stateFlow.value === "Failed" /* Failed */ || this.stateFlow.value === "Closed" /* Closed */) return;
    this.stateFlow.value = "Failed" /* Failed */;
  }
};

// src/webrtc/answerer/answerer.mock.ts
var MockAnswerer = class {
  constructor() {
    this.stateFlow = createStateFlow("Answering" /* Answering */);
    this.link = null;
    /** Every offer passed to `createAnswer()`, in order. */
    this.offersReceived = [];
  }
  get state() {
    return this.stateFlow.asReadOnly();
  }
  get peerLink() {
    return this.link;
  }
  async createAnswer(offer) {
    this.offersReceived.push(offer);
    this.stateFlow.value = "Connecting" /* Connecting */;
    return { type: "answer", sdp: "mock-answer-sdp" };
  }
  close() {
    this.link?.close();
    this.stateFlow.value = "Closed" /* Closed */;
  }
  // --- test-only driver methods ---
  /** Forces the state machine to Connected, attaching the given PeerLink. */
  simulateConnected(link) {
    this.link = link;
    this.stateFlow.value = "Connected" /* Connected */;
  }
  /** Forces the state machine to Failed. */
  simulateFailed() {
    if (this.stateFlow.value === "Closed" /* Closed */) return;
    this.stateFlow.value = "Failed" /* Failed */;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_MESH_ENDPOINTS,
  LinkState,
  LiveAnswerer,
  LiveDedupingEventSink,
  LiveInitiator,
  LiveNostrSignallingClient,
  LivePeerConnection,
  LivePeerLink,
  LiveRelaySession,
  LiveRelaySocket,
  LiveSharedFlow,
  LiveSigner,
  LiveStateFlow,
  MockAnswerer,
  MockDataChannel,
  MockEventSink,
  MockInitiator,
  MockPeerConnection,
  MockPeerLink,
  MockRelaySession,
  MockRelaySocket,
  MockSharedFlow,
  MockSignallingClient,
  MockSigner,
  MockStateFlow,
  RelaySocketState,
  SIGNALLING_KIND,
  createLinkedMockPeerConnections,
  createLivePeerConnectionFactory,
  createMockSharedFlow,
  createMockStateFlow,
  createSharedFlow,
  createStateFlow,
  err,
  exponentialBackoff,
  ok,
  pubkeyForSeed
});
/*! Bundled license information:

@noble/hashes/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
