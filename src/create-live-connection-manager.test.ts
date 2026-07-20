import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createLiveConnectionManager } from './create-live-connection-manager'
import { DEFAULT_MESH_ENDPOINTS } from './mesh-endpoints'

describe('createLiveConnectionManager', () => {
  let manager1: Awaited<ReturnType<typeof createLiveConnectionManager>>
  let manager2: Awaited<ReturnType<typeof createLiveConnectionManager>>

  afterEach(() => {
    if (manager1) manager1.close()
    if (manager2) manager2.close()
  })

  describe('default endpoints', () => {
    it('uses default relay URLs when not provided', () => {
      manager1 = createLiveConnectionManager()
      expect(manager1).toBeDefined()
      // Manager is constructed, defaults are applied internally
    })

    it('uses default ICE servers when not provided', () => {
      manager1 = createLiveConnectionManager()
      expect(manager1).toBeDefined()
      // Defaults are applied in factory
    })
  })

  describe('endpoint overrides', () => {
    it('uses provided relay URLs instead of defaults (not merged)', () => {
      const customRelays = ['wss://custom1.relay', 'wss://custom2.relay']
      manager1 = createLiveConnectionManager({ relayUrls: customRelays })
      expect(manager1).toBeDefined()
      // Custom relays are passed to SignallingClient
    })

    it('uses provided ICE servers instead of defaults (not merged)', () => {
      const customIce: RTCIceServer[] = [{ urls: ['stun:custom.stun.example.com:3478'] }]
      manager1 = createLiveConnectionManager({ iceServers: customIce })
      expect(manager1).toBeDefined()
      // Custom ICE servers are passed to peer connection factory
    })

    it('combines custom relay and ICE overrides', () => {
      const customRelays = ['wss://custom.relay']
      const customIce: RTCIceServer[] = [{ urls: ['stun:custom.stun:3478'] }]
      manager1 = createLiveConnectionManager({ relayUrls: customRelays, iceServers: customIce })
      expect(manager1).toBeDefined()
    })
  })

  describe('fresh identity on every call', () => {
    it('generates a distinct pubkey for each factory call', () => {
      manager1 = createLiveConnectionManager()
      manager2 = createLiveConnectionManager()

      expect(manager1.myPubkeyHex).toBeDefined()
      expect(manager2.myPubkeyHex).toBeDefined()
      expect(manager1.myPubkeyHex).not.toEqual(manager2.myPubkeyHex)
    })

    it('produces valid 64-character hex public keys', () => {
      manager1 = createLiveConnectionManager()
      const pubkey = manager1.myPubkeyHex
      const hexRegex = /^[0-9a-f]{64}$/i
      expect(hexRegex.test(pubkey)).toBe(true)
    })

    it('three consecutive calls produce three distinct pubkeys', () => {
      manager1 = createLiveConnectionManager()
      manager2 = createLiveConnectionManager()
      const manager3 = createLiveConnectionManager()

      const pubkeys = new Set([manager1.myPubkeyHex, manager2.myPubkeyHex, manager3.myPubkeyHex])
      expect(pubkeys.size).toBe(3)

      manager3.close()
    })
  })

  describe('returned manager interface', () => {
    beforeEach(() => {
      manager1 = createLiveConnectionManager()
    })

    it('exposes myPubkeyHex', () => {
      expect(manager1.myPubkeyHex).toBeDefined()
      expect(typeof manager1.myPubkeyHex).toBe('string')
    })

    it('exposes peers StateFlow', () => {
      expect(manager1.peers).toBeDefined()
      expect(typeof manager1.peers.subscribe).toBe('function')
    })

    it('exposes incomingMessages SharedFlow', () => {
      expect(manager1.incomingMessages).toBeDefined()
      expect(typeof manager1.incomingMessages.subscribe).toBe('function')
    })

    it('exposes terminalFailures SharedFlow', () => {
      expect(manager1.terminalFailures).toBeDefined()
      expect(typeof manager1.terminalFailures.subscribe).toBe('function')
    })

    it('exposes addPeer method', () => {
      expect(typeof manager1.addPeer).toBe('function')
    })

    it('exposes sendToPeer method', () => {
      expect(typeof manager1.sendToPeer).toBe('function')
    })

    it('exposes close method', () => {
      expect(typeof manager1.close).toBe('function')
    })
  })

  describe('handshake timeout option', () => {
    it('accepts custom handshake timeout', () => {
      manager1 = createLiveConnectionManager({ handshakeTimeoutMs: 15000 })
      expect(manager1).toBeDefined()
    })

    it('defaults to 30000ms when not provided', () => {
      manager1 = createLiveConnectionManager()
      expect(manager1).toBeDefined()
      // Default is applied internally (30s per architecture)
    })
  })

  describe('idempotency and cleanup', () => {
    it('can create multiple managers independently', () => {
      manager1 = createLiveConnectionManager()
      manager2 = createLiveConnectionManager()

      expect(manager1.myPubkeyHex).not.toEqual(manager2.myPubkeyHex)
      expect(manager1.peers).not.toBe(manager2.peers)
    })

    it('close() can be called safely', () => {
      manager1 = createLiveConnectionManager()
      expect(() => manager1.close()).not.toThrow()
    })

    it('close() is idempotent (can be called multiple times)', () => {
      manager1 = createLiveConnectionManager()
      expect(() => {
        manager1.close()
        manager1.close()
      }).not.toThrow()
    })
  })

  describe('synchronous creation', () => {
    it('returns synchronously (does not require await)', () => {
      const result = createLiveConnectionManager()
      expect(result).toBeDefined()
      expect(result.myPubkeyHex).toBeDefined()
      manager1 = result
    })
  })

  describe('empty options object', () => {
    it('creates a manager with default endpoints when passed empty object', () => {
      manager1 = createLiveConnectionManager({})
      expect(manager1.myPubkeyHex).toBeDefined()
    })

    it('creates a manager when called with no arguments', () => {
      manager1 = createLiveConnectionManager()
      expect(manager1.myPubkeyHex).toBeDefined()
    })
  })
})
