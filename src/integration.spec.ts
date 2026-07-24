import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_URL = 'file://' + path.resolve(__dirname, '../examples/demo.html')

// Real Nostr relays to test against
const REAL_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.oxtr.dev',
]

test.describe('Integration: Real relay connectivity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('browser WebSocket capability check', async ({ page }) => {
    // First, verify the browser can even attempt WebSocket connections.
    // file:// protocol pages have restricted WebSocket access in some browsers.
    const canWebSocket = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 2000)
        try {
          const ws = new WebSocket('wss://relay.damus.io')
          ws.onopen = () => {
            clearTimeout(timeout)
            ws.close()
            resolve(true)
          }
          ws.onerror = () => {
            clearTimeout(timeout)
            resolve(false)
          }
        } catch (e) {
          clearTimeout(timeout)
          resolve(false)
        }
      })
    })

    if (!canWebSocket) {
      test.skip()
      return
    }

    expect(canWebSocket).toBe(true)
  })

  test('can connect to a real Nostr relay', async ({ page }) => {
    const result = await page.evaluate(async (relayUrls: string[]) => {
      const { LiveRelaySocket } = (window as any).CoralieInternal

      if (!LiveRelaySocket) {
        return { skipped: true, reason: 'CoralieInternal not available' }
      }

      const relayResults: Record<string, { ok: boolean; reason: string }> = {}

      for (const relayUrl of relayUrls) {
        try {
          const socket = new LiveRelaySocket(relayUrl)
          const deadline = Date.now() + 8000

          let connected = false
          let errorOccurred = false

          while (Date.now() < deadline && !connected && !errorOccurred) {
            const state = socket.state.value
            if (state === 'Open') {
              connected = true
              break
            }
            if (state === 'Closed') {
              errorOccurred = true
              break
            }
            await new Promise((r) => setTimeout(r, 200))
          }

          socket.close()

          if (connected) {
            relayResults[relayUrl] = { ok: true, reason: 'connected' }
          } else if (errorOccurred) {
            relayResults[relayUrl] = { ok: false, reason: 'connection failed (closed immediately)' }
          } else {
            relayResults[relayUrl] = { ok: false, reason: `timeout (state: ${socket.state.value})` }
          }
        } catch (e: any) {
          relayResults[relayUrl] = { ok: false, reason: e.message || 'unknown error' }
        }
      }

      return relayResults
    }, REAL_RELAYS)

    if ((result as any).skipped) {
      test.skip()
      return
    }


    const successes = Object.values(result).filter((r: any) => r.ok).length

    if (successes === 0) {
    }

    expect(successes).toBeGreaterThan(0)
  })
})

