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

interface MockCompilerInstance {
  init: ReturnType<typeof vi.fn>
  resetShadow: ReturnType<typeof vi.fn>
  addSource: ReturnType<typeof vi.fn>
  mapShadow: ReturnType<typeof vi.fn>
  unmapShadow: ReturnType<typeof vi.fn>
  compile: ReturnType<typeof vi.fn>
}

const compilerInstances: MockCompilerInstance[] = []

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
    createTypstCompiler: () => {
      const instance: MockCompilerInstance = {
        init: vi.fn(async () => {
          const gate = deferred()
          initGates.push(gate)
          await gate.promise
        }),
        resetShadow: vi.fn(),
        addSource: vi.fn(),
        mapShadow: vi.fn(),
        unmapShadow: vi.fn(),
        compile: vi.fn(async () => {
          const call = compileCall++
          const gate = deferred()
          compileGates.push(gate)
          await gate.promise
          if (call === 0) {
            return {
              result: null,
              diagnostics: [
                { severity: 'error', path: '/main.typ', range: '2:13-2:15', message: 'expected expression' },
              ],
            }
          }
          return { result: new Uint8Array([37, 80, 68, 70]), diagnostics: [] }
        }),
      }
      compilerInstances.push(instance)
      return instance
    },
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

vi.mock('@myriaddreamin/typst-ts-web-compiler/package.json', () => ({
  version: '0.0.0-test',
}))

vi.mock('@/lib/universe-registry', () => ({
  getPreparedPackageForResolver: vi.fn(() => null),
  ensurePackagesForCompile: vi.fn(async () => {}),
}))

describe('compiler-backend races', () => {
  beforeEach(() => {
    initGates.length = 0
    compileGates.length = 0
    compilerInstances.length = 0
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

  it('incrementally applies only changed payloads and unmaps deleted files', async () => {
    const backend = await import('@/lib/compiler-backend')
    const ready = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))
    initGates[0].resolve()
    await ready
    const compilerMock = compilerInstances[0]

    const first = backend.compileTypstIncrementalBackend({
      mainFilePath: '/main.typ',
      manifest: [
        { path: '/main.typ', digest: 'm1' },
        { path: '/chapter.typ', digest: 'c1' },
        { path: '/img.png', digest: 'bin:1:1' },
      ],
      textPayloads: [
        { path: '/main.typ', content: '= Main' },
        { path: '/chapter.typ', content: '= Chapter' },
      ],
      binaryPayloads: [{ path: '/img.png', data: new Uint8Array([9]) }],
    })
    await vi.waitFor(() => expect(compileGates.length).toBe(1))
    compileGates[0].resolve()
    const firstResponse = await first
    expect(firstResponse.kind).toBe('result')
    expect(compilerMock.resetShadow).not.toHaveBeenCalled()
    expect(compilerMock.addSource).toHaveBeenCalledTimes(2)
    expect(compilerMock.mapShadow).toHaveBeenCalledTimes(1)

    // Only main changed; the image was deleted from the project.
    const second = backend.compileTypstIncrementalBackend({
      mainFilePath: '/main.typ',
      manifest: [
        { path: '/main.typ', digest: 'm2' },
        { path: '/chapter.typ', digest: 'c1' },
      ],
      textPayloads: [{ path: '/main.typ', content: '= Main v2' }],
      binaryPayloads: [],
    })
    await vi.waitFor(() => expect(compileGates.length).toBe(2))
    compileGates[1].resolve()
    const secondResponse = await second
    expect(secondResponse.kind).toBe('result')
    expect(compilerMock.resetShadow).not.toHaveBeenCalled()
    expect(compilerMock.unmapShadow).toHaveBeenCalledExactlyOnceWith('/img.png')
    expect(compilerMock.addSource).toHaveBeenCalledTimes(3)
    expect(compilerMock.addSource).toHaveBeenLastCalledWith('/main.typ', '= Main v2')
    expect(compilerMock.mapShadow).toHaveBeenCalledTimes(1)
  })

  it('reports missing payloads without touching the shadow', async () => {
    const backend = await import('@/lib/compiler-backend')
    const ready = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))
    initGates[0].resolve()
    await ready

    const response = await backend.compileTypstIncrementalBackend({
      mainFilePath: '/main.typ',
      manifest: [
        { path: '/main.typ', digest: 'm1' },
        { path: '/chapter.typ', digest: 'c1' },
      ],
      textPayloads: [{ path: '/main.typ', content: '= Main' }],
      binaryPayloads: [],
    })

    expect(response).toEqual({ kind: 'needs-sync', missingPaths: ['/chapter.typ'] })
    expect(compilerInstances[0].addSource).not.toHaveBeenCalled()
    expect(compilerInstances[0].unmapShadow).not.toHaveBeenCalled()
    expect(compileGates.length).toBe(0)
  })

  it('requires a resync after a wholesale PDF export resets the shadow', async () => {
    const backend = await import('@/lib/compiler-backend')
    const ready = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))
    initGates[0].resolve()
    await ready

    const synced = backend.compileTypstIncrementalBackend({
      mainFilePath: '/main.typ',
      manifest: [{ path: '/main.typ', digest: 'm1' }],
      textPayloads: [{ path: '/main.typ', content: '= Main' }],
      binaryPayloads: [],
    })
    await vi.waitFor(() => expect(compileGates.length).toBe(1))
    compileGates[0].resolve()
    expect((await synced).kind).toBe('result')

    const pdf = backend.compileToPdfBackend('= pdf')
    await vi.waitFor(() => expect(compileGates.length).toBe(2))
    compileGates[1].resolve()
    await pdf

    // Same digest, no payload: the wholesale export wiped incremental state.
    const stale = await backend.compileTypstIncrementalBackend({
      mainFilePath: '/main.typ',
      manifest: [{ path: '/main.typ', digest: 'm1' }],
      textPayloads: [],
      binaryPayloads: [],
    })
    expect(stale).toEqual({ kind: 'needs-sync', missingPaths: ['/main.typ'] })
  })

  it('rebases 0-based typst ranges to the 1-based positions the app expects', async () => {
    const backend = await import('@/lib/compiler-backend')
    const ready = backend.initCompilerBackend()
    await vi.waitFor(() => expect(initGates.length).toBe(1))
    initGates[0].resolve()
    await ready

    // The first mocked compile returns a diagnostic with a raw 0-based range.
    const compile = backend.compileTypstBackend('= broken')
    await vi.waitFor(() => expect(compileGates.length).toBe(1))
    compileGates[0].resolve()
    const result = await compile
    expect(result.diagnostics[0].range).toBe('3:14-3:16')
  })
})
