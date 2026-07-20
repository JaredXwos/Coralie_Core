import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs', 'iife'],
    dts: true,
    globalName: 'CoralieCore',
  },
  {
    // Internal-only bundle for examples/demo.html and Playwright e2e tests.
    // Never published/shipped as the package's public entry point — see
    // src/internal-testing-exports.ts for why this exists separately from
    // the trimmed public API above.
    entry: { 'internal-testing': 'src/internal-testing-exports.ts' },
    format: ['iife'],
    dts: false,
    globalName: 'CoralieInternal',
    outDir: 'dist',
  },
])
