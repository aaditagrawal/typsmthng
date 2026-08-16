import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsState = {
  systemFontsEnabled: true,
  googleFontsEnabled: true,
}
const wrapMock = vi.fn()

vi.mock('comlink', () => ({
  wrap: wrapMock,
}))

vi.mock('@/lib/compiler-backend', () => ({
  initCompilerBackend: vi.fn(async () => {}),
  compileTypstBackend: vi.fn(async () => ({
    svg: '<svg/>',
    vectorData: new Uint8Array([1]),
    pageDimensions: [],
    diagnostics: [],
    success: true,
  })),
  compileToPdfBackend: vi.fn(async () => ({ pdf: new Uint8Array([1, 2, 3]), diagnostics: [] })),
  configureCompilerBackend: vi.fn(),
  ensurePackagesForCompileBackend: vi.fn(async () => {}),
  isCompilerReadyBackend: vi.fn(() => false),
  resolveSourceLocBackend: vi.fn(async () => undefined),
  resolveSourceLocBatchBackend: vi.fn(async () => []),
}))

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}))

function installWindow(overrides?: Partial<Window>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: vi.fn(() => null),
      },
      queryLocalFonts: undefined,
      ...overrides,
    },
  })
}

class MockEventWorker {
  static instances: MockEventWorker[] = []
  private listeners = new Map<string, Array<(event: Event) => void>>()
  terminate = vi.fn()

  constructor() {
    MockEventWorker.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const bucket = this.listeners.get(type) ?? []
    bucket.push(listener)
    this.listeners.set(type, bucket)
  }

  removeEventListener(): void {}

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type } as Event)
    }
  }
}

function installMockEventWorker(): void {
  MockEventWorker.instances = []
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: MockEventWorker,
  })
}

function mockWorkerApi() {
  return {
    initCompiler: vi.fn().mockResolvedValue(undefined),
    compileTypst: vi.fn().mockResolvedValue({
      svg: '<svg>worker</svg>',
      vectorData: new Uint8Array([3]),
      pageDimensions: [],
      diagnostics: [],
      success: true,
    }),
    compileToPdf: vi.fn().mockResolvedValue({ pdf: new Uint8Array([5]), diagnostics: [] }),
    ensurePackagesForCompile: vi.fn().mockResolvedValue(undefined),
    isCompilerReady: vi.fn().mockReturnValue(true),
    resolveSourceLoc: vi.fn().mockResolvedValue(undefined),
    resolveSourceLocBatch: vi.fn().mockResolvedValue([]),
  }
}

