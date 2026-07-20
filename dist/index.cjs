"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  LinkState: () => LinkState,
  createLiveConnectionManager: () => createLiveConnectionManager
});
module.exports = __toCommonJS(index_exports);

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

// src/connection/live-connection-manager.ts
var HANDSHAKE_TIMEOUT_MS = 3e4;
var MAX_INITIATION_ATTEMPTS = 5;
var LiveConnectionManager = class {
  constructor(signalingClient, peerConnectionFactory, handshakeTimeoutMs) {
    this.initiating = /* @__PURE__ */ new Map();
    this.connected = /* @__PURE__ */ new Map();
    this.timeoutCheckInterval = null;
    this.closed = false;
    this.myPubkeyHex = signalingClient.myPubkeyHex;
    this.signalingClient = signalingClient;
    this.peerConnectionFactory = peerConnectionFactory;
    this.handshakeTimeoutMs = handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.peers = createStateFlow(/* @__PURE__ */ new Set());
    this.incomingMessages = createSharedFlow();
    this.terminalFailures = createSharedFlow();
    this.setupInboundSignalling();
    this.startTimeoutChecker();
  }
  setupInboundSignalling() {
    this.signalingClient.inbound.subscribe((message) => {
      if (this.closed) return;
      try {
        const frame = JSON.parse(message.payload);
        if (frame.type === "Offer") {
          this.onInboundOffer(message.fromPubkeyHex, frame.sessionDescription, frame.attemptCount);
        } else if (frame.type === "Answer") {
          this.onInboundAnswer(message.fromPubkeyHex, frame.sessionDescription);
        } else if (frame.type === "Announce") {
          this.onInboundAnnounce(message.fromPubkeyHex, frame.pubkeyHex);
        }
      } catch (err2) {
        console.error(`Failed to parse signalling frame from ${message.fromPubkeyHex}:`, err2);
      }
    });
  }
  startTimeoutChecker() {
    this.timeoutCheckInterval = setInterval(() => {
      if (this.closed) return;
      this.checkTimeouts();
    }, 1e3);
  }
  /**
   * §2 rule 1: New pubkey learned → become initiator if conditions met.
   * Idempotent: calling twice with same pubkey while `initiating` is a no-op.
   */
  addPeer(pubkeyHex) {
    if (this.closed) return;
    if (pubkeyHex === this.myPubkeyHex) return;
    if (this.initiating.has(pubkeyHex)) return;
    if (this.connected.has(pubkeyHex)) return;
    this.startInitiation(pubkeyHex);
  }
  startInitiation(pubkeyHex) {
    const connection = new LiveInitiator({
      peerConnectionFactory: this.peerConnectionFactory,
      handshakeTimeoutMs: this.handshakeTimeoutMs
    });
    const slot = {
      connection,
      attemptCount: 1,
      startedAt: Date.now()
    };
    this.initiating.set(pubkeyHex, slot);
    connection.state.subscribe((state) => {
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== connection) return;
      if (state === "Connected") {
        this.onLinkConnected(pubkeyHex, connection.peerLink);
      } else if (state === "Failed") {
        this.onAttemptFailed(pubkeyHex);
      }
    });
    this.sendOfferAsync(pubkeyHex, connection);
  }
  async sendOfferAsync(pubkeyHex, initiator) {
    try {
      const offer = await initiator.createOffer();
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return;
      const frame = {
        type: "Offer",
        sessionDescription: offer,
        attemptCount: this.initiating.get(pubkeyHex).attemptCount
      };
      const result = this.signalingClient.send(pubkeyHex, JSON.stringify(frame));
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return;
      if (!result.ok) {
        this.onAttemptFailed(pubkeyHex);
      }
    } catch (err2) {
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return;
      console.error(`Failed to create/send offer to ${pubkeyHex}:`, err2);
      this.onAttemptFailed(pubkeyHex);
    }
  }
  /**
   * §2 rule 2: Inbound offer handling.
   * Accept only if:
   * - sender is not already `connected`
   * - `initiating` map is empty (global gate)
   */
  onInboundOffer(fromPubkeyHex, offer, attemptCount) {
    if (this.closed) return;
    if (this.connected.has(fromPubkeyHex)) return;
    if (this.initiating.size > 0) return;
    const answerer = new LiveAnswerer({ peerConnectionFactory: this.peerConnectionFactory });
    answerer.state.subscribe((state) => {
      if (this.closed) return;
      if (this.initiating.has(fromPubkeyHex)) return;
      if (state === "Connected") {
        this.onLinkConnected(fromPubkeyHex, answerer.peerLink);
      } else if (state === "Failed") {
      }
    });
    this.acceptOfferInAnswerer(fromPubkeyHex, answerer, offer);
  }
  async acceptOfferInAnswerer(toPubkeyHex, answerer, offer) {
    try {
      const answer = await answerer.createAnswer(offer);
      if (this.closed) return;
      const frame = {
        type: "Answer",
        sessionDescription: answer
      };
      this.signalingClient.send(toPubkeyHex, JSON.stringify(frame));
    } catch (err2) {
      if (this.closed) return;
      console.error(`Failed to create/send answer to ${toPubkeyHex}:`, err2);
    }
  }
  /**
   * §2 rule 3: Inbound answer handling.
   * Match against in-flight initiation for the sender's pubkey.
   * If no matching slot or slot has been superseded by a retry: no-op.
   */
  onInboundAnswer(fromPubkeyHex, answer) {
    if (this.closed) return;
    const slot = this.initiating.get(fromPubkeyHex);
    if (!slot) return;
    this.applyAnswerAsync(fromPubkeyHex, slot.connection, answer);
  }
  async applyAnswerAsync(pubkeyHex, initiator, answer) {
    try {
      await initiator.acceptAnswer(answer);
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return;
    } catch (err2) {
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== initiator) return;
      console.error(`Failed to apply answer from ${pubkeyHex}:`, err2);
      this.onAttemptFailed(pubkeyHex);
    }
  }
  /**
   * §2 rule 4: Attempt failure handling.
   * Increment counter; if ≥ 5: remove pubkey and emit terminal failure.
   * Otherwise: create fresh peer connection and retry.
   */
  onAttemptFailed(pubkeyHex) {
    if (this.closed) return;
    const slot = this.initiating.get(pubkeyHex);
    if (!slot) return;
    slot.connection.close();
    if (slot.attemptCount >= MAX_INITIATION_ATTEMPTS) {
      this.initiating.delete(pubkeyHex);
      this.terminalFailures.emit({
        pubkeyHex,
        attemptCount: slot.attemptCount,
        reason: "Exhausted maximum retry attempts"
      });
      return;
    }
    slot.attemptCount += 1;
    slot.startedAt = Date.now();
    const newConnection = new LiveInitiator({
      peerConnectionFactory: this.peerConnectionFactory,
      handshakeTimeoutMs: this.handshakeTimeoutMs
    });
    slot.connection = newConnection;
    newConnection.state.subscribe((state) => {
      if (this.closed) return;
      if (this.initiating.get(pubkeyHex)?.connection !== newConnection) return;
      if (state === "Connected") {
        this.onLinkConnected(pubkeyHex, newConnection.peerLink);
      } else if (state === "Failed") {
        this.onAttemptFailed(pubkeyHex);
      }
    });
    this.sendOfferAsync(pubkeyHex, newConnection);
  }
  /**
   * §2 rule 5: Connection reaches open.
   * Move from `initiating` to `connected`, broadcast `Announce` to all other
   * connected peers (best-effort).
   */
  onLinkConnected(pubkeyHex, peerLink) {
    if (this.closed) return;
    this.initiating.delete(pubkeyHex);
    this.connected.set(pubkeyHex, peerLink);
    const updatedPeers = new Set(this.peers.value);
    updatedPeers.add({ pubkeyHex, connectedAt: Date.now() });
    this.peers.value = updatedPeers;
    peerLink.incomingBytes.subscribe((bytes) => {
      if (this.closed) return;
      this.onIncomingDataChannel(pubkeyHex, bytes);
    });
    peerLink.state.subscribe((state) => {
      if (this.closed) return;
      if (this.connected.get(pubkeyHex) !== peerLink) return;
      if (state === "closed") {
        this.onLinkClosed(pubkeyHex);
      }
    });
    this.broadcastAnnounce(pubkeyHex);
  }
  onIncomingDataChannel(fromPubkeyHex, bytes) {
    if (this.closed) return;
    try {
      const text = new TextDecoder().decode(bytes);
      const frame = JSON.parse(text);
      if (frame.type === "Data") {
        this.incomingMessages.emit({
          from: fromPubkeyHex,
          to: this.myPubkeyHex,
          timestamp: Date.now(),
          payload: frame.payload
        });
      } else if (frame.type === "Announce") {
        this.onInboundAnnounce(fromPubkeyHex, frame.pubkeyHex);
      }
    } catch (err2) {
      console.error(`Failed to parse data channel frame from ${fromPubkeyHex}:`, err2);
    }
  }
  /**
   * §2 rule 6: Connection closes or fails (post-open).
   * Remove from `connected`. No re-announce, no cleanup broadcast.
   */
  onLinkClosed(pubkeyHex) {
    if (this.closed) return;
    const peerLink = this.connected.get(pubkeyHex);
    if (!peerLink) return;
    this.connected.delete(pubkeyHex);
    peerLink.close();
    const updatedPeers = new Set(this.peers.value);
    updatedPeers.forEach((peer) => {
      if (peer.pubkeyHex === pubkeyHex) {
        updatedPeers.delete(peer);
      }
    });
    this.peers.value = updatedPeers;
  }
  /**
   * §2 rule 5: broadcast an Announce for one newly-connected pubkey to every
   * *other* connected peer. This is not a roster sync — the recipient learns
   * about exactly one new peer, not the sender's full connected set — and the
   * newly-connected peer itself is excluded (it doesn't need telling about
   * its own connection). Best-effort, no retry, no acknowledgement.
   */
  broadcastAnnounce(newPubkeyHex) {
    const frame = {
      type: "Announce",
      pubkeyHex: newPubkeyHex
    };
    const bytes = new TextEncoder().encode(JSON.stringify(frame));
    for (const [peerPubkey, peerLink] of this.connected.entries()) {
      if (peerPubkey === newPubkeyHex) continue;
      peerLink.send(bytes);
    }
  }
  /**
   * Inbound Announce handling: learn a new peer via gossip (§2 rule 5).
   * If already `initiating` or `connected`: no-op (idempotent).
   * Otherwise: call `addPeer()` (same entry point, same idempotency).
   */
  onInboundAnnounce(fromPubkeyHex, pubkeyHex) {
    if (this.closed) return;
    if (pubkeyHex === this.myPubkeyHex) return;
    if (this.initiating.has(pubkeyHex)) return;
    if (this.connected.has(pubkeyHex)) return;
    this.addPeer(pubkeyHex);
  }
  /**
   * Timeout checker: runs every 1s, checks all `initiating` slots for
   * 30s elapsed time. Any slot that has exceeded timeout is marked failed.
   */
  checkTimeouts() {
    const now = Date.now();
    const expired = [];
    for (const [pubkeyHex, slot] of this.initiating.entries()) {
      if (now - slot.startedAt >= this.handshakeTimeoutMs) {
        expired.push(pubkeyHex);
      }
    }
    for (const pubkeyHex of expired) {
      this.onAttemptFailed(pubkeyHex);
    }
  }
  /**
   * Send a message to a connected peer via data channel.
   * If not connected: dropped silently.
   */
  sendToPeer(toPubkeyHex, payload) {
    if (this.closed) return;
    const peerLink = this.connected.get(toPubkeyHex);
    if (!peerLink) return;
    const frame = {
      type: "Data",
      payload
    };
    const bytes = new TextEncoder().encode(JSON.stringify(frame));
    peerLink.send(bytes);
  }
  /**
   * Close all connections and stop timers.
   */
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timeoutCheckInterval !== null) {
      clearInterval(this.timeoutCheckInterval);
    }
    for (const slot of this.initiating.values()) {
      slot.connection.close();
    }
    this.initiating.clear();
    for (const peerLink of this.connected.values()) {
      peerLink.close();
    }
    this.connected.clear();
    this.signalingClient.close();
  }
};

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

// src/create-live-connection-manager.ts
function createLiveConnectionManager(options = {}) {
  const relayUrls = options.relayUrls ?? DEFAULT_MESH_ENDPOINTS.relayUrls;
  const iceServers = options.iceServers ?? DEFAULT_MESH_ENDPOINTS.iceServers;
  const signer = LiveSigner.generate();
  const signalingClient = new LiveNostrSignallingClient(signer, relayUrls);
  const peerConnectionFactory = () => new LivePeerConnection(new RTCPeerConnection({ iceServers }));
  const manager = new LiveConnectionManager(signalingClient, peerConnectionFactory);
  return manager;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LinkState,
  createLiveConnectionManager
});
