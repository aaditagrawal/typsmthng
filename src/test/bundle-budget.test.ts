import { describe, expect, it } from 'vitest'
import {
  HOME_PRELOAD_FILTER_PATTERNS,
  evaluateBundleBudget,
  isBlockedHomeChunk,
} from '../../scripts/check-bundle-budget.mjs'
import viteConfigSource from '../../vite.config.ts?raw'

describe('bundle budget guardrails', () => {
  it('blocks deferred chunks from the home path, allowing editor-store', () => {
    expect(isBlockedHomeChunk('editor-core-abc.js')).toBe(true)
    expect(isBlockedHomeChunk('editor-vim-abc.js')).toBe(true)
    expect(isBlockedHomeChunk('latex-converter-1.js')).toBe(true)
    expect(isBlockedHomeChunk('typst-worker-1.js')).toBe(true)
    expect(isBlockedHomeChunk('typst-engine-1.js')).toBe(true)
    expect(isBlockedHomeChunk('workspace-shell-1.js')).toBe(true)
    expect(isBlockedHomeChunk('project-io-1.js')).toBe(true)
    // editor-store is intentionally on the home path for sync Cmd+S.
    expect(isBlockedHomeChunk('editor-store-1.js')).toBe(false)
    expect(isBlockedHomeChunk('react-core-1.js')).toBe(false)
    expect(isBlockedHomeChunk('state-core-1.js')).toBe(false)
  })

  it('fails when blocked chunks are modulepreloaded', () => {
    const html = `
      <script type="module" src="/assets/index.js"></script>
      <link rel="modulepreload" href="/assets/react-core.js">
      <link rel="modulepreload" href="/assets/latex-converter.js">
    `
    const result = evaluateBundleBudget({
      html,
      assetSizes: {
        'index.js': 1024,
        'react-core.js': 1024,
        'latex-converter.js': 1024,
      },
      budgetBytes: 500 * 1024,
    })
    expect(result.ok).toBe(false)
    expect(result.blockedPreloads).toContain('latex-converter.js')
  })

  it('passes a home-safe preload set under budget', () => {
    const html = `
      <script type="module" src="/assets/index.js"></script>
      <link rel="modulepreload" href="/assets/react-core.js">
      <link rel="modulepreload" href="/assets/state-core.js">
      <link rel="modulepreload" href="/assets/project-store.js">
    `
    const result = evaluateBundleBudget({
      html,
      assetSizes: {
        'index.js': 7 * 1024,
        'react-core.js': 350 * 1024,
        'state-core.js': 2 * 1024,
        'project-store.js': 20 * 1024,
      },
      budgetBytes: 500 * 1024,
    })
    expect(result.ok).toBe(true)
    expect(result.blockedPreloads).toEqual([])
  })

  it('vite modulePreload filter uses the shared pattern list', () => {
    expect(viteConfigSource).toContain("import { HOME_PRELOAD_FILTER_PATTERNS } from './scripts/check-bundle-budget.mjs'")
    expect(viteConfigSource).toContain('HOME_PRELOAD_FILTER_PATTERNS.some((pattern) => dep.includes(pattern))')
    expect(viteConfigSource).toContain("id.includes('@replit/codemirror')")
    expect(viteConfigSource).toContain("return 'editor-core'")
    // The filter list stays a superset of the enforced closure blocklist prefixes.
    for (const pattern of ['vendor-', 'editor-', 'latex-', 'typst', 'workspace-', 'project-io']) {
      expect(HOME_PRELOAD_FILTER_PATTERNS).toContain(pattern)
    }
  })
})
