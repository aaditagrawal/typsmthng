import react from '@vitejs/plugin-react'
import { stylexCompiler } from './stylex-vite-plugin'
import { configDefaults, defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'
import path from 'path'

export default defineConfig({
  plugins: [
    stylexCompiler(),
    react(),
    wasm(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, '**/.compiler-perf/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Bound DOM workers so compiler race tests are not starved by parallel imports.
    maxWorkers: 4,
    testTimeout: 30000,
  },
})
