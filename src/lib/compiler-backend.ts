import {
  createTypstCompiler,
  createTypstRenderer,
  initOptions,
  loadFonts,
  MemoryAccessModel,
} from '@myriaddreamin/typst.ts'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import type { Diagnostic } from '@/stores/compile-store'
import { getPreparedPackageForResolver, ensurePackagesForCompile as ensurePackagesForCompileRegistry } from './universe-registry'

const compilerWasmUrl = 'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm'

let compiler: Awaited<ReturnType<typeof createTypstCompiler>> | null = null
let renderer: Awaited<ReturnType<typeof createTypstRenderer>> | null = null
let initPromise: Promise<void> | null = null
/** Bumped on font/config teardown so in-flight WASM inits cannot publish stale instances. */
let initGeneration = 0
/** Serializes compile/render ops that mutate shared compiler/renderer session state. */
let operationChain: Promise<unknown> = Promise.resolve()
const PROJECT_ROOT = '/'
const packageAccessModel = new MemoryAccessModel()
const insertedPackageRoots = new Set<string>()
let additionalFontData: Uint8Array[] = []

function sameFontData(next: Uint8Array[]): boolean {
  if (additionalFontData.length !== next.length) return false
  for (let i = 0; i < additionalFontData.length; i++) {
    if (additionalFontData[i] !== next[i]) return false
  }
  return true
}

function enqueueCompilerOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = operationChain.then(operation, operation)
  operationChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function configureCompilerBackend(options?: { fontData?: Uint8Array[] }): void {
  const nextFontData = options?.fontData ?? []
  if (sameFontData(nextFontData)) return

  additionalFontData = nextFontData
  compiler = null
  renderer = null
  initGeneration += 1
  // Leave initPromise set so waiters observe the in-flight attempt; generation
  // gating discards stale publishes and callers retry until current config is ready.
}

function decodeVersion(version: unknown): string {
  if (version === undefined || version === null) return ''
  if (typeof version === 'string') return version

  if (version && typeof version === 'object') {
    const obj = version as Record<string, unknown>
    if (
      typeof obj.major === 'number'
      && typeof obj.minor === 'number'
      && typeof obj.patch === 'number'
    ) {
      return `${obj.major}.${obj.minor}.${obj.patch}`
    }
  }

  return ''
}

function packageRootPath(namespace: string, name: string, version: string): string {
  return `/@memory/fetch/packages/${namespace}/${name}/${version}`
}

function ensurePackageInAccessModel(spec: unknown): string | undefined {
  if (!spec || typeof spec !== 'object') return undefined

  const raw = spec as Record<string, unknown>
  const namespace = String(raw.namespace ?? '')
  const name = String(raw.name ?? '')
  const version = decodeVersion(raw.version)

  if (!namespace || !name || !version) return undefined

  const prepared = getPreparedPackageForResolver({
    namespace,
    name,
    version,
  })
  if (!prepared) return undefined

  const root = packageRootPath(namespace, name, version)
  const rootKey = `${namespace}/${name}/${version}`
  if (!insertedPackageRoots.has(rootKey)) {
    for (const file of prepared.files) {
      packageAccessModel.insertFile(
        `${root}/${file.path}`,
        file.data,
        new Date((file.mtime || Math.floor(Date.now() / 1000)) * 1000),
      )
    }
    insertedPackageRoots.add(rootKey)
  }

  return root
}

export function isCompilerReadyBackend(): boolean {
  return compiler !== null && renderer !== null
}

export async function initCompilerBackend(): Promise<void> {
  while (!isCompilerReadyBackend()) {
    const generationAtWait = initGeneration

    if (!initPromise) {
      const generation = initGeneration
      const fontsForInit = additionalFontData

      let pending: Promise<void>
      pending = (async () => {
        try {
          const nextCompiler = createTypstCompiler()
          await nextCompiler.init({
            getModule: () => compilerWasmUrl,
            beforeBuild: [
              loadFonts(fontsForInit, { assets: ['text'] }),
              initOptions.withAccessModel(packageAccessModel as never),
              initOptions.withPackageRegistry({
                resolve: (spec: unknown) => ensurePackageInAccessModel(spec),
              } as never),
            ],
          })

          const nextRenderer = createTypstRenderer()
          await nextRenderer.init({
            getModule: () => rendererWasmUrl,
          })

          // Config changed while WASM was loading — discard this instance.
          if (generation !== initGeneration) return

          compiler = nextCompiler
          renderer = nextRenderer
        } catch (err) {
          console.error('Failed to initialize compiler:', err)
          if (generation === initGeneration) {
            compiler = null
            renderer = null
          }
          throw err
        } finally {
          if (initPromise === pending) {
            initPromise = null
          }
        }
      })()

      initPromise = pending
    }

    try {
      await initPromise
    } catch (err) {
      if (isCompilerReadyBackend()) return
      // A newer configure invalidated this attempt; loop and retry.
      if (initGeneration !== generationAtWait) continue
      throw err
    }

    if (!isCompilerReadyBackend()) {
      // Init finished without publishing (superseded). Retry current config.
      continue
    }
  }
}