describe('compiler-client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    settingsState.systemFontsEnabled = true
    settingsState.googleFontsEnabled = true
    installWindow()
    globalThis.fetch = vi.fn(async () => new Response('')) as typeof fetch

    ;(globalThis as unknown as { Worker: unknown }).Worker = class {
      constructor() {
        throw new Error('worker unavailable')
      }
    }
  })

  it('falls back to backend when worker startup fails', async () => {
    const backend = await import('@/lib/compiler-backend')
    const {
      initCompilerClient,
      compileTypstClient,
      compileToPdfClient,
      isCompilerReadyClient,
    } = await import('@/lib/compiler-client')

    await initCompilerClient()
    const compileResult = await compileTypstClient('= Test')
    const pdf = await compileToPdfClient('= Test')

    expect(backend.initCompilerBackend).toHaveBeenCalled()
    expect(backend.compileTypstBackend).toHaveBeenCalled()
    expect(backend.compileToPdfBackend).toHaveBeenCalled()
    expect(compileResult.success).toBe(true)
    expect(pdf).toEqual({ pdf: new Uint8Array([1, 2, 3]), diagnostics: [] })
    expect(typeof isCompilerReadyClient()).toBe('boolean')
  })

  it('loads device and Google fonts for declared families', async () => {
    installWindow({
      queryLocalFonts: vi.fn().mockResolvedValue([
        {
          family: 'SF Pro Text',
          blob: vi.fn().mockResolvedValue({
            arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
          }),
        },
      ]),
    } as Partial<Window>)

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://fonts.googleapis.com/css?family=Inter')) {
        return new Response('@font-face { src: url(https://fonts.gstatic.com/s/inter/test.woff2); }')
      }
      if (url === 'https://fonts.gstatic.com/s/inter/test.woff2') {
        return new Response(new Uint8Array([4, 5, 6]))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const backend = await import('@/lib/compiler-backend')
    const { compileTypstClient } = await import('@/lib/compiler-client')
    await compileTypstClient('#set text(font: "SF Pro Text")\n#set text(font: "Inter")\nHello')

    expect(backend.configureCompilerBackend).toHaveBeenCalledWith({
      fontData: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
    })
    expect(backend.compileTypstBackend).toHaveBeenCalled()
  })

  it('passes cached font data into worker init without clearing it', async () => {
    installWindow({
      queryLocalFonts: vi.fn().mockResolvedValue([
        {
          family: 'SF Pro Text',
          blob: vi.fn().mockResolvedValue({
            arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7]).buffer),
          }),
        },
      ]),
    } as Partial<Window>)

    const workerApi = mockWorkerApi()
    installMockEventWorker()
    wrapMock.mockReturnValue(workerApi)

    const { compileTypstClient } = await import('@/lib/compiler-client')
    await compileTypstClient('#set text(font: "SF Pro Text")\nHello')

    expect(workerApi.initCompiler).toHaveBeenCalledWith({
      fontData: [new Uint8Array([9, 8, 7])],
    })
  })

  it('fails over in-flight calls when the worker dies mid-call', async () => {
    installMockEventWorker()
    const workerApi = mockWorkerApi()
    // Comlink calls against a dead endpoint never settle on their own.
    workerApi.compileTypst.mockImplementation(() => new Promise(() => {}))
    wrapMock.mockReturnValue(workerApi)

    const backend = await import('@/lib/compiler-backend')
    const { useCompileStore } = await import('@/stores/compile-store')
    const { compileTypstClient } = await import('@/lib/compiler-client')

    const generationBefore = useCompileStore.getState().compilerGeneration
    const pending = compileTypstClient('= Crash')
    await vi.waitFor(() => expect(workerApi.compileTypst).toHaveBeenCalled())

    MockEventWorker.instances[0].dispatch('error')

    const result = await pending
    expect(result.success).toBe(true)
    expect(backend.compileTypstBackend).toHaveBeenCalled()
    expect(MockEventWorker.instances[0].terminate).toHaveBeenCalled()
    expect(useCompileStore.getState().compilerGeneration).toBe(generationBefore + 1)
  })

  it('propagates worker application errors without falling back or disabling the worker', async () => {
    installMockEventWorker()
    const workerApi = mockWorkerApi()
    workerApi.compileTypst.mockRejectedValueOnce(new Error('layout panicked'))
    wrapMock.mockReturnValue(workerApi)

    const backend = await import('@/lib/compiler-backend')
    const { compileTypstClient } = await import('@/lib/compiler-client')

    await expect(compileTypstClient('= Boom')).rejects.toThrow('layout panicked')
    expect(backend.compileTypstBackend).not.toHaveBeenCalled()

    const result = await compileTypstClient('= Boom')
    expect(result.svg).toBe('<svg>worker</svg>')
    expect(workerApi.compileTypst).toHaveBeenCalledTimes(2)
    expect(MockEventWorker.instances).toHaveLength(1)
  })

  it('forwards the wantSvg compile option to the worker', async () => {
    installMockEventWorker()
    const workerApi = mockWorkerApi()
    wrapMock.mockReturnValue(workerApi)

    const { compileTypstClient } = await import('@/lib/compiler-client')
    await compileTypstClient('= Doc', undefined, '/main.typ', undefined, { wantSvg: true })

    expect(workerApi.compileTypst).toHaveBeenCalledWith(
      '= Doc',
      undefined,
      '/main.typ',
      undefined,
      { wantSvg: true },
    )
  })
})
