import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_URL = 'file://' + path.resolve(__dirname, '../examples/demo.html')

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL)
})

test('generates a valid 64-hex-char identity', async ({ page }) => {
  await page.click('#btn-generate-identity')
  const pubkey = await page.locator('#my-pubkey').textContent()
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/)
})

test('NIP-44 playground round-trips a message through real encryption', async ({ page }) => {
  await page.click('#btn-nip44-run')
  const log = page.locator('#nip44-log .line')
  await expect(log).toHaveCount(5)

  const lines = await log.allTextContents()
  expect(lines.some((l) => l.startsWith('convo keys match: yes'))).toBe(true)
  expect(lines.some((l) => l.startsWith('decrypted:') && l.includes('the mesh gathers at midnight'))).toBe(true)
})

test('relay connectivity panel renders all four default relays', async ({ page }) => {
  await page.click('#btn-connect-relays')
  await expect(page.locator('#relay-list .relay-row')).toHaveCount(4)

  const urls = await page.locator('#relay-list .relay-row .url').allTextContents()
  expect(urls).toEqual([
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://nostr.oxtr.dev',
    'wss://purplerelay.com',
  ])
})

test('rejects connecting to a peer with a malformed pubkey', async ({ page }) => {
  await page.click('#btn-generate-identity')
  await page.click('#btn-connect-peer')
  await expect(page.locator('#peer-log')).toContainText('64 hex chars')
})

test('page loads with no console or page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.click('#btn-generate-identity')
  await page.click('#btn-nip44-run')
  await page.click('#btn-connect-relays')

  expect(errors).toEqual([])
})

test('a real RTCPeerConnection handshake reaches Connected and exchanges a message', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { LiveInitiator, LiveAnswerer, createLivePeerConnectionFactory } = (window as any).CoralieInternal

    const factory = createLivePeerConnectionFactory({ iceServers: [] })

    const initiator = new LiveInitiator({ peerConnectionFactory: factory, handshakeTimeoutMs: 15000 })
    const answerer = new LiveAnswerer({ peerConnectionFactory: factory })

    const offer = await initiator.createOffer()
    const answer = await answerer.createAnswer(offer)
    await initiator.acceptAnswer(answer)

    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (initiator.state.value === 'Connected' && answerer.state.value === 'Connected') break
      await new Promise((r) => setTimeout(r, 100))
    }

    if (initiator.state.value !== 'Connected' || answerer.state.value !== 'Connected') {
      return { connected: false, initiatorState: initiator.state.value, answererState: answerer.state.value }
    }

    const received: string[] = []
    answerer.peerLink.incomingBytes.subscribe((bytes: Uint8Array) => {
      received.push(new TextDecoder().decode(bytes))
    })
    initiator.peerLink.send(new TextEncoder().encode('hello over real webrtc'))
    await new Promise((r) => setTimeout(r, 300))

    return { connected: true, received }
  })

  expect(result.connected).toBe(true)
  expect(result.received).toEqual(['hello over real webrtc'])
})

// ========== PHASE 6 E2E INTEGRATION TESTS ==========
// These tests use the test harness in demo.html and real WebRTC connections
// to validate the six core mesh rules as emergent behavior across multiple managers.

