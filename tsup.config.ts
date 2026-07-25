import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  platform: 'browser',
  target: 'es2020',
  bundle: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: false,
  treeshake: true,
  outExtension({ format }: { format: string }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    }
  },
})