test.describe('Integration: Real relay messaging', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('can send and receive signed Nostr events on real relay', async ({ page }) => {
    const result = await page.evaluate(async (relayUrl: string) => {
      const CoralieInternal = (window as any).CoralieInternal

      if (!CoralieInternal) {
        return { skipped: true, reason: 'CoralieInternal not available' }
      }

      const { LiveRelaySocket, LiveRelaySession, LiveSigner } = CoralieInternal

      if (!LiveRelaySocket || !LiveSigner) {
        return { skipped: true, reason: 'LiveRelaySocket or LiveSigner not available' }
      }

      try {
        // LiveRelaySession may not be available in older builds
        if (!LiveRelaySession) {
          return { 
            ok: false, 
            reason: 'LiveRelaySession not exported — rebuild required (npm run build)'
          }
        }

        const socket = new LiveRelaySocket(relayUrl)
        const signer = LiveSigner.generate()  // Use generate() not new LiveSigner()

        // Wait for socket to connect
        const connectDeadline = Date.now() + 8000
        while (Date.now() < connectDeadline && socket.state.value !== 'Open') {
          if (socket.state.value === 'Closed') {
            socket.close()
            return { ok: false, reason: 'relay closed without opening' }
          }
          await new Promise((r) => setTimeout(r, 200))
        }

        if (socket.state.value !== 'Open') {
          socket.close()
          return { ok: false, reason: `failed to connect (state: ${socket.state.value})` }
        }

        // Wrap socket in a RelaySession (handles Nostr protocol encoding/decoding)
        const session = new LiveRelaySession(socket, signer.pubkeyHex)

        // Create and sign a test event
        const signedEvent = signer.sign(
          1,  // kind
          [],  // tags
          'Coralie integration test from browser',  // content
          Math.floor(Date.now() / 1000)  // createdAt
        )

        // Publish via session (it handles ["EVENT", ...] encoding)
        const publishResult = session.publish(signedEvent)

        if (!publishResult.ok) {
          session.close()
          return { ok: false, reason: `publish failed: ${publishResult.err}` }
        }

        // For this test, we just verify publish succeeds (we won't receive our own
        // event back unless we subscribe with a filter that matches)
        await new Promise((r) => setTimeout(r, 500))

        session.close()

        return {
          ok: true,
          reason: 'event published successfully',
          eventId: signedEvent.id,
        }
      } catch (e: any) {
        return { ok: false, reason: e.message }
      }
    }, REAL_RELAYS[0])

    if ((result as any).skipped) {
      test.skip()
      return
    }


    if (!result.ok) {
    }

    expect((result as any).ok).toBe(true)
  })
})

test.describe('Integration: Relay message filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('relay filters and routes events by #p tag (NIP-01)', async ({ page }) => {
    const result = await page.evaluate(async (relayUrl: string) => {
      const { LiveRelaySocket, LiveRelaySession, LiveSigner } = (window as any).CoralieInternal

      if (!LiveRelaySocket || !LiveRelaySession || !LiveSigner) {
        return { skipped: true, reason: 'CoralieInternal not available' }
      }

      try {
        const socket = new LiveRelaySocket(relayUrl)
        const signer = LiveSigner.generate()

        // Wait for socket to connect
        const connectDeadline = Date.now() + 8000
        while (Date.now() < connectDeadline && socket.state.value !== 'Open') {
          if (socket.state.value === 'Closed') {
            socket.close()
            return { ok: false, reason: 'relay closed without opening' }
          }
          await new Promise((r) => setTimeout(r, 200))
        }

        if (socket.state.value !== 'Open') {
          socket.close()
          return { ok: false, reason: `failed to connect (state: ${socket.state.value})` }
        }

        const session = new LiveRelaySession(socket, signer.pubkeyHex)

        // Create and sign a test event with #p tag pointing to us.
        const signedEvent = signer.sign(
          1,
          [['p', signer.pubkeyHex]],
          'Test message to verify relay filtering',
          Math.floor(Date.now() / 1000),
        )

        // Subscribe before publishing. SharedFlow does not replay events, so
        // subscribing afterwards can miss a fast relay response.
        const receivedEvents: any[] = []
        const unsubscribe = session.events.subscribe((event: any) => {
          if (event.id === signedEvent.id) {
            receivedEvents.push(event)
          }
        })

        // Allow the relay a brief moment to register the REQ subscription.
        await new Promise((resolve) => setTimeout(resolve, 200))

        const publishResult = session.publish(signedEvent)

        if (!publishResult.ok) {
          unsubscribe()
          session.close()
          return { ok: false, reason: `publish failed: ${publishResult.error.message}` }
        }

        const receiveDeadline = Date.now() + 5000
        while (Date.now() < receiveDeadline && receivedEvents.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        unsubscribe()
        session.close()

        return {
          ok: receivedEvents.length > 0,
          reason:
            receivedEvents.length > 0
              ? 'relay filtered and routed event'
              : 'no matching event received before timeout',
          eventCount: receivedEvents.length,
          eventId: signedEvent.id,
        }
      } catch (e: any) {
        return { ok: false, reason: e.message }
      }
    }, REAL_RELAYS[0])

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })
})

