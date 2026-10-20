import react from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { stylexOptions } from './stylex.config.mjs'
import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  plugins: [babel({ plugins: [['@stylexjs/babel-plugin', stylexOptions]] }), react()],
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
