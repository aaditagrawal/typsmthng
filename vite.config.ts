import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        skipWaiting: true,
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
          return deps.filter((dep) => (
            !dep.includes('vendor-')
            && !dep.includes('editor-')
            && !dep.includes('latex-')
            && !dep.includes('typst')
            && !dep.includes('workspace-')
            && !dep.includes('project-io')
          ))
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
          if (id.includes('react') || id.includes('scheduler')) return 'react-core'
          if (id.includes('zustand') || id.includes('idb-keyval')) return 'state-core'
          return 'vendor'
        },
      },
    },
  },
})
