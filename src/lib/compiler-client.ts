import { wrap } from 'comlink'
import type { Remote } from 'comlink'
import { useCompileStore } from '@/stores/compile-store'
import { useSettingsStore } from '@/stores/settings-store'
import { loadDeclaredFontData } from './declared-fonts'
import { computeContentDigest } from './compile-inputs'
import {
  compileToPdfBackend,
  compileTypstBackend,
  configureCompilerBackend,
  ensurePackagesForCompileBackend,
  initCompilerBackend,
  isCompilerReadyBackend,
  resolveSourceLocBackend,
  resolveSourceLocBatchBackend,
  type CompileManifestEntry,
  type CompileOptions,
  type CompileResult,
  type IncrementalCompileRequest,
  type IncrementalCompileResponse,
  type PdfCompileResult,
} from './compiler-backend'

interface CompilerInitOptions {
  fontData?: Uint8Array[]
}

interface CompilerWorkerApi {
  initCompiler: (options?: CompilerInitOptions) => Promise<void>
  compileTypst: (
    source: string,
    extraFiles?: Array<{ path: string; content: string }>,
    mainFilePath?: string,
    extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
    options?: CompileOptions,
  ) => Promise<CompileResult>
  compileTypstIncremental: (request: IncrementalCompileRequest) => Promise<IncrementalCompileResponse>
  resolveSourceLoc: (vectorData: Uint8Array, path: Uint32Array) => Promise<string | undefined>
  resolveSourceLocBatch: (vectorData: Uint8Array, paths: Uint32Array[]) => Promise<Array<string | undefined>>
  compileToPdf: (
    source: string,
    extraFiles?: Array<{ path: string; content: string }>,
    mainFilePath?: string,
    extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
  ) => Promise<PdfCompileResult>
  ensurePackagesForCompile: (specs: string[]) => Promise<void>
  isCompilerReady: () => boolean
}

/**
 * Marks a call that died with its worker. Comlink has no rejection path for a
 * dead endpoint, so these are raised by racing against a per-worker deferred.
 */
class WorkerTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerTransportError'
  }
}

interface WorkerTransport {
  worker: Worker
  api: Remote<CompilerWorkerApi>
  /** Rejects with WorkerTransportError when this worker instance is torn down. */
  terminated: Promise<never>
  rejectTerminated: (err: WorkerTransportError) => void
  /** In-worker compiler init for this worker instance; reset on failure so it can retry. */
  initPromise: Promise<void> | null
  /**
   * path -> digest of what this worker instance is believed to have shadowed
   * (last successful incremental sync). Worker restarts create a fresh
   * transport, so a compiler generation bump automatically forces a full
   * resync of the new worker's empty VFS.
   */
  syncedDigests: Map<string, string>
}

const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3

let transport: WorkerTransport | null = null
let workerAvailable = typeof Worker !== 'undefined'
let consecutiveTransportFailures = 0
let compilerReady = false
let backendInitPromise: Promise<void> | null = null
let clientInitPromise: Promise<void> | null = null
let currentCompilerConfigKey = ''
let currentFontData: Uint8Array[] = []
/** Bumped whenever font config is swapped so in-flight client inits can detect staleness. */
let clientConfigGeneration = 0
/** Serializes config application so concurrent compiles cannot interleave font swaps. */
let configChain: Promise<void> = Promise.resolve()

function resetWorkerTransport(reason = 'Compiler worker was terminated'): void {
  const active = transport
  transport = null
  if (!active) return

  active.worker.terminate()
  active.rejectTerminated(new WorkerTransportError(reason))
  compilerReady = false
  // Worker-local state (prepared package map, compiler shadow) is gone; let
  // per-worker caches elsewhere invalidate themselves.
  useCompileStore.getState().bumpCompilerGeneration()
}

