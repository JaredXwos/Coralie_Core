# Usage Guide

Nostr + WebRTC Mesh can be used in two ways: **standalone in HTML**, or as an **npm package**.

---

## Standalone HTML (Browser Script Tag)

### CDN via jsDelivr

Load the pre-built bundle directly in your HTML:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nostr WebRTC Mesh Demo</title>
</head>
<body>
  <h1>Nostr WebRTC Mesh</h1>
  <pre id="output"></pre>

  <!-- Load from jsDelivr CDN -->
  <script src="https://cdn.jsdelivr.net/npm/nostr-webrtc-mesh@latest/dist/index.umd.js"></script>
  
  <script>
    const { Signer } = NostrWebRTCMesh

    // Generate a new identity
    const signer = Signer.generate()
    
    document.getElementById('output').textContent = `
Public Key: ${signer.pubkeyHex}
Signing works: ${signer.sign({
  pubkey: signer.pubkeyHex,
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [],
  content: 'Hello from the mesh!'
}).id ? '✓' : '✗'}
    `
  </script>
</body>
</html>
```

### Alternative CDN: unpkg

```html
<script src="https://unpkg.com/nostr-webrtc-mesh@latest/dist/index.umd.js"></script>
```

### Self-Hosted

1. Build the project locally:
   ```bash
   npm install
   npm run build
   ```

2. Copy `dist/index.umd.js` to your web server

3. Load it:
   ```html
   <script src="/path/to/index.umd.js"></script>
   ```

---

## NPM Package (for Node.js or bundled apps)

### Install

```bash
npm install nostr-webrtc-mesh
```

### ESM Import (Vite, Next.js, Modern Bundlers)

```javascript
import { Signer, createStateFlow } from 'nostr-webrtc-mesh'

const signer = Signer.generate()
console.log(signer.pubkeyHex)

// Sign an event
const event = signer.sign({
  pubkey: signer.pubkeyHex,
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [],
  content: 'Hello mesh!'
})

console.log('Event ID:', event.id)
console.log('Valid:', signer.verify(event))
```

### CommonJS Import (Node.js, older bundlers)

```javascript
const { Signer } = require('nostr-webrtc-mesh')

const signer = Signer.generate()
console.log(signer.pubkeyHex)
```

---

## API Reference (Phase 0)

### Signer

```typescript
class Signer {
  // Generate random identity
  static generate(): Signer
  
  // Restore from secret key hex
  static fromSecretKeyHex(hex: string): Signer
  
  // Properties
  pubkeyHex: string
  
  // Methods
  sign(event: UnsignedNostrEvent): NostrEvent
  verify(event: NostrEvent): boolean
  ecdh(theirPubkeyHex: string): Uint8Array
  encryptNip44(theirPubkeyHex: string, plaintext: string): string
  decryptNip44(theirPubkeyHex: string, ciphertext: string): string
  exportSecretKeyHex(): string
  
  // Static utilities
  static sha256(data: Uint8Array): Uint8Array
  static sha256Hex(hex: string): string
}
```

### StateFlow / SharedFlow

```typescript
// StateFlow: holds a value, notifies on change
const flow = createStateFlow(initialValue)
flow.value                         // Get current value
flow.emit(newValue)               // Update and notify subscribers
flow.subscribe(v => console.log(v)) // Listen for changes
flow.asReadOnly()                 // Prevent external mutation

// SharedFlow: broadcasts events
const events = createSharedFlow()
events.emit(event)                // Broadcast
events.subscribe(e => console.log(e)) // Listen
```

---

## Example: Encryption Between Two Identities

```html
<script src="https://cdn.jsdelivr.net/npm/nostr-webrtc-mesh@latest/dist/index.umd.js"></script>
<script>
  const { Signer } = NostrWebRTCMesh

  // Create two identities
  const alice = Signer.generate()
  const bob = Signer.generate()

  console.log('Alice:', alice.pubkeyHex)
  console.log('Bob:', bob.pubkeyHex)

  // Alice encrypts a message to Bob
  const message = 'Secret message'
  const encrypted = alice.encryptNip44(bob.pubkeyHex, message)
  console.log('Encrypted:', encrypted.slice(0, 20) + '...')

  // Bob decrypts it
  const decrypted = bob.decryptNip44(alice.pubkeyHex, encrypted)
  console.log('Decrypted:', decrypted)
  console.log('Match:', decrypted === message)
</script>
```

---

## Browser Compatibility

- **ESM / UMD bundle**: Modern browsers (Chrome 61+, Firefox 60+, Safari 11+, Edge 79+)
- **Features**: `RTCPeerConnection`, `WebSocket`, `Uint8Array` (all standard in modern browsers)

For older browser support, consider a transpiler (Babel) or use the CommonJS version in Node.js.

---

## Next Steps

- See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design
- See [PHASE_0_CHECKLIST.md](./PHASE_0_CHECKLIST.md) for implementation status
- Phase 1 will add the Nostr signalling layer
- Phase 4+ will add WebRTC peer connections
- Phase 5 will expose the full `createLiveConnectionManager` orchestrator
