import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';

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
    this.pc = options.peerConnectionFactory(options.observer);
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
    this.pc = options.peerConnectionFactory(options.observer);
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
  constructor(signalingClient, peerConnectionFactory, handshakeTimeoutMs, observerFactory) {
    this.initiating = /* @__PURE__ */ new Map();
    this.connected = /* @__PURE__ */ new Map();
    this.timeoutCheckInterval = null;
    this.closed = false;
    this.myPubkeyHex = signalingClient.myPubkeyHex;
    this.signalingClient = signalingClient;
    this.peerConnectionFactory = peerConnectionFactory;
    this.handshakeTimeoutMs = handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.observerFactory = observerFactory;
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
        const description = JSON.parse(message.payload);
        if (!this.isSessionDescription(description)) {
          throw new Error("Unsupported signalling message");
        }
        if (description.type === "offer") {
          this.onInboundOffer(message.fromPubkeyHex, description);
        } else {
          this.onInboundAnswer(message.fromPubkeyHex, description);
        }
      } catch (err2) {
        console.error(`Failed to parse signalling message from ${message.fromPubkeyHex}:`, err2);
      }
    });
  }
  isSessionDescription(value) {
    if (typeof value !== "object" || value === null) return false;
    const description = value;
    return (description.type === "offer" || description.type === "answer") && typeof description.sdp === "string";
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
      handshakeTimeoutMs: this.handshakeTimeoutMs,
      observer: this.observerFactory?.(pubkeyHex, "initiator")
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
      const result = this.signalingClient.send(pubkeyHex, JSON.stringify(offer));
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
  onInboundOffer(fromPubkeyHex, offer) {
    if (this.closed) return;
    if (this.connected.has(fromPubkeyHex)) return;
    if (this.initiating.size > 0) return;
    const answerer = new LiveAnswerer({
      peerConnectionFactory: this.peerConnectionFactory,
      observer: this.observerFactory?.(fromPubkeyHex, "answerer")
    });
    answerer.state.subscribe((state) => {
      if (this.closed) return;
      if (this.initiating.has(fromPubkeyHex)) return;
      if (state === "Connected") {
        this.onLinkConnected(fromPubkeyHex, answerer.peerLink);
      }
    });
    this.acceptOfferInAnswerer(fromPubkeyHex, answerer, offer);
  }
  async acceptOfferInAnswerer(toPubkeyHex, answerer, offer) {
    try {
      const answer = await answerer.createAnswer(offer);
      if (this.closed) return;
      this.signalingClient.send(toPubkeyHex, JSON.stringify(answer));
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
      handshakeTimeoutMs: this.handshakeTimeoutMs,
      observer: this.observerFactory?.(pubkeyHex, "initiator")
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
   * Move from `initiating` to `connected`, broadcast `announce` to all other
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
      if (!this.isDataChannelFrame(frame)) {
        throw new Error("Unsupported data-channel frame");
      }
      if (frame.type === "app") {
        this.incomingMessages.emit({
          from: fromPubkeyHex,
          to: this.myPubkeyHex,
          timestamp: Date.now(),
          payload: Uint8Array.from(frame.payload, (value) => value & 255)
        });
      } else {
        this.onInboundAnnounce(fromPubkeyHex, frame.pubkeyHex);
      }
    } catch (err2) {
      console.error(`Failed to parse data channel frame from ${fromPubkeyHex}:`, err2);
    }
  }
  isDataChannelFrame(value) {
    if (typeof value !== "object" || value === null) return false;
    const frame = value;
    if (frame.type === "announce") {
      return typeof frame.pubkeyHex === "string";
    }
    if (frame.type === "app") {
      return Array.isArray(frame.payload) && frame.payload.every(
        (byte) => Number.isInteger(byte) && byte >= -128 && byte <= 255
      );
    }
    return false;
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
   * §2 rule 5: broadcast an announce for one newly-connected pubkey to every
   * *other* connected peer. This is not a roster sync — the recipient learns
   * about exactly one new peer, not the sender's full connected set — and the
   * newly-connected peer itself is excluded (it doesn't need telling about
   * its own connection). Best-effort, no retry, no acknowledgement.
   */
  broadcastAnnounce(newPubkeyHex) {
    const frame = {
      type: "announce",
      pubkeyHex: newPubkeyHex
    };
    const bytes = new TextEncoder().encode(JSON.stringify(frame));
    for (const [peerPubkey, peerLink] of this.connected.entries()) {
      if (peerPubkey === newPubkeyHex) continue;
      peerLink.send(bytes);
    }
  }
  /**
   * Inbound announce handling: learn a new peer via gossip (§2 rule 5).
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
      type: "app",
      payload: Array.from(payload, (value) => value > 127 ? value - 256 : value)
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
var SIGNALLING_KIND = 28080;

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
var LiveSigner = class _LiveSigner {
  constructor(secretKey, pubkeyHex) {
    this.secretKey = secretKey;
    this.pubkeyHex = pubkeyHex;
  }
  /** Generates a fresh random identity. No persistence, no restore path. */
  static generate() {
    const secretKey = generateSecretKey();
    return new _LiveSigner(secretKey, getPublicKey(secretKey));
  }
  /** Builds an identity from an existing 32-byte secret key. */
  static fromSecretKey(secretKey) {
    return new _LiveSigner(secretKey, getPublicKey(secretKey));
  }
  sign(kind, tags, content, createdAt = Math.floor(Date.now() / 1e3)) {
    const unsigned = {
      pubkey: this.pubkeyHex,
      created_at: createdAt,
      kind,
      tags,
      content
    };
    return finalizeEvent(unsigned, this.secretKey);
  }
  verify(event) {
    return verifyEvent(event);
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
  constructor(pc, observer) {
    this.pc = pc;
    this.onconnectionstatechange = null;
    this.ondatachannel = null;
    this.pc.onconnectionstatechange = () => this.onconnectionstatechange?.();
    this.pc.ondatachannel = (ev) => {
      this.ondatachannel?.({ channel: new LiveDataChannel(ev.channel) });
    };
    if (observer) {
      this.pc.addEventListener("iceconnectionstatechange", () => {
        observer.iceConnectionState?.(this.pc.iceConnectionState);
      });
      this.pc.addEventListener("icegatheringstatechange", () => {
        observer.iceGatheringState?.(this.pc.iceGatheringState);
      });
      this.pc.addEventListener("signalingstatechange", () => {
        observer.signalingState?.(this.pc.signalingState);
      });
      this.pc.addEventListener("icecandidate", (ev) => {
        observer.iceCandidate?.(ev.candidate ? ev.candidate.candidate : null);
      });
      this.pc.addEventListener("connectionstatechange", () => {
        observer.connectionState?.(this.pc.connectionState);
      });
    }
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
  const peerConnectionFactory = (observer) => new LivePeerConnection(new RTCPeerConnection({ iceServers }), observer);
  const manager = new LiveConnectionManager(
    signalingClient,
    peerConnectionFactory,
    options.handshakeTimeoutMs,
    options.observerFactory
  );
  return manager;
}

// src/coralie/browser-coralie-host.ts
var ResponseTooLargeError = class extends Error {
  constructor(limitBytes, observedBytes, declaredByServer) {
    super(
      `Response exceeds size limit: ${observedBytes} bytes observed, ${limitBytes} bytes allowed`
    );
    this.limitBytes = limitBytes;
    this.observedBytes = observedBytes;
    this.declaredByServer = declaredByServer;
    this.name = "ResponseTooLargeError";
  }
};
var PUBKEY_PATTERN = /^[0-9a-fA-F]{64}$/;
var MAX_TIMEOUT_MS = 2147483647;
var MAX_HTTP_RESPONSE_BYTES = 64 * 1024 * 1024;
var nextHttpRequestId = 1;
var BrowserCoralieHost = class {
  constructor(options = {}, managerFactory = createLiveConnectionManager, fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.managerUnsubscribers = [];
    this.currentPeers = [];
    this.memoryStorage = /* @__PURE__ */ new Map();
    this.timers = /* @__PURE__ */ new Map();
    this.meshClosed = false;
    this.options = options;
    this.managerFactory = managerFactory;
    this.fetchImpl = fetchImpl;
    this.manager = this.managerFactory(this.options);
    this.bindManager();
  }
  apiVersion() {
    return 2;
  }
  hostKind() {
    return "browser";
  }
  getPubkey() {
    this.assertMeshOpen();
    return this.manager.myPubkeyHex;
  }
  addPeer(pubkeyHex) {
    this.assertMeshOpen();
    this.assertPubkey(pubkeyHex, "pubkeyHex");
    this.manager.addPeer(pubkeyHex.toLowerCase());
  }
  sendMessage(toPubkeyHex, payload) {
    this.assertMeshOpen();
    this.assertPubkey(toPubkeyHex, "toPubkeyHex");
    const bytes = this.normaliseOutgoingPayload(payload);
    const normalizedPubkey = toPubkeyHex.toLowerCase();
    const connected = this.currentPeers.some(
      (peer) => peer.pubkeyHex === normalizedPubkey
    );
    if (!connected) {
      throw new Error(`Peer is not connected: ${normalizedPubkey}`);
    }
    this.manager.sendToPeer(normalizedPubkey, bytes);
  }
  getPeersJson() {
    this.assertMeshOpen();
    return JSON.stringify(this.clonePeers(this.currentPeers));
  }
  reset() {
    const nextManager = this.managerFactory(this.options);
    this.unbindManager();
    if (!this.meshClosed) this.manager.close();
    this.manager = nextManager;
    this.currentPeers = [];
    this.meshClosed = false;
    this.bindManager();
    return this.manager.myPubkeyHex;
  }
  /**
   * Matches Android's `close()`: closes only the mesh. Storage, HTTP and timers
   * remain usable until the page itself is unloaded.
   */
  close() {
    if (this.meshClosed) return;
    this.meshClosed = true;
    this.unbindManager();
    this.manager.close();
    this.currentPeers = [];
    this.dispatch("coralie:peers", []);
  }
  storageGetItem(key) {
    const normalizedKey = String(key);
    const storage = this.resolveLocalStorage();
    if (storage) {
      try {
        return storage.getItem(normalizedKey);
      } catch {
      }
    }
    return this.memoryStorage.get(normalizedKey) ?? null;
  }
  storageSetItem(key, value) {
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    const storage = this.resolveLocalStorage();
    if (storage) {
      try {
        storage.setItem(normalizedKey, normalizedValue);
        return;
      } catch {
      }
    }
    this.memoryStorage.set(normalizedKey, normalizedValue);
  }
  storageRemoveItem(key) {
    const normalizedKey = String(key);
    const storage = this.resolveLocalStorage();
    if (storage) {
      try {
        storage.removeItem(normalizedKey);
      } catch {
      }
    }
    this.memoryStorage.delete(normalizedKey);
  }
  /**
   * Browser transport matching Android's JSON request/response surface.
   *
   * Differences that are intrinsic to browsers:
   * - the method returns a Promise;
   * - CORS still applies;
   * - redirects use the browser's normal redirect handling.
   *
   * Non-permission failures are encoded as status 599, matching Android.
   */
  async httpRequestJson(requestJson) {
    const requestId = nextHttpRequestId++;
    const startedAt = this.nowMs();
    let stage = "parse-request";
    let method = "UNKNOWN";
    let safeUrl = "(unparsed)";
    try {
      const request = this.parseHttpRequest(requestJson);
      method = request.method;
      safeUrl = this.safeUrlForDiagnostic(request.url);
      stage = "browser-fetch";
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body ?? "",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "follow"
      });
      stage = "read-response";
      const body = await this.readResponseBodyLimited(response);
      const result = {
        status: response.status,
        statusText: response.statusText,
        headers: this.headersToRecord(response.headers),
        body
      };
      return JSON.stringify(result);
    } catch (error) {
      const elapsedMs = Math.max(0, this.nowMs() - startedAt);
      return JSON.stringify(
        this.httpFailureResponse(
          requestId,
          stage,
          method,
          safeUrl,
          elapsedMs,
          error
        )
      );
    }
  }
  timerQueue(id, delaySeconds, payload) {
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds <= 0) {
      throw new RangeError(
        "delaySeconds must be a positive integer"
      );
    }
    const timerId = id === null ? this.generateId() : String(id);
    const normalizedPayload = payload == null ? null : String(payload);
    this.timerCancel(timerId);
    const timer = {
      handle: null,
      deadlineMs: Date.now() + delaySeconds * 1e3,
      payload: normalizedPayload
    };
    this.timers.set(timerId, timer);
    this.scheduleTimer(timerId);
    return timerId;
  }
  timerCancel(id) {
    const normalizedId = String(id);
    const timer = this.timers.get(normalizedId);
    if (!timer) return;
    if (timer.handle !== null) {
      clearTimeout(timer.handle);
    }
    this.timers.delete(normalizedId);
  }
  timerListJson() {
    const now = Date.now();
    const result = [...this.timers.entries()].map(
      ([id, timer]) => ({
        id,
        remainingMs: Math.max(
          0,
          timer.deadlineMs - now
        )
      })
    );
    return JSON.stringify(result);
  }
  scheduleTimer(id) {
    const timer = this.timers.get(id);
    if (!timer) return;
    const remainingMs = timer.deadlineMs - Date.now();
    if (remainingMs <= 0) {
      this.fireTimer(id);
      return;
    }
    timer.handle = setTimeout(
      () => this.scheduleTimer(id),
      Math.min(remainingMs, MAX_TIMEOUT_MS)
    );
  }
  fireTimer(id) {
    const timer = this.timers.get(id);
    if (!timer) return;
    this.timers.delete(id);
    const detail = { id };
    if (timer.payload !== null) {
      detail.payload = timer.payload;
    }
    this.dispatch("coralie:timerFired", detail);
  }
  bindManager() {
    this.managerUnsubscribers = [
      this.manager.peers.subscribe((peers) => {
        this.currentPeers = this.normalisePeers(peers);
        this.dispatch(
          "coralie:peers",
          this.clonePeers(this.currentPeers)
        );
      }),
      this.manager.incomingMessages.subscribe((message) => {
        this.dispatch(
          "coralie:message",
          this.normaliseMessage(message)
        );
      }),
      this.manager.terminalFailures.subscribe((failure) => {
        this.dispatch(
          "coralie:terminalFailure",
          this.normaliseFailure(failure)
        );
      })
    ];
  }
  unbindManager() {
    for (const unsubscribe of this.managerUnsubscribers) {
      unsubscribe();
    }
    this.managerUnsubscribers = [];
  }
  normalisePeers(peers) {
    return [...peers].map((peer) => ({
      pubkeyHex: peer.pubkeyHex.toLowerCase(),
      connectedAt: peer.connectedAt ?? null
    }));
  }
  normaliseMessage(message) {
    return {
      fromPubkeyHex: String(message.from).toLowerCase(),
      toPubkeyHex: String(message.to).toLowerCase(),
      timestamp: Number(message.timestamp),
      payload: Array.from(
        this.normaliseIncomingPayload(message.payload)
      )
    };
  }
  normaliseFailure(failure) {
    return {
      pubkeyHex: failure.pubkeyHex.toLowerCase(),
      attemptCount: failure.attemptCount,
      reason: failure.reason
    };
  }
  normaliseOutgoingPayload(payload) {
    if (!(payload instanceof Uint8Array) && !Array.isArray(payload)) {
      throw new TypeError(
        "payload must be a Uint8Array or integer array"
      );
    }
    return Uint8Array.from(payload, (value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new RangeError(
          `payload[${index}] must be an integer between 0 and 255`
        );
      }
      return value;
    });
  }
  normaliseIncomingPayload(payload) {
    if (payload instanceof Uint8Array) {
      return new Uint8Array(payload);
    }
    if (payload instanceof ArrayBuffer) {
      return new Uint8Array(payload);
    }
    if (ArrayBuffer.isView(payload)) {
      return new Uint8Array(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      );
    }
    if (Array.isArray(payload)) {
      return this.normaliseOutgoingPayload(payload);
    }
    throw new TypeError(
      "Incoming payload is not byte-compatible"
    );
  }
  dispatch(eventName, detail) {
    window.dispatchEvent(
      new CustomEvent(eventName, { detail })
    );
  }
  clonePeers(peers) {
    return peers.map((peer) => ({ ...peer }));
  }
  resolveLocalStorage() {
    try {
      return window.localStorage || null;
    } catch {
      return null;
    }
  }
  parseHttpRequest(requestJson) {
    let parsed;
    try {
      parsed = JSON.parse(requestJson);
    } catch (error) {
      throw new TypeError(
        `Invalid HTTP request JSON: ${String(error)}`
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(
        "HTTP request must be an object"
      );
    }
    const request = parsed;
    if (typeof request.url !== "string" || request.url.trim() === "") {
      throw new TypeError(
        "HTTP request url must be a non-empty string"
      );
    }
    let url;
    try {
      url = new URL(request.url.trim());
    } catch {
      throw new TypeError(
        "HTTP request url must be an absolute URL"
      );
    }
    if (url.protocol !== "https:") {
      throw new TypeError(
        "Only https requests are allowed"
      );
    }
    const headers = {};
    if (request.headers !== void 0) {
      if (typeof request.headers !== "object" || request.headers === null || Array.isArray(request.headers)) {
        throw new TypeError(
          "HTTP request headers must be an object"
        );
      }
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value !== "string") {
          throw new TypeError(
            `HTTP header ${name} must be a string`
          );
        }
        headers[name] = value;
      }
    }
    const body = request.body == null ? null : request.body;
    if (body !== null && typeof body !== "string") {
      throw new TypeError(
        "HTTP request body must be a string or null"
      );
    }
    const method = (request.method || "GET").trim().toUpperCase();
    if (method === "") {
      throw new TypeError(
        "HTTP request method must be non-empty"
      );
    }
    return {
      url: url.href,
      method,
      headers,
      body
    };
  }
  headersToRecord(headers) {
    const result = {};
    headers.forEach((value, name) => {
      result[name] = value;
    });
    return result;
  }
  async readResponseBodyLimited(response) {
    const declaredHeader = response.headers.get("content-length");
    const declaredLength = declaredHeader == null ? -1 : Number(declaredHeader);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_RESPONSE_BYTES) {
      throw new ResponseTooLargeError(
        MAX_HTTP_RESPONSE_BYTES,
        declaredLength,
        true
      );
    }
    const charset = this.resolveResponseCharset(response);
    const decoder = new TextDecoder(charset);
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_HTTP_RESPONSE_BYTES) {
        throw new ResponseTooLargeError(
          MAX_HTTP_RESPONSE_BYTES,
          bytes.byteLength,
          false
        );
      }
      return decoder.decode(bytes);
    }
    const reader = response.body.getReader();
    let observedBytes = 0;
    let result = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        observedBytes += value.byteLength;
        if (observedBytes > MAX_HTTP_RESPONSE_BYTES) {
          await reader.cancel(
            "Response exceeds size limit"
          );
          throw new ResponseTooLargeError(
            MAX_HTTP_RESPONSE_BYTES,
            observedBytes,
            false
          );
        }
        result += decoder.decode(
          value,
          { stream: true }
        );
      }
      result += decoder.decode();
      return result;
    } finally {
      reader.releaseLock();
    }
  }
  resolveResponseCharset(response) {
    const contentType = response.headers.get("content-type") || "";
    const match = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
    return match?.[1] || "utf-8";
  }
  httpFailureResponse(requestId, stage, method, safeUrl, elapsedMs, error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const category = this.classifyHttpFailure(normalized);
    const diagnostic = {
      requestId,
      stage,
      category,
      method,
      url: safeUrl,
      elapsedMs,
      message: normalized.message || normalized.name,
      exception: normalized.name,
      rootException: normalized.name,
      causeChain: `${normalized.name}: ${normalized.message}`
    };
    if (normalized instanceof ResponseTooLargeError) {
      diagnostic.limitBytes = normalized.limitBytes;
      diagnostic.observedBytes = normalized.observedBytes;
      diagnostic.declaredByServer = normalized.declaredByServer;
    }
    return {
      status: 599,
      statusText: category === "response-too-large" ? "Browser response too large" : "Browser HTTP failure",
      headers: {},
      body: JSON.stringify(diagnostic)
    };
  }
  classifyHttpFailure(error) {
    if (error instanceof ResponseTooLargeError) {
      return "response-too-large";
    }
    if (error.name === "AbortError") {
      return "cancelled";
    }
    if (error instanceof TypeError && /request|url|header|https|body|json/i.test(error.message)) {
      return "invalid-request";
    }
    if (error instanceof TypeError) {
      return "network-io";
    }
    return "internal";
  }
  safeUrlForDiagnostic(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return `${url.protocol}//${url.host}${url.pathname || "/"}`;
    } catch {
      return "(unparsed)";
    }
  }
  generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `timer-${Date.now()}-` + Math.random().toString(16).slice(2);
  }
  assertPubkey(value, fieldName) {
    if (!PUBKEY_PATTERN.test(value)) {
      throw new TypeError(
        `${fieldName} must be a 64-character hexadecimal public key`
      );
    }
  }
  assertMeshOpen() {
    if (this.meshClosed) {
      throw new Error(
        "Coralie mesh is closed"
      );
    }
  }
  nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }
};

// src/coralie/install-coralie.ts
function installBrowserCoralie(options = {}) {
  if (typeof window === "undefined") {
    return void 0;
  }
  const target = window;
  if (target.Coralie !== void 0) {
    return target.Coralie;
  }
  const host = new BrowserCoralieHost(options);
  Object.defineProperty(target, "Coralie", {
    value: host,
    writable: false,
    configurable: false,
    enumerable: true
  });
  return host;
}

// src/index.ts
if (typeof window !== "undefined") {
  installBrowserCoralie();
}

export { BrowserCoralieHost, LinkState, MAX_HTTP_RESPONSE_BYTES, createLiveConnectionManager, installBrowserCoralie };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map