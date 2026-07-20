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
    const { LiveInitiator, LiveAnswerer, createLivePeerConnectionFactory } = (window as any).CoralieCore

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
