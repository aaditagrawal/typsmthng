import { beforeEach, describe, expect, it, vi } from 'vitest'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const initGates: Deferred[] = []
const compileGates: Deferred[] = []
let compileCall = 0
const renderSvgMock = vi.fn(async () => '<svg/>')

vi.mock('@myriaddreamin/typst.ts', () => {
  class MemoryAccessModel {
    insertFile(): void {}
  }

  return {
    MemoryAccessModel,
    loadFonts: (fonts: Uint8Array[]) => fonts,
    initOptions: {
      withAccessModel: () => ({}),
      withPackageRegistry: () => ({}),
    },
    createTypstCompiler: () => ({
      init: vi.fn(async () => {
        const gate = deferred()
        initGates.push(gate)
        await gate.promise
      }),
      resetShadow: vi.fn(),
      addSource: vi.fn(),
      mapShadow: vi.fn(),
      compile: vi.fn(async () => {
        const call = compileCall++
        const gate = deferred()
        compileGates.push(gate)
        await gate.promise
        if (call === 0) {
          return { result: null, diagnostics: [] }
        }
        return { result: new Uint8Array([37, 80, 68, 70]), diagnostics: [] }
      }),
    }),
    createTypstRenderer: () => ({
      init: vi.fn(async () => {}),
      runWithSession: vi.fn(async (_opts: unknown, cb: (session: {
        retrievePagesInfo: () => []
        renderSvg: () => Promise<string>
        getSourceLoc: () => undefined
      }) => Promise<void>) => {
        await cb({
          retrievePagesInfo: () => [],
          renderSvg: renderSvgMock,
          getSourceLoc: () => undefined,
        })
      }),
    }),
  }
})

vi.mock('@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url', () => ({
  default: 'renderer.wasm',
}))

vi.mock('@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url', () => ({
  default: 'compiler.wasm',
}))

vi.mock('@/lib/universe-registry', () => ({
  getPreparedPackageForResolver: vi.fn(() => null),
  ensurePackagesForCompile: vi.fn(async () => {}),
}))

describe('compiler-backend races', () => {
  beforeEach(() => {
    initGates.length = 0
    compileGates.length = 0
    compileCall = 0
    renderSvgMock.mockClear()
    vi.resetModules()
  })

  it('discards superseded WASM init when fonts change mid-init', async () => {
    const backend = await import('@/lib/compiler-backend')

    const first = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))

    backend.configureCompilerBackend({ fontData: [new Uint8Array([1, 2, 3])] })
    const second = backend.initCompilerBackend()

    // Finish the stale init first — it must not publish.
    initGates[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(backend.isCompilerReadyBackend()).toBe(false)

    await vi.waitFor(() => expect(initGates.length).toBe(2))
    initGates[1].resolve()
    await Promise.all([first, second])
    expect(backend.isCompilerReadyBackend()).toBe(true)
  })

  it('serializes overlapping SVG compile and PDF export on the shared compiler', async () => {
    const backend = await import('@/lib/compiler-backend')
    const ready = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))
    initGates[0].resolve()
    await ready

    const order: string[] = []

    const svg = backend.compileTypstBackend('= svg').then((result) => {
      order.push('svg')
      return result
    })
    await vi.waitFor(() => expect(compileGates.length).toBe(1))

    const pdf = backend.compileToPdfBackend('= pdf').then((result) => {
      order.push('pdf')
      return result
    })

    // PDF must not enter compiler.compile until SVG releases the queue.
    await Promise.resolve()
    await Promise.resolve()
    expect(compileGates.length).toBe(1)

    compileGates[0].resolve()
    await vi.waitFor(() => expect(compileGates.length).toBe(2))
    compileGates[1].resolve()

    await Promise.all([svg, pdf])
    expect(order).toEqual(['svg', 'pdf'])
  })

  it('renders the full-document SVG only when requested', async () => {
    const backend = await import('@/lib/compiler-backend')
    const ready = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))
    initGates[0].resolve()
    await ready

    // First mocked compile yields no vector data; run it to advance the counter.
    const warmup = backend.compileTypstBackend('= warmup')
    await vi.waitFor(() => expect(compileGates.length).toBe(1))
    compileGates[0].resolve()
    await warmup

    const canvasOnly = backend.compileTypstBackend('= doc')
    await vi.waitFor(() => expect(compileGates.length).toBe(2))
    compileGates[1].resolve()
    const canvasResult = await canvasOnly
    expect(canvasResult.success).toBe(true)
    expect(canvasResult.vectorData).not.toBeNull()
    expect(canvasResult.svg).toBeNull()
    expect(renderSvgMock).not.toHaveBeenCalled()

    const withSvg = backend.compileTypstBackend('= doc', undefined, '/main.typ', undefined, { wantSvg: true })
    await vi.waitFor(() => expect(compileGates.length).toBe(3))
    compileGates[2].resolve()
    const svgResult = await withSvg
    expect(svgResult.svg).toBe('<svg/>')
    expect(renderSvgMock).toHaveBeenCalledTimes(1)
  })
})