test.describe('Phase 6 - End-to-end integration', () => {
  test.afterEach(async ({ page }) => {
    // Clean up test managers after each test
    await page.evaluate(() => (window as any).cleanupAllTestManagers())
  })

  test('Scenario 1: Two-peer happy path', async ({ page }) => {
    await page.goto(DEMO_URL)

    const result = await page.evaluate(async () => {
      const { createE2ETestManager, waitForPeerConnection, getConnectedPeers } = (window as any)

      // Create two managers with distinct pubkeys
      const alice = createE2ETestManager('alice-' + 'a'.repeat(59), 15000)
      const bob = createE2ETestManager('bob-' + 'b'.repeat(61), 15000)

      // Track messages received
      const messagesAtBob: string[] = []
      bob.incomingMessages.subscribe((msg: any) => {
        messagesAtBob.push(new TextDecoder().decode(msg.payload))
      })

      // Alice initiates connection to Bob
      alice.addPeer(bob.myPubkeyHex)

      // Wait for both sides to connect
      const aliceConnected = await waitForPeerConnection(alice, bob.myPubkeyHex)
      const bobConnected = await waitForPeerConnection(bob, alice.myPubkeyHex)

      if (!aliceConnected || !bobConnected) {
        return { ok: false, reason: 'connection failed', aliceConnected, bobConnected }
      }

      // Verify peers converged
      const alicePeers = getConnectedPeers(alice)
      const bobPeers = getConnectedPeers(bob)

      if (!alicePeers.includes(bob.myPubkeyHex)) {
        return { ok: false, reason: 'alice missing bob', alicePeers, bobPeers }
      }
      if (!bobPeers.includes(alice.myPubkeyHex)) {
        return { ok: false, reason: 'bob missing alice', alicePeers, bobPeers }
      }

      // Send a message from Alice to Bob
      alice.sendToPeer(
        bob.myPubkeyHex,
        new TextEncoder().encode('hello from alice'),
      )
      await new Promise((r) => setTimeout(r, 100))

      // Verify message received
      if (!messagesAtBob.includes('hello from alice')) {
        return { ok: false, reason: 'message not received', messagesAtBob }
      }

      alice.close()
      bob.close()

      return { ok: true, alicePeers, bobPeers, messagesAtBob }
    })

    expect(result.ok).toBe(true)
  })

  test('Scenario 2: Three-peer gossip (Announce propagation)', async ({ page }) => {
    // A third real RTCPeerConnection gets established here (A→B or B→A,
    // whichever direction gossip triggers), so give it headroom and capture
    // console/page errors for diagnostics if it fails.
    test.setTimeout(45000)

    const consoleMessages: string[] = []
    const pageErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', (err) => {
      pageErrors.push(err.message)
    })

    await page.goto(DEMO_URL)

    const result = await page.evaluate(async () => {
      const { createE2ETestManager, waitForPeerConnection, getConnectedPeers } = (window as any)

      // Create three managers
      const a = createE2ETestManager('peer-a-' + 'a'.repeat(57), 15000)
      const b = createE2ETestManager('peer-b-' + 'b'.repeat(57), 15000)
      const c = createE2ETestManager('peer-c-' + 'c'.repeat(57), 15000)

      // A and B both connect to C out-of-band, "at the same time". C can only
      // process one inbound offer at a time, so this serializes into one pair
      // connecting first and the second connecting shortly after — there's no
      // way to make them truly simultaneous, and that's fine, since the point
      // is gossip convergence, not testing simultaneity itself.
      a.addPeer(c.myPubkeyHex)
      b.addPeer(c.myPubkeyHex)

      const aToC = await waitForPeerConnection(a, c.myPubkeyHex, 10000)
      const bToC = await waitForPeerConnection(b, c.myPubkeyHex, 10000)

      if (!aToC || !bToC) {
        a.close()
        b.close()
        c.close()
        return { ok: false, reason: 'A-C or B-C connection failed', aToC, bToC }
      }

      // Whichever of A/B connected to C *first* is told about the other via
      // Announce once C's second connection opens (rule 5: broadcast the new
      // pubkey to every *other* connected peer — the newcomer itself is
      // excluded, so only the earlier-connected side ever learns anything
      // here; that's the whole point — no roster sync, no simultaneous
      // mutual-discovery). So we just need A and B to end up connected to
      // each other, however that arrives.
      const aHasB = await waitForPeerConnection(a, b.myPubkeyHex, 20000)
      const bHasA = await waitForPeerConnection(b, a.myPubkeyHex, 20000)

      const aPeers = getConnectedPeers(a)
      const bPeers = getConnectedPeers(b)
      const cPeers = getConnectedPeers(c)

      a.close()
      b.close()
      c.close()

      return {
        ok: aHasB && bHasA,
        reason: aHasB && bHasA ? 'gossip succeeded' : 'gossip failed',
        aPeers,
        bPeers,
        cPeers,
      }
    })

    if (!result.ok) {
      console.log('Scenario 2 diagnostics:', JSON.stringify(result, null, 2))
      console.log('Browser console (errors/warnings):', consoleMessages)
      console.log('Page errors:', pageErrors)
    }

    expect(result.ok).toBe(true)
  })

  test('Scenario 3: Peer departure (no roster sync)', async ({ page }) => {
    await page.goto(DEMO_URL)

    const result = await page.evaluate(async () => {
      const { createE2ETestManager, waitForPeerConnection, getConnectedPeers } = (window as any)

      // Create three managers
      const a = createE2ETestManager('dep-a-' + 'a'.repeat(57), 15000)
      const b = createE2ETestManager('dep-b-' + 'b'.repeat(57), 15000)
      const c = createE2ETestManager('dep-c-' + 'c'.repeat(57), 15000)

      // Connect: A↔B, B↔C
      a.addPeer(b.myPubkeyHex)
      await waitForPeerConnection(a, b.myPubkeyHex)
      await waitForPeerConnection(b, a.myPubkeyHex)

      b.addPeer(c.myPubkeyHex)
      await waitForPeerConnection(b, c.myPubkeyHex)
      await waitForPeerConnection(c, b.myPubkeyHex)

      // Get initial peer lists
      const bInitialPeers = getConnectedPeers(b)
      const cInitialPeers = getConnectedPeers(c)

      // Close A's connection to B
      a.close()

      // Poll until B's peers set no longer contains A (real WebRTC teardown
      // is asynchronous — connectionstatechange isn't guaranteed to fire
      // within any fixed sleep window, so don't race a fixed sleep against it).
      const departureDeadline = Date.now() + 8000
      let bLostA = false
      while (Date.now() < departureDeadline) {
        if (!getConnectedPeers(b).includes(a.myPubkeyHex)) {
          bLostA = true
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      // C should still have B (no roster sync means C doesn't get notified)
      const cFinalPeers = getConnectedPeers(c)
      const cStillHasB = cFinalPeers.includes(b.myPubkeyHex)

      b.close()
      c.close()

      return {
        ok: bLostA && cStillHasB,
        bLostA,
        cStillHasB,
        reason: bLostA && cStillHasB ? 'no roster sync works' : 'unexpected state',
      }
    })

    expect(result.ok).toBe(true)
  })

  test('Scenario 4: Retry exhaustion against unreachable peer', async ({ page }) => {
    await page.goto(DEMO_URL)

    const result = await page.evaluate(async () => {
      const { createE2ETestManager, waitForTerminalFailure } = (window as any)

      // Use very short timeout to make test fast (500ms per attempt)
      const alice = createE2ETestManager('retry-alice', 500)

      const unreachablePubkey = 'unreachable-' + 'x'.repeat(52)

      // Target a pubkey that will never respond
      alice.addPeer(unreachablePubkey)

      // Wait for terminal failure (5 retries × 500ms + overhead)
      const failure = await waitForTerminalFailure(alice, 10000)

      alice.close()

      if (!failure) {
        return { ok: false, reason: 'no terminal failure emitted' }
      }

      return {
        ok: failure.attemptCount === 5,
        attemptCount: failure.attemptCount,
        pubkeyHex: failure.pubkeyHex,
        reason: failure.attemptCount === 5 ? 'exhaustion correct' : 'wrong attempt count',
      }
    })

    expect(result.ok).toBe(true)
    expect(result.attemptCount).toBe(5)
  })

  test('Scenario 5: End-to-end manager composition (factory)', async ({ page }) => {
    await page.goto(DEMO_URL)

    const result = await page.evaluate(async () => {
      const { createE2ETestManager, waitForPeerConnection, getConnectedPeers } = (window as any)

      // This test validates that createLiveConnectionManager (the factory)
      // correctly wires together all internal layers: crypto, signalling, WebRTC, orchestration.
      // We use the factory indirectly (via createE2ETestManager which calls it).

      const mgr1 = createE2ETestManager('factory-m1', 15000)
      const mgr2 = createE2ETestManager('factory-m2', 15000)

      mgr1.addPeer(mgr2.myPubkeyHex)

      const m1Connected = await waitForPeerConnection(mgr1, mgr2.myPubkeyHex)
      const m2Connected = await waitForPeerConnection(mgr2, mgr1.myPubkeyHex)

      const m1Peers = getConnectedPeers(mgr1)
      const m2Peers = getConnectedPeers(mgr2)

      mgr1.close()
      mgr2.close()

      return {
        ok: m1Connected && m2Connected,
        m1Connected,
        m2Connected,
        m1HasM2: m1Peers.includes(mgr2.myPubkeyHex),
        m2HasM1: m2Peers.includes(mgr1.myPubkeyHex),
      }
    })

    expect(result.ok).toBe(true)
  })
})