function ensureCompilerConfig(
  source?: string,
  extraFiles?: Array<{ path: string; content: string }>,
): Promise<void> {
  const run = configChain.then(() => applyCompilerConfig(source, extraFiles))
  configChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function applyCompilerConfig(
  source?: string,
  extraFiles?: Array<{ path: string; content: string }>,
): Promise<void> {
  const { systemFontsEnabled, googleFontsEnabled } = useSettingsStore.getState()
  const generationAtStart = clientConfigGeneration
  const { key, data } = source
    ? await loadDeclaredFontData(source, extraFiles, {
      systemFontsEnabled,
      googleFontsEnabled,
    })
    : { key: '', data: [] as Uint8Array[] }

  // Config was swapped while fonts were loading; discard this computation.
  if (generationAtStart !== clientConfigGeneration) return
  if (key === currentCompilerConfigKey) return

  currentCompilerConfigKey = key
  currentFontData = data
  compilerReady = false
  clientConfigGeneration += 1
  backendInitPromise = null
  configureCompilerBackend({ fontData: currentFontData })
  resetWorkerTransport('Compiler font configuration changed')
}

function shouldDisableWorker(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('typst_worker_disabled') === '1'
  } catch {
    return false
  }
}

function describeWorkerFailure(event: Event): string {
  if (typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent && event.message) {
    return event.message
  }
  return event.type
}

function getWorkerTransport(): WorkerTransport | null {
  if (!workerAvailable || shouldDisableWorker()) return null
  if (transport) return transport

  try {
    const worker = new Worker(new URL('../workers/typst-worker.ts', import.meta.url), { type: 'module' })
    let rejectTerminated!: (err: WorkerTransportError) => void
    const terminated = new Promise<never>((_, reject) => {
      rejectTerminated = reject
    })
    // Avoid an unhandled rejection when no call is racing at teardown time.
    terminated.catch(() => undefined)

    const instance: WorkerTransport = {
      worker,
      api: wrap<CompilerWorkerApi>(worker),
      terminated,
      rejectTerminated,
      initPromise: null,
      syncedDigests: new Map(),
    }

    const onTransportFailure = (event: Event): void => {
      if (transport !== instance) return
      resetWorkerTransport(`Compiler worker failed: ${describeWorkerFailure(event)}`)
    }
    worker.addEventListener('error', onTransportFailure)
    worker.addEventListener('messageerror', onTransportFailure)

    transport = instance
    return instance
  } catch (err) {
    console.warn('Falling back to main-thread compiler (worker init failed):', err)
    workerAvailable = false
    transport = null
    return null
  }
}

function initWorkerTransport(active: WorkerTransport): Promise<void> {
  if (!active.initPromise) {
    const pending: Promise<void> = active.api
      .initCompiler({ fontData: currentFontData })
      .catch((err: unknown) => {
        if (active.initPromise === pending) {
          active.initPromise = null
        }
        throw err
      })
    active.initPromise = pending
  }
  return active.initPromise
}

async function ensureBackendInitialized(): Promise<void> {
  if (isCompilerReadyBackend()) return
  if (!backendInitPromise) {
    backendInitPromise = initCompilerBackend().catch((err) => {
      backendInitPromise = null
      throw err
    })
  }
  await backendInitPromise
}

async function callWithFallback<T>(
  runWorker: (active: WorkerTransport) => Promise<T>,
  runFallback: () => Promise<T>,
): Promise<T> {
  const active = getWorkerTransport()
  if (!active) return runFallback()

  try {
    const result = await Promise.race([runWorker(active), active.terminated])
    consecutiveTransportFailures = 0
    return result
  } catch (err) {
    // Application errors (compile panics, bad input) must surface to the
    // caller instead of silently rerunning heavy work on the main thread.
    if (!(err instanceof WorkerTransportError)) throw err

    console.warn('Worker compiler transport failed, using fallback path:', err)
    if (transport === active) {
      resetWorkerTransport(err.message)
    }
    consecutiveTransportFailures += 1
    if (consecutiveTransportFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
      console.warn('Compiler worker keeps dying; staying on the main-thread compiler.')
      workerAvailable = false
    }
    return runFallback()
  }
}