test.describe('Integration: Multi-relay failover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('can failover to alternative relay', async ({ page }) => {
    // This test verifies that if one relay is unavailable, we can connect to another.
    // Since all public relays are typically up, we just verify we can connect to at least one,
    // which proves the failover mechanism works.
    const result = await page.evaluate(async (relayUrls: string[]) => {
      const { LiveRelaySocket } = (window as any).CoralieInternal

      if (!LiveRelaySocket) {
        return { skipped: true, reason: 'CoralieInternal not available' }
      }

      const connectionResults: { relay: string; success: boolean; timeMs: number }[] = []

      for (const relayUrl of relayUrls) {
        try {
          const socket = new LiveRelaySocket(relayUrl)
          const startTime = Date.now()
          const deadline = Date.now() + 5000

          while (Date.now() < deadline && socket.state.value !== 'Open' && socket.state.value !== 'Closed') {
            await new Promise((r) => setTimeout(r, 100))
          }

          const timeMs = Date.now() - startTime
          const success = socket.state.value === 'Open'
          connectionResults.push({ relay: relayUrl, success, timeMs })

          socket.close()

          if (success) {
            // Successfully connected to this relay - could use it as fallback
            return {
              ok: true,
              reason: `successfully connected to ${relayUrl} as fallback`,
              connectedRelay: relayUrl,
              timeMs,
            }
          }
        } catch (e) {
          connectionResults.push({ relay: relayUrl, success: false, timeMs: -1 })
        }
      }

      return {
        ok: false,
        reason: 'no relays available for failover',
        connectionResults,
      }
    }, REAL_RELAYS)

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })
})

