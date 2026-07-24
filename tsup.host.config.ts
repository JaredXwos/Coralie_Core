import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    host: 'src/coralie/host-entry.ts',
  },
  outDir: 'dist/Coralie/v2',
  format: ['iife'],
  platform: 'browser',
  target: 'es2020',
  bundle: true,
  splitting: false,
  minify: true,
  sourcemap: true,
  dts: false,
  clean: true,

  // The browser asset must be standalone. Runtime dependencies imported by
  // the connection stack are bundled instead of left as bare module imports.
  noExternal: [
    /^nostr-tools(?:\/.*)?$/,
    /^@noble\/hashes(?:\/.*)?$/,
  ],

  // IIFE builds otherwise use the `.global.js` suffix.
  outExtension() {
    return {
      js: '.js',
    }
  },
})
