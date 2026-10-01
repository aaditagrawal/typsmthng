import react from '@vitejs/plugin-react'
import { stylexOptions } from './stylex.config.mjs'
import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  plugins: [react({ babel: { plugins: [['@stylexjs/babel-plugin', stylexOptions]] } })],
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
    testTimeout: 10000,
  },
})