async function callWithCompilerFallback<T>(
  runWorker: (api: Remote<CompilerWorkerApi>) => Promise<T>,
  runFallback: () => Promise<T>,
): Promise<T> {
  return callWithFallback(
    async (active) => {
      await initWorkerTransport(active)
      return runWorker(active.api)
    },
    async () => {
      await ensureBackendInitialized()
      return runFallback()
    },
  )
}

export async function initCompilerClient(
  source?: string,
  extraFiles?: Array<{ path: string; content: string }>,
): Promise<void> {
  if (source) {
    await ensureCompilerConfig(source, extraFiles)
  }

  while (!compilerReady) {
    const generationAtWait = clientConfigGeneration

    if (!clientInitPromise) {
      const generation = clientConfigGeneration

      const pendingRef: { current: Promise<void> | null } = { current: null }
      pendingRef.current = (async () => {
        try {
          await callWithFallback(
            (active) => initWorkerTransport(active),
            () => ensureBackendInitialized(),
          )
          if (generation === clientConfigGeneration) {
            compilerReady = true
          }
        } catch (err) {
          if (generation === clientConfigGeneration) {
            compilerReady = false
          }
          throw err
        } finally {
          if (clientInitPromise === pendingRef.current) {
            clientInitPromise = null
          }
        }
      })()

      clientInitPromise = pendingRef.current
    }

    try {
      await clientInitPromise
    } catch (err) {
      if (compilerReady) return
      if (clientConfigGeneration !== generationAtWait) continue
      throw err
    }

    if (!compilerReady) continue
  }
}

async function ensurePackagesOnMainForFallback(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
): Promise<void> {
  // Worker ensure only fills the worker's in-memory prepared map. On fallback,
  // re-prepare on the main-thread registry before compiling.
  const { findPreviewImportSpecs } = await import('./universe-registry')
  const specs = new Set<string>(findPreviewImportSpecs(source))
  for (const file of extraFiles ?? []) {
    for (const spec of findPreviewImportSpecs(file.content)) {
      specs.add(spec)
    }
  }
  if (specs.size === 0) return
  await ensurePackagesForCompileBackend([...specs])
}

/**
 * Stable identity tokens for binary buffers. Binary content never needs
 * hashing: project buffers are immutable in practice — a changed asset is a
 * new Uint8Array, which gets a new token.
 */
const binaryIdentityTokens = new WeakMap<Uint8Array, number>()
let nextBinaryIdentityToken = 1

function binaryDigest(data: Uint8Array): string {
  let token = binaryIdentityTokens.get(data)
  if (token === undefined) {
    token = nextBinaryIdentityToken
    nextBinaryIdentityToken += 1
    binaryIdentityTokens.set(data, token)
  }
  return `bin:${token}:${data.byteLength}`
}

/**
 * Incremental worker compile: send the full path -> digest manifest but only
 * the payloads this transport hasn't successfully synced yet. If the worker's
 * actual VFS state disagrees with our belief it answers `needs-sync` without
 * applying anything, and we retry with the requested payloads (attempt 2) or
 * everything (attempt 3, which by construction cannot be refused).
 */
