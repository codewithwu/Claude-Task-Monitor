import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: ['cjs'],
  external: ['vscode'],
  target: 'node18',
  sourcemap: true,
  clean: true
})