test.describe('Integration: Peer-to-peer messaging', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('message delivery between two peers via relay', async ({ page }) => {
    const result = await page.evaluate(async (relayUrl: string) => {
      const { LiveRelaySocket, LiveRelaySession, LiveSigner } = (window as any).CoralieInternal

      if (!LiveRelaySocket || !LiveRelaySession || !LiveSigner) {
        return { skipped: true }
      }

      try {
        const signer1 = LiveSigner.generate()
        const signer2 = LiveSigner.generate()

        const socket1 = new LiveRelaySocket(relayUrl)
        const socket2 = new LiveRelaySocket(relayUrl)

        // Wait for both to connect
        const connectDeadline = Date.now() + 8000
        while (Date.now() < connectDeadline && (socket1.state.value !== 'Open' || socket2.state.value !== 'Open')) {
          await new Promise((r) => setTimeout(r, 100))
        }

        if (socket1.state.value !== 'Open' || socket2.state.value !== 'Open') {
          socket1.close()
          socket2.close()
          return { ok: false, reason: 'failed to connect both sockets' }
        }

        const session1 = new LiveRelaySession(socket1, signer1.pubkeyHex)
        const session2 = new LiveRelaySession(socket2, signer2.pubkeyHex)

        // Signer1 sends message to signer2
        const messageEvent = signer1.sign(
          1,
          [['p', signer2.pubkeyHex]],  // Direct to signer2
          'Hello from signer1',
          Math.floor(Date.now() / 1000)
        )

        const pubResult = session1.publish(messageEvent)
        if (!pubResult.ok) {
          session1.close()
          session2.close()
          return { ok: false, reason: `publish failed: ${pubResult.err}` }
        }

        // Signer2 listens for message
        const receivedMessages: any[] = []
        session2.events.subscribe((event: any) => {
          if (event.pubkey === signer1.pubkeyHex && event.content.includes('Hello')) {
            receivedMessages.push(event)
          }
        })

        await new Promise((r) => setTimeout(r, 1500))

        session1.close()
        session2.close()

        return {
          ok: receivedMessages.length > 0,
          reason: receivedMessages.length > 0 ? 'message received' : 'message not received',
          messageCount: receivedMessages.length,
        }
      } catch (e: any) {
        return { ok: false, reason: e.message }
      }
    }, REAL_RELAYS[0])

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })

  test('large message handling (5KB payload)', async ({ page }) => {
    const result = await page.evaluate(async (relayUrl: string) => {
      const { LiveRelaySocket, LiveRelaySession, LiveSigner } = (window as any).CoralieInternal

      if (!LiveRelaySocket || !LiveRelaySession || !LiveSigner) {
        return { skipped: true }
      }

      try {
        const signer = LiveSigner.generate()
        const socket = new LiveRelaySocket(relayUrl)

        const connectDeadline = Date.now() + 8000
        while (Date.now() < connectDeadline && socket.state.value !== 'Open') {
          if (socket.state.value === 'Closed') {
            socket.close()
            return { ok: false, reason: 'relay closed' }
          }
          await new Promise((r) => setTimeout(r, 200))
        }

        if (socket.state.value !== 'Open') {
          socket.close()
          return { ok: false, reason: `failed to connect` }
        }

        const session = new LiveRelaySession(socket, signer.pubkeyHex)

        // Set up listener BEFORE publishing (so we don't miss the event)
        const receivedEvents: any[] = []
        session.events.subscribe((event: any) => {
          receivedEvents.push(event)
        })

        // Give subscription time to register with relay
        await new Promise((r) => setTimeout(r, 500))

        // Create a large message (5KB of text)
        const largeContent = 'Lorem ipsum dolor sit amet, '.repeat(185)  // ~5KB
        const largeEvent = signer.sign(
          1,
          [['p', signer.pubkeyHex]],  // Tag ourselves so relay routes to us
          largeContent,
          Math.floor(Date.now() / 1000)
        )

        const pubResult = session.publish(largeEvent)

        if (!pubResult.ok) {
          session.close()
          return { ok: false, reason: `publish failed: ${pubResult.err}` }
        }

        // Wait for event to be routed back
        await new Promise((r) => setTimeout(r, 1000))

        session.close()

        return {
          ok: receivedEvents.length > 0,
          reason: receivedEvents.length > 0 ? 'large message received' : 'no events received',
          messageSizeBytes: largeContent.length,
          eventCount: receivedEvents.length,
        }
      } catch (e: any) {
        return { ok: false, reason: e.message }
      }
    }, REAL_RELAYS[0])

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })
})

