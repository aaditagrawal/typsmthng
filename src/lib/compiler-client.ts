import { wrap } from 'comlink'
import type { Remote } from 'comlink'
import { useSettingsStore } from '@/stores/settings-store'
import { loadDeclaredFontData } from './declared-fonts'
import {
  compileToPdfBackend,
  compileTypstBackend,
  configureCompilerBackend,
  ensurePackagesForCompileBackend,
  initCompilerBackend,
  isCompilerReadyBackend,
  resolveSourceLocBackend,
  resolveSourceLocBatchBackend,
  type CompileResult,
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
  ) => Promise<CompileResult>
  resolveSourceLoc: (vectorData: Uint8Array, path: Uint32Array) => Promise<string | undefined>
  resolveSourceLocBatch: (vectorData: Uint8Array, paths: Uint32Array[]) => Promise<Array<string | undefined>>
  compileToPdf: (
    source: string,
    extraFiles?: Array<{ path: string; content: string }>,
    mainFilePath?: string,
    extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
  ) => Promise<Uint8Array | null>
  ensurePackagesForCompile: (specs: string[]) => Promise<void>
  isCompilerReady: () => boolean
}

let worker: Worker | null = null
let workerApi: Remote<CompilerWorkerApi> | null = null
let workerAvailable = typeof Worker !== 'undefined'
let compilerReady = false
let backendInitPromise: Promise<void> | null = null
let clientInitPromise: Promise<void> | null = null
let currentCompilerConfigKey = ''
let currentFontData: Uint8Array[] = []
/** Bumped whenever font config is swapped so in-flight client inits can detect staleness. */
let clientConfigGeneration = 0

function resetWorkerTransport(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  workerApi = null
}

async function ensureCompilerConfig(
  source?: string,
  extraFiles?: Array<{ path: string; content: string }>,
): Promise<void> {
  const { systemFontsEnabled, googleFontsEnabled } = useSettingsStore.getState()
  const { key, data } = source
    ? await loadDeclaredFontData(source, extraFiles, {
      systemFontsEnabled,
      googleFontsEnabled,
    })
    : { key: '', data: [] as Uint8Array[] }

  if (key === currentCompilerConfigKey) return

  currentCompilerConfigKey = key
  currentFontData = data
  compilerReady = false
  clientConfigGeneration += 1
  backendInitPromise = null
  configureCompilerBackend({ fontData: currentFontData })
  resetWorkerTransport()
}

function shouldDisableWorker(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('typst_worker_disabled') === '1'
  } catch {
    return false
  }
}

async function getWorkerApi(): Promise<Remote<CompilerWorkerApi> | null> {
  if (!workerAvailable || shouldDisableWorker()) return null
  if (workerApi) return workerApi

  try {
    worker = new Worker(new URL('../workers/typst-worker.ts', import.meta.url), { type: 'module' })
    workerApi = wrap<CompilerWorkerApi>(worker)
    return workerApi
  } catch (err) {
    console.warn('Falling back to main-thread compiler (worker init failed):', err)
    workerAvailable = false
    if (worker) {
      worker.terminate()
      worker = null
    }
    workerApi = null
    return null
  }
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
  runWorker: (api: Remote<CompilerWorkerApi>) => Promise<T>,
  runFallback: () => Promise<T>,
): Promise<T> {
  const api = await getWorkerApi()
  if (!api) return runFallback()

  try {
    return await runWorker(api)
  } catch (err) {
    console.warn('Worker compiler call failed, using fallback path:', err)
    workerAvailable = false
    if (worker) {
      worker.terminate()
      worker = null
    }
    workerApi = null
    return runFallback()
  }
}

async function callWithCompilerFallback<T>(
  runWorker: (api: Remote<CompilerWorkerApi>) => Promise<T>,
  runFallback: () => Promise<T>,
): Promise<T> {
  return callWithFallback(runWorker, async () => {
    await ensureBackendInitialized()
    return runFallback()
  })
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
      const fontsForInit = currentFontData

      const pending = (async () => {
        try {
          await callWithFallback(
            async (api) => {
              await api.initCompiler({ fontData: fontsForInit })
            },
            async () => {
              await ensureBackendInitialized()
            },
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
          if (clientInitPromise === pending) {
            clientInitPromise = null
          }
        }
      })()

      clientInitPromise = pending
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

export async function compileTypstClient(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
  mainFilePath = '/main.typ',
  extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
): Promise<CompileResult> {
  await ensureCompilerConfig(source, extraFiles)
  if (!compilerReady) {
    await initCompilerClient(source, extraFiles)
  }

  return callWithCompilerFallback(
    (api) => api.compileTypst(source, extraFiles, mainFilePath, extraBinaryFiles),
    () => compileTypstBackend(source, extraFiles, mainFilePath, extraBinaryFiles),
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
): Promise<Uint8Array | null> {
  await ensureCompilerConfig(source, extraFiles)
  if (!compilerReady) {
    await initCompilerClient(source, extraFiles)
  }

  return callWithCompilerFallback(
    (api) => api.compileToPdf(source, extraFiles, mainFilePath, extraBinaryFiles),
    () => compileToPdfBackend(source, extraFiles, mainFilePath, extraBinaryFiles),
  )
}

export async function ensurePackagesForCompileClient(specs: string[]): Promise<void> {
  await callWithFallback(
    (api) => api.ensurePackagesForCompile(specs),
    () => ensurePackagesForCompileBackend(specs),
  )
}

export function isCompilerReadyClient(): boolean {
  return compilerReady || isCompilerReadyBackend()
}
