import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'internal-testing': 'src/internal-testing-exports.ts',
  },
  outDir: 'test-dist',
  format: ['iife'],
  globalName: 'CoralieInternal',
  platform: 'browser',
  target: 'es2020',
  bundle: true,
  splitting: false,
  minify: false,
  sourcemap: true,
  dts: false,
  clean: true,
  noExternal: [
    /^nostr-tools(?:\/.*)?$/,
    /^@noble\/hashes(?:\/.*)?$/,
  ],
  outExtension() {
    return {
      js: '.global.js',
    }
  },
})
