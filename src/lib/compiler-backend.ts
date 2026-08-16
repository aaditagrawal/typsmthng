import {
  createTypstCompiler,
  createTypstRenderer,
  initOptions,
  loadFonts,
  MemoryAccessModel,
} from '@myriaddreamin/typst.ts'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import { version as compilerPackageVersion } from '@myriaddreamin/typst-ts-web-compiler/package.json'
import type { Diagnostic } from '@/stores/compile-store'
import { getPreparedPackageForResolver, ensurePackagesForCompile as ensurePackagesForCompileRegistry } from './universe-registry'

let compiler: Awaited<ReturnType<typeof createTypstCompiler>> | null = null
let renderer: Awaited<ReturnType<typeof createTypstRenderer>> | null = null
let initPromise: Promise<void> | null = null
/** Bumped on font/config teardown so in-flight WASM inits cannot publish stale instances. */
let initGeneration = 0
// The compiler WASM (~28MB) intentionally stays on the CDN: bundling it locally
// exceeds the deploy target's 25MiB per-asset limit and would bloat the service
// worker precache. Pinning the version to the installed package keeps the JS
// wrapper and the WASM from drifting apart.
const compilerWasmUrl = `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@${compilerPackageVersion}/pkg/typst_ts_web_compiler_bg.wasm`

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
  shadowDigests.clear()
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

      const pendingRef: { current: Promise<void> | null } = { current: null }
      pendingRef.current = (async () => {
        try {
          const nextCompiler = createTypstCompiler()
          await nextCompiler.init({
            getModule: () => ({ module_or_path: compilerWasmUrl }),
            beforeBuild: [
              loadFonts(fontsForInit, { assets: ['text'] }),
              initOptions.withAccessModel(packageAccessModel),
              initOptions.withPackageRegistry({
                resolve: (spec: unknown) => ensurePackageInAccessModel(spec),
              }),
            ],
          })

          const nextRenderer = createTypstRenderer()
          await nextRenderer.init({
            getModule: () => ({ module_or_path: rendererWasmUrl }),
          })

          // Config changed while WASM was loading — discard this instance.
          if (generation !== initGeneration) return

          compiler = nextCompiler
          renderer = nextRenderer
          // Fresh WASM instance starts with an empty shadow VFS.
          shadowDigests.clear()
        } catch (err) {
          console.error('Failed to initialize compiler:', err)
          if (generation === initGeneration) {
            compiler = null
            renderer = null
          }
          throw err
        } finally {
          if (initPromise === pendingRef.current) {
            initPromise = null
          }
        }
      })()

      initPromise = pendingRef.current
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

export interface PdfCompileResult {
  pdf: Uint8Array | null
  diagnostics: Diagnostic[]
}

export interface CompileOptions {
  /** Render the full-document SVG alongside vector data. Skipped by default; canvas preview only needs vector data. */
  wantSvg?: boolean
}

export interface CompileManifestEntry {
  path: string
  /**
   * Opaque identity for the file's content. Text files use a content digest;
   * binaries use a caller-assigned identity token (buffers are immutable in
   * practice — a changed asset is a new Uint8Array). The backend only ever
   * compares digests for equality.
   */
  digest: string
}

/**
 * Incremental compile request: the manifest describes the complete set of
 * files the compiler VFS must contain (including the main file); payloads are
 * included only for entries the caller believes this compiler context has not
 * seen yet. The backend keeps its own path -> digest map of what is currently
 * shadowed, unmaps paths missing from the manifest, applies only mismatched
 * payloads, and never resets the shadow wholesale.
 */
export interface IncrementalCompileRequest {
  mainFilePath: string
  manifest: CompileManifestEntry[]
  textPayloads: Array<{ path: string; content: string }>
  binaryPayloads: Array<{ path: string; data: Uint8Array }>
  options?: CompileOptions
}

export type IncrementalCompileResponse =
  | { kind: 'result'; result: CompileResult }
  /**
   * The caller's belief about this context's VFS was stale: these manifest
   * entries mismatch the shadowed state and no payload was provided. Nothing
   * was applied; the caller should resend with the missing payloads included.
   */
  | { kind: 'needs-sync'; missingPaths: string[] }

/**
 * path -> digest of what is currently shadowed in the live compiler instance.
 * Module state is per-JS-context, so the worker build gets its own copy.
 */
const shadowDigests = new Map<string, string>()

function normalizeDiagnostics(rawDiags: unknown[] | undefined): Diagnostic[] {
  return (rawDiags ?? []).map((d: unknown) => {
    const diag = d as Record<string, unknown>
    return {
      severity: String(diag.severity || 'error') as Diagnostic['severity'],
      path: String(diag.path || ''),
      range: String(diag.range || ''),
      message: String(diag.message || ''),
      package: diag.package ? String(diag.package) : undefined,
    }
  })
}