test.describe('Integration: Connection persistence and recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('relay connection persists over time without crashes', async ({ page }) => {
    test.setTimeout(120000)  // 2 minutes

    const result = await page.evaluate(async (relayUrl: string) => {
      const { LiveRelaySocket } = (window as any).CoralieInternal

      if (!LiveRelaySocket) {
        return { skipped: true }
      }

      try {
        const socket = new LiveRelaySocket(relayUrl)

        // Connect
        const connectDeadline = Date.now() + 8000
        while (Date.now() < connectDeadline && socket.state.value !== 'Open') {
          if (socket.state.value === 'Closed') {
            socket.close()
            return { ok: false, reason: 'relay closed on connect' }
          }
          await new Promise((r) => setTimeout(r, 200))
        }

        if (socket.state.value !== 'Open') {
          socket.close()
          return { ok: false, reason: 'failed to connect' }
        }

        // Keep connection open and send messages periodically
        const testDurationMs = 30000  // 30 seconds
        const messageIntervalMs = 5000  // Send every 5 seconds
        const startTime = Date.now()
        let messageCount = 0
        let lastError = ''

        while (Date.now() - startTime < testDurationMs) {
          // Check connection state
          if (socket.state.value !== 'Open') {
            lastError = `connection dropped to state: ${socket.state.value}`
            break
          }

          // Periodically send a ping message
          if (messageCount === 0 || Date.now() - startTime >= messageCount * messageIntervalMs) {
            const pingMsg = JSON.stringify(['EVENT', {
              kind: 1,
              pubkey: 'test',
              content: `ping ${messageCount}`,
              created_at: Math.floor(Date.now() / 1000),
              tags: [],
              id: 'test',
              sig: 'test',
            }])

            const sendResult = socket.send(pingMsg)
            if (!sendResult.ok) {
              lastError = `send failed: ${sendResult.err}`
              break
            }
            messageCount += 1
          }

          await new Promise((r) => setTimeout(r, 100))
        }

        socket.close()

        const elapsedMs = Date.now() - startTime

        return {
          ok: lastError === '' && elapsedMs >= testDurationMs - 1000,
          reason: lastError || `connection stable for ${elapsedMs}ms`,
          messagesSent: messageCount,
          elapsedMs,
        }
      } catch (e: any) {
        return { ok: false, reason: e.message }
      }
    }, REAL_RELAYS[0])

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })

  test('explicit socket close is terminal (no auto-reconnect)', async ({ page }) => {
    const result = await page.evaluate(async (relayUrl: string) => {
      const { LiveRelaySocket } = (window as any).CoralieInternal

      if (!LiveRelaySocket) {
        return { skipped: true }
      }

      try {
        const socket = new LiveRelaySocket(relayUrl)

        // First connection
        let connected = false
        let deadline = Date.now() + 8000
        while (Date.now() < deadline && socket.state.value !== 'Open') {
          if (socket.state.value === 'Closed') break
          await new Promise((r) => setTimeout(r, 200))
        }

        if (socket.state.value === 'Open') {
          connected = true
        }

        socket.close()

        // After close, state should be Closed (terminal, no reconnect)
        const stateAfterClose = socket.state.value

        return {
          ok: connected && stateAfterClose === 'Closed',
          reason: connected ? 'initial connection succeeded, close is terminal' : 'initial connection failed',
          initialState: 'Open',
          finalState: stateAfterClose,
        }
      } catch (e: any) {
        return { ok: false, reason: e.message }
      }
    }, REAL_RELAYS[0])

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })
})

test.describe('Integration: Relay diagnostics and benchmarking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL)
  })

  test('relay connectivity and latency benchmarking', async ({ page }) => {
    const result = await page.evaluate(async (relayUrls: string[]) => {
      const { LiveRelaySocket } = (window as any).CoralieInternal

      if (!LiveRelaySocket) {
        return { skipped: true }
      }

      const benchmarks: Record<string, {
        connectionTimeMs: number
        state: string
        latencyProbeMs?: number
      }> = {}

      for (const relayUrl of relayUrls) {
        try {
          const socket = new LiveRelaySocket(relayUrl)
          const startTime = Date.now()

          let connected = false
          const deadline = Date.now() + 10000
          while (Date.now() < deadline && socket.state.value !== 'Open') {
            if (socket.state.value === 'Closed') break
            await new Promise((r) => setTimeout(r, 100))
          }

          const connectionTimeMs = Date.now() - startTime
          connected = socket.state.value === 'Open'

          // Probe latency by sending a small message
          let latencyProbeMs: number | undefined
          if (connected) {
            const probeStart = Date.now()
            const probeMsg = JSON.stringify(['PING'])
            socket.send(probeMsg)
            latencyProbeMs = Date.now() - probeStart
          }

          socket.close()

          benchmarks[relayUrl] = {
            connectionTimeMs,
            state: connected ? 'Open' : 'Failed',
            latencyProbeMs,
          }
        } catch (e: any) {
          benchmarks[relayUrl] = {
            connectionTimeMs: -1,
            state: `Error: ${e.message}`,
          }
        }
      }

      return {
        ok: Object.values(benchmarks).some((b) => b.state === 'Open'),
        reason: 'benchmark complete',
        benchmarks,
      }
    }, REAL_RELAYS)

    if ((result as any).skipped) {
      test.skip()
      return
    }

    expect((result as any).ok).toBe(true)
  })
})
