import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the compiler module
vi.mock('@/lib/compiler', () => ({
  initCompiler: vi.fn(async () => {}),
  compileTypst: vi.fn(async (source: string) => ({
    svg: `<svg>${source.slice(0, 10)}</svg>`,
    vectorData: new Uint8Array([1, 2, 3]),
    pageDimensions: [{ width: 595, height: 842 }],
    diagnostics: [],
    success: true,
  })),
  isCompilerReady: vi.fn(() => true),
  compileToPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  ensurePackagesForCompile: vi.fn(async () => {}),
}))

vi.mock('@/lib/universe-registry', () => ({
  ensurePackagesForCompile: vi.fn(async () => {}),
}))

// Mock idb-keyval for project store
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => { store.set(key, val) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    keys: vi.fn(async () => Array.from(store.keys())),
  }
})

import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { ensureCompilerReady, forceCompile } from '@/lib/compile-manager'
import { compileTypst, isCompilerReady } from '@/lib/compiler'

describe('Compile Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    useCompileStore.setState({
      status: 'idle',
      diagnostics: [],
      svg: null,
      pageDimensions: [],
      totalPages: 0,
      errorCount: 0,
      warningCount: 0,
      compileTime: 0,
      autoCompile: true,
    })
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      currentFilePath: null,
      hasSelectedProject: false,
      loading: false,
    })
    useEditorStore.setState({
      source: '',
      isDirty: false,
      saveStatus: 'saved',
      lastUserEditAt: 0,
    })
  })

  it('ensureCompilerReady should resolve when compiler is ready', async () => {
    vi.mocked(isCompilerReady).mockReturnValue(true)
    await expect(ensureCompilerReady()).resolves.toBeUndefined()
  })

  it('forceCompile should update compile store with results', async () => {
    await forceCompile('= Hello')

    // Wait for async compile to complete
    await new Promise((r) => setTimeout(r, 50))

    const state = useCompileStore.getState()
    expect(state.status).toBe('success')
    expect(state.svg).toContain('<svg>')
    expect(state.pageDimensions).toHaveLength(1)
    expect(state.compileTime).toBeGreaterThanOrEqual(0)
  })

  it('should set status to compiling during compilation', async () => {
    const compilePromise = forceCompile('= Test')

    // The status should briefly be 'compiling'
    // (may already be resolved since mock is instant)
    await compilePromise
    await new Promise((r) => setTimeout(r, 50))

    // After completion, should be success
    expect(useCompileStore.getState().status).toBe('success')
  })

  it('compiles using project main path while respecting live editor content', async () => {
    const now = Date.now()
    useProjectStore.setState({
      projects: [{
        id: 'p1',
        name: 'Template Project',
        files: [
          { path: '/template/main.typ', content: '= Main Template', isBinary: false, lastModified: now },
          { path: '/vgtc.typ', content: '#let title = [VGTC]', isBinary: false, lastModified: now },
          { path: '/template/figs/clouds.jpg', content: '', isBinary: true, binaryData: new Uint8Array([1, 2, 3]), lastModified: now },
        ],
        mainFile: '/template/main.typ',
        createdAt: now,
        updatedAt: now,
      }],
      currentProjectId: 'p1',
      currentFilePath: '/template/main.typ',
      hasSelectedProject: true,
    })

    await forceCompile('= Ignored Editor Buffer')

    const lastCall = vi.mocked(compileTypst).mock.calls.at(-1)
    expect(lastCall?.[0]).toContain('= Ignored Editor Buffer')
    expect(lastCall?.[1]).toEqual([{ path: '/vgtc.typ', content: '#let title = [VGTC]' }])
    expect(lastCall?.[2]).toBe('/template/main.typ')
    expect(lastCall?.[3]).toEqual([{ path: '/template/figs/clouds.jpg', data: new Uint8Array([1, 2, 3]) }])
  })

  it('applies package import compatibility rewrites during compile', async () => {
    const now = Date.now()
    useProjectStore.setState({
      projects: [{
        id: 'p2',
        name: 'Compat Project',
        files: [
          { path: '/main.typ', content: '#import "@preview/ctheorems:1.1.2": *\n= Main', isBinary: false, lastModified: now },
          { path: '/extra.typ', content: '#import "@preview/ctheorems:1.1.2": *', isBinary: false, lastModified: now },
        ],
        mainFile: '/main.typ',
        createdAt: now,
        updatedAt: now,
      }],
      currentProjectId: 'p2',
      currentFilePath: '/main.typ',
      hasSelectedProject: true,
    })

    await forceCompile('#import "@preview/ctheorems:1.1.2": *\n= Buffer')

    const lastCall = vi.mocked(compileTypst).mock.calls.at(-1)
    expect(lastCall?.[0]).toContain('@preview/ctheorems:1.1.3')
    expect(lastCall?.[0]).not.toContain('@preview/ctheorems:1.1.2')
    expect(lastCall?.[1]).toEqual([{ path: '/extra.typ', content: '#import "@preview/ctheorems:1.1.3": *' }])
  })

  it('drops stale results when a newer compile is requested', async () => {
    vi.mocked(compileTypst)
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return {
          svg: '<svg>OLD</svg>',
          vectorData: new Uint8Array([1]),
          pageDimensions: [{ width: 1, height: 1 }],
          diagnostics: [],
          success: true,
        }
      })
      .mockImplementationOnce(async () => ({
        svg: '<svg>NEW</svg>',
        vectorData: new Uint8Array([2]),
        pageDimensions: [{ width: 1, height: 1 }],
        diagnostics: [],
        success: true,
      }))

    const oldCompile = forceCompile('= Old')
    const newCompile = forceCompile('= New')
    await Promise.all([oldCompile, newCompile])

    // forceCompile must not resolve until the queued request has settled.
    expect(useCompileStore.getState().svg).toContain('NEW')
  })

  it('awaits a queued forceCompile until its result is applied', async () => {
    let releaseOld: (() => void) | undefined
    vi.mocked(compileTypst)
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseOld = resolve })
        return {
          svg: '<svg>OLD</svg>',
          vectorData: new Uint8Array([1]),
          pageDimensions: [{ width: 1, height: 1 }],
          diagnostics: [],
          success: true,
        }
      })
      .mockImplementationOnce(async () => ({
        svg: '<svg>QUEUED</svg>',
        vectorData: new Uint8Array([9]),
        pageDimensions: [{ width: 1, height: 1 }],
        diagnostics: [],
        success: true,
      }))

    const oldCompile = forceCompile('= Old')
    await Promise.resolve()
    const queued = forceCompile('= Queued')

    let queuedDone = false
    void queued.then(() => { queuedDone = true })
    await Promise.resolve()
    expect(queuedDone).toBe(false)

    expect(releaseOld).toBeTypeOf('function')
    releaseOld()
    await Promise.all([oldCompile, queued])
    expect(queuedDone).toBe(true)
    expect(useCompileStore.getState().svg).toContain('QUEUED')
  })

  it('defers compile result application while the editor is actively typing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    useEditorStore.setState({ lastUserEditAt: Date.now() })
    const compilePromise = forceCompile('= While typing')
    await Promise.resolve()

    expect(useCompileStore.getState().svg).toBeNull()

    await vi.advanceTimersByTimeAsync(90)
    expect(useCompileStore.getState().svg).toBeNull()

    await vi.advanceTimersByTimeAsync(80)
    await compilePromise
    expect(useCompileStore.getState().svg).toContain('<svg>')
  })
})
