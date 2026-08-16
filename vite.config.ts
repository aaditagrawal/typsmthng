import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { HOME_PRELOAD_FILTER_PATTERNS } from './scripts/check-bundle-budget.mjs'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      // Prompt mode so UpdateToast can call the registerSW updater.
      // autoUpdate + skipWaiting never fires onNeedRefresh.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024, // 50MB for WASM
        runtimeCaching: [
          {
            urlPattern: ({ url }) => (
              url.hostname === 'cdn.jsdelivr.net'
              && url.pathname.includes('/@myriaddreamin/typst-ts-web-compiler@')
              && url.pathname.endsWith('/pkg/typst_ts_web_compiler_bg.wasm')
            ),
            handler: 'CacheFirst',
            options: {
              cacheName: 'typst-compiler-wasm',
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: 'typsmthng — Typst Editor',
        short_name: 'typsmthng',
        description: 'A web-based Typst editor and compiler that runs entirely in your browser.',
        theme_color: '#FF4D00',
        background_color: '#1a1a1a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/common'],
  },
  worker: {
    format: 'es',
  },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps, context) => {
        if (context.hostType === 'html' && context.hostId.endsWith('index.html')) {
          // Home shell must not preload editor/Typst/LaTeX/workspace chunks.
          return deps.filter((dep) => !HOME_PRELOAD_FILTER_PATTERNS.some((pattern) => dep.includes(pattern)))
        }
        return deps
      },
    },
    target: 'es2022',
    sourcemap: false,
    cssMinify: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep Vite's shared dynamic-import helper out of typst-engine so the
          // home graph (project-store → editor-store preload) does not wait on Typst TLA.
          if (id.includes('preload-helper') || id.includes('vite/modulepreload')) {
            return 'rolldown-runtime'
          }
          if (!id.includes('node_modules')) return undefined
          if (id.includes('unified-latex') || id.includes('pegjs')) return 'latex-converter'
          if (id.includes('@replit/codemirror-vim')) return 'editor-vim'
          // Keep all CodeMirror + Lezer packages (including @replit helpers that
          // import @codemirror/*) in one chunk. Leaving indentation-markers in
          // `vendor` created vendor → editor-core and preloaded ~486KB on home.
          if (
            id.includes('@codemirror') || id.includes('/codemirror/')
            || id.includes('@lezer') || id.includes('codemirror-lang-typst')
            || id.includes('@replit/codemirror')
          ) return 'editor-core'
          // Typst runtime must not ride the catch-all vendor chunk onto the home
          // static graph (it brings __tla and blocks React mount).
          if (
            id.includes('@myriaddreamin')
            || id.includes('typst-ts-')
            || id.includes('/typst.ts')
          ) return 'typst-engine'
          // Only real React packages — lucide-react must not inflate react-core.
          if (
            id.includes('/node_modules/react/')
            || id.includes('/node_modules/react-dom/')
            || id.includes('/node_modules/scheduler/')
          ) return 'react-core'
          if (id.includes('zustand') || id.includes('idb-keyval')) return 'state-core'
          return 'vendor'
        },
      },
    },
  },
})