export interface PageDimension {
  width: number
  height: number
  pageOffset?: number
}

export interface CompileTimings {
  compileMs: number
  renderMs: number
  totalMs: number
}

export interface CompileResult {
  svg: string | null
  vectorData: Uint8Array | null
  pageDimensions: PageDimension[]
  diagnostics: Diagnostic[]
  success: boolean
  timings?: CompileTimings
}

export async function compileTypstBackend(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
): Promise<CompileResult> {
  return enqueueCompilerOperation(() => compileTypstBackendUnlocked(
    source,
    extraFiles,
    mainFilePath,
    extraBinaryFiles,
  ))
}

async function compileTypstBackendUnlocked(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
): Promise<CompileResult> {
  if (!compiler || !renderer) {
    throw new Error('Compiler not initialized')
  }

  const totalStart = performance.now()

  compiler.resetShadow()
  compiler.addSource(mainFilePath, source)

  if (extraFiles) {
    for (const file of extraFiles) {
      compiler.addSource(file.path, file.content)
    }
  }
  if (extraBinaryFiles) {
    for (const file of extraBinaryFiles) {
      compiler.mapShadow(file.path, file.data)
    }
  }

  const compileStart = performance.now()
  const { result: vectorData, diagnostics: rawDiags } = await compiler.compile({
    mainFilePath,
    root: PROJECT_ROOT,
    diagnostics: 'full',
  })
  const compileMs = performance.now() - compileStart

  const diagnostics: Diagnostic[] = (rawDiags ?? []).map((d: unknown) => {
    const diag = d as Record<string, unknown>
    return {
      severity: String(diag.severity || 'error') as Diagnostic['severity'],
      path: String(diag.path || ''),
      range: String(diag.range || ''),
      message: String(diag.message || ''),
      package: diag.package ? String(diag.package) : undefined,
    }
  })

  if (!vectorData) {
    return {
      svg: null,
      vectorData: null,
      pageDimensions: [],
      diagnostics,
      success: false,
      timings: {
        compileMs,
        renderMs: 0,
        totalMs: performance.now() - totalStart,
      },
    }
  }

  let svg: string | null = null
  let pageDimensions: PageDimension[] = []

  const renderStart = performance.now()
  await renderer.runWithSession(
    { format: 'vector', artifactContent: vectorData },
    async (session) => {
      const pagesInfo = session.retrievePagesInfo()
      svg = await session.renderSvg({})

      pageDimensions = pagesInfo.map((page) => ({
        width: page.width,
        height: page.height,
        pageOffset: page.pageOffset,
      }))
    },
  )
  const renderMs = performance.now() - renderStart

  return {
    svg,
    vectorData,
    pageDimensions,
    diagnostics,
    success: true,
    timings: {
      compileMs,
      renderMs,
      totalMs: performance.now() - totalStart,
    },
  }
}

export async function resolveSourceLocBackend(
  vectorData: Uint8Array,
  path: Uint32Array,
): Promise<string | undefined> {
  return enqueueCompilerOperation(async () => {
    if (!renderer) return undefined

    let loc: string | undefined
    await renderer.runWithSession(
      { format: 'vector', artifactContent: vectorData },
      async (session) => {
        loc = session.getSourceLoc(path)
      },
    )
    return loc
  })
}

export async function resolveSourceLocBatchBackend(
  vectorData: Uint8Array,
  paths: Uint32Array[],
): Promise<Array<string | undefined>> {
  return enqueueCompilerOperation(async () => {
    if (!renderer || paths.length === 0) return []

    const locs: Array<string | undefined> = new Array(paths.length).fill(undefined)
    await renderer.runWithSession(
      { format: 'vector', artifactContent: vectorData },
      async (session) => {
        for (let i = 0; i < paths.length; i++) {
          try {
            locs[i] = session.getSourceLoc(paths[i])
          } catch {
            locs[i] = undefined
          }
        }
      },
    )
    return locs
  })
}

export async function compileToPdfBackend(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
): Promise<Uint8Array | null> {
  return enqueueCompilerOperation(async () => {
    if (!compiler) {
      throw new Error('Compiler not initialized')
    }

    compiler.resetShadow()
    compiler.addSource(mainFilePath, source)
    if (extraFiles) {
      for (const file of extraFiles) {
        compiler.addSource(file.path, file.content)
      }
    }
    if (extraBinaryFiles) {
      for (const file of extraBinaryFiles) {
        compiler.mapShadow(file.path, file.data)
      }
    }

    const { result } = await compiler.compile({
      mainFilePath,
      root: PROJECT_ROOT,
      format: 1,
      diagnostics: 'none',
    })

    return result ?? null
  })
}

export async function ensurePackagesForCompileBackend(specs: string[]): Promise<void> {
  await ensurePackagesForCompileRegistry(specs)
}