export async function compileTypstBackend(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
  options?: CompileOptions,
): Promise<CompileResult> {
  return enqueueCompilerOperation(() => compileTypstBackendUnlocked(
    source,
    extraFiles,
    mainFilePath,
    extraBinaryFiles,
    options,
  ))
}

async function compileTypstBackendUnlocked(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
  options?: CompileOptions,
): Promise<CompileResult> {
  if (!compiler || !renderer) {
    throw new Error('Compiler not initialized')
  }

  const totalStart = performance.now()

  compiler.resetShadow()
  // Wholesale rewrite without digests: incremental state is now unknown.
  shadowDigests.clear()
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

  return compileAndRenderVectorLocked(mainFilePath, options, totalStart)
}

/**
 * Compile the currently shadowed VFS and render page info. Callers must hold
 * the operation queue and have verified compiler/renderer are initialized.
 */
async function compileAndRenderVectorLocked(
  mainFilePath: string,
  options: CompileOptions | undefined,
  totalStart: number,
): Promise<CompileResult> {
  if (!compiler || !renderer) {
    throw new Error('Compiler not initialized')
  }

  const compileStart = performance.now()
  const { result: vectorData, diagnostics: rawDiags } = await compiler.compile({
    mainFilePath,
    root: PROJECT_ROOT,
    diagnostics: 'full',
  })
  const compileMs = performance.now() - compileStart

  const diagnostics = normalizeDiagnostics(rawDiags)

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
      if (options?.wantSvg) {
        svg = await session.renderSvg({})
      }

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

export async function compileTypstIncrementalBackend(
  request: IncrementalCompileRequest,
): Promise<IncrementalCompileResponse> {
  return enqueueCompilerOperation(async () => {
    if (!compiler || !renderer) {
      throw new Error('Compiler not initialized')
    }

    const totalStart = performance.now()

    const textPayloads = new Map<string, string>()
    for (const file of request.textPayloads) {
      textPayloads.set(file.path, file.content)
    }
    const binaryPayloads = new Map<string, Uint8Array>()
    for (const file of request.binaryPayloads) {
      binaryPayloads.set(file.path, file.data)
    }

    // Defensive resync path: refuse (without applying anything) when the
    // caller believed we had content that we don't.
    const missingPaths: string[] = []
    for (const entry of request.manifest) {
      if (shadowDigests.get(entry.path) === entry.digest) continue
      if (textPayloads.has(entry.path) || binaryPayloads.has(entry.path)) continue
      missingPaths.push(entry.path)
    }
    if (missingPaths.length > 0) {
      return { kind: 'needs-sync' as const, missingPaths }
    }

    // Unmap files that no longer exist in the project.
    const manifestPaths = new Set<string>()
    for (const entry of request.manifest) {
      manifestPaths.add(entry.path)
    }
    for (const path of [...shadowDigests.keys()]) {
      if (manifestPaths.has(path)) continue
      compiler.unmapShadow(path)
      shadowDigests.delete(path)
    }

    // Apply only new/changed files; unchanged digests are left untouched.
    for (const entry of request.manifest) {
      if (shadowDigests.get(entry.path) === entry.digest) continue
      const content = textPayloads.get(entry.path)
      if (content !== undefined) {
        compiler.addSource(entry.path, content)
      } else {
        const data = binaryPayloads.get(entry.path)
        if (data === undefined) continue // unreachable: gated by the missing-paths check
        compiler.mapShadow(entry.path, data)
      }
      shadowDigests.set(entry.path, entry.digest)
    }

    const result = await compileAndRenderVectorLocked(
      request.mainFilePath,
      request.options,
      totalStart,
    )
    return { kind: 'result' as const, result }
  })
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
): Promise<PdfCompileResult> {
  return enqueueCompilerOperation(async () => {
    if (!compiler) {
      throw new Error('Compiler not initialized')
    }

    compiler.resetShadow()
    // Wholesale rewrite without digests: incremental state is now unknown.
    shadowDigests.clear()
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

    const { result, diagnostics } = await compiler.compile({
      mainFilePath,
      root: PROJECT_ROOT,
      format: 1,
      diagnostics: 'full',
    })

    return {
      pdf: result ?? null,
      diagnostics: normalizeDiagnostics(diagnostics),
    }
  })
}

export async function ensurePackagesForCompileBackend(specs: string[]): Promise<void> {
  await ensurePackagesForCompileRegistry(specs)
}
