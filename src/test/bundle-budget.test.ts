import { describe, expect, it } from 'vitest'
import {
  BLOCKED_HOME_PRELOAD_PATTERNS,
  evaluateBundleBudget,
  isBlockedHomePreload,
} from '@/lib/home-preload-budget'
import viteConfigSource from '../../vite.config.ts?raw'
import budgetScriptSource from '../../scripts/check-bundle-budget.mjs?raw'

describe('bundle budget guardrails', () => {
  it('blocks home preloads that vite also filters', () => {
    expect(isBlockedHomePreload('editor-core-abc.js')).toBe(true)
    expect(isBlockedHomePreload('vendor-xyz.js')).toBe(true)
    expect(isBlockedHomePreload('latex-converter-1.js')).toBe(true)
    expect(isBlockedHomePreload('typst-worker-1.js')).toBe(true)
    expect(isBlockedHomePreload('workspace-shell-1.js')).toBe(true)
    expect(isBlockedHomePreload('project-io-1.js')).toBe(true)
    expect(isBlockedHomePreload('react-core-1.js')).toBe(false)
    expect(isBlockedHomePreload('state-core-1.js')).toBe(false)
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

  it('keeps vite + budget script filters aligned with @replit/codemirror in editor-core', () => {
    expect(viteConfigSource).toContain("id.includes('@replit/codemirror')")
    expect(viteConfigSource).toContain("return 'editor-core'")
    for (const pattern of BLOCKED_HOME_PRELOAD_PATTERNS) {
      expect(viteConfigSource).toContain(`'${pattern}'`)
    }
    // Budget script walks the static closure and allows editor-store on home for
    // sync Cmd+S; it still rejects editor-core/vim, typst, latex, workspace, project-io.
    for (const token of ['editor-core', 'editor-vim', 'typst-engine', 'latex-', 'workspace-', 'project-io']) {
      expect(budgetScriptSource).toContain(token)
    }
    expect(budgetScriptSource).toContain('walkStaticClosure')
    expect(budgetScriptSource).toContain('createTypstCompiler')
  })
})