async function compileIncrementalOnWorker(
  active: WorkerTransport,
  source: string,
  extraFiles: Array<{ path: string; content: string }> | undefined,
  mainFilePath: string,
  extraBinaryFiles: Array<{ path: string; data: Uint8Array }> | undefined,
  options?: CompileOptions,
): Promise<CompileResult> {
  // Later entries win on duplicate paths, matching the legacy add order
  // (main, then extra text files, then binaries).
  const textByPath = new Map<string, string>()
  textByPath.set(mainFilePath, source)
  for (const file of extraFiles ?? []) {
    textByPath.set(file.path, file.content)
  }
  const binaryByPath = new Map<string, Uint8Array>()
  for (const file of extraBinaryFiles ?? []) {
    binaryByPath.set(file.path, file.data)
    textByPath.delete(file.path)
  }

  const manifest: CompileManifestEntry[] = []
  for (const [path, content] of textByPath) {
    manifest.push({ path, digest: computeContentDigest(content) })
  }
  for (const [path, data] of binaryByPath) {
    manifest.push({ path, digest: binaryDigest(data) })
  }

  const forcedPaths = new Set<string>()
  for (let attempt = 0; attempt < 3; attempt++) {
    const sendEverything = attempt === 2
    const textPayloads: IncrementalCompileRequest['textPayloads'] = []
    const binaryPayloads: IncrementalCompileRequest['binaryPayloads'] = []

    for (const entry of manifest) {
      const synced = active.syncedDigests.get(entry.path)
      if (!sendEverything && synced === entry.digest && !forcedPaths.has(entry.path)) continue
      const content = textByPath.get(entry.path)
      if (content !== undefined) {
        textPayloads.push({ path: entry.path, content })
      } else {
        const data = binaryByPath.get(entry.path)
        if (data !== undefined) {
          binaryPayloads.push({ path: entry.path, data })
        }
      }
    }

    const response = await active.api.compileTypstIncremental({
      mainFilePath,
      manifest,
      textPayloads,
      binaryPayloads,
      options,
    })

    if (response.kind === 'needs-sync') {
      // Our belief was stale (e.g. a wholesale PDF export reset the worker
      // shadow between compiles). Nothing was applied; retry with payloads
      // for everything the worker asked for.
      for (const path of response.missingPaths) {
        forcedPaths.add(path)
      }
      continue
    }

    // The worker's VFS now matches the manifest exactly.
    active.syncedDigests.clear()
    for (const entry of manifest) {
      active.syncedDigests.set(entry.path, entry.digest)
    }
    return response.result
  }

  // Unreachable: the send-everything attempt provides a payload for every
  // manifest entry, so the worker cannot report anything missing.
  throw new Error('Compiler worker refused a full VFS resync')
}

export async function compileTypstClient(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
  options?: CompileOptions,
): Promise<CompileResult> {
  await initCompilerClient(source, extraFiles)

  return callWithFallback(
    async (active) => {
      await initWorkerTransport(active)
      return compileIncrementalOnWorker(
        active,
        source,
        extraFiles,
        mainFilePath,
        extraBinaryFiles,
        options,
      )
    },
    async () => {
      await ensureBackendInitialized()
      await ensurePackagesOnMainForFallback(source, extraFiles)
      return compileTypstBackend(source, extraFiles, mainFilePath, extraBinaryFiles, options)
    },
  )
}

export async function resolveSourceLocClient(
  vectorData: Uint8Array,
  path: Uint32Array,
): Promise<string | undefined> {
  return callWithCompilerFallback(
    (api) => api.resolveSourceLoc(vectorData, path),
    () => resolveSourceLocBackend(vectorData, path),
  )
}

export async function resolveSourceLocBatchClient(
  vectorData: Uint8Array,
  paths: Uint32Array[],
): Promise<Array<string | undefined>> {
  return callWithCompilerFallback(
    (api) => api.resolveSourceLocBatch(vectorData, paths),
    () => resolveSourceLocBatchBackend(vectorData, paths),
  )
}

export async function compileToPdfClient(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
): Promise<PdfCompileResult> {
  await initCompilerClient(source, extraFiles)

  return callWithFallback(
    async (active) => {
      await initWorkerTransport(active)
      const result = await active.api.compileToPdf(source, extraFiles, mainFilePath, extraBinaryFiles)
      // PDF export rewrites the worker shadow wholesale (no digests), so our
      // incremental belief is stale; force a proactive full sync next compile.
      active.syncedDigests.clear()
      return result
    },
    async () => {
      await ensureBackendInitialized()
      await ensurePackagesOnMainForFallback(source, extraFiles)
      return compileToPdfBackend(source, extraFiles, mainFilePath, extraBinaryFiles)
    },
  )
}

export async function ensurePackagesForCompileClient(specs: string[]): Promise<void> {
  await callWithFallback(
    (active) => active.api.ensurePackagesForCompile(specs),
    () => ensurePackagesForCompileBackend(specs),
  )
}

export function isCompilerReadyClient(): boolean {
  return compilerReady || isCompilerReadyBackend()
}
