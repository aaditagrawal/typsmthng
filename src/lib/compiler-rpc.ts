import type {
  CompileOptions, CompileResult, IncrementalCompileRequest, IncrementalCompileResponse, PdfCompileResult,
} from './compiler-backend'

export interface CompilerWorkerApi {
  initCompiler: (options?: { fontData?: Uint8Array[] }) => Promise<void>
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
  isCompilerReady: () => boolean | Promise<boolean>
}

const channel = 'typsmthng-compiler-v1'
interface Endpoint {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

interface Request {
  channel: typeof channel
  id: number
  method: keyof CompilerWorkerApi
  args: unknown[]
}
type Reply = { channel: typeof channel; id: number } & (
  { ok: true; value: unknown } | { ok: false; error: unknown; isError: boolean }
)

/** Requests use structured cloning, retaining ownership of all caller buffers. */
export function connectCompilerWorker(endpoint: Endpoint): { api: CompilerWorkerApi; dispose: (error: Error) => void } {
  let nextId = 0
  let closed: Error | undefined
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  const onMessage = ({ data }: MessageEvent<Reply>) => {
    if (!data || data.channel !== channel) return
    const call = pending.get(data.id)
    if (!call) return
    pending.delete(data.id)
    if (data.ok) call.resolve(data.value)
    else if (data.isError) {
      const details = data.error as { name: string; message: string; stack?: string }
      const error = new Error(details.message)
      error.name = details.name
      error.stack = details.stack
      call.reject(error)
    } else call.reject(data.error)
  }
  endpoint.addEventListener('message', onMessage)
  const call = <K extends keyof CompilerWorkerApi>(method: K, args: Parameters<CompilerWorkerApi[K]>): Promise<Awaited<ReturnType<CompilerWorkerApi[K]>>> => {
    if (closed) return Promise.reject(closed)
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        endpoint.postMessage({ channel, id, method, args } satisfies Request)
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  }
  return {
    api: {
      initCompiler: (...args) => call('initCompiler', args),
      compileTypst: (...args) => call('compileTypst', args),
      compileTypstIncremental: (...args) => call('compileTypstIncremental', args),
      resolveSourceLoc: (...args) => call('resolveSourceLoc', args),
      resolveSourceLocBatch: (...args) => call('resolveSourceLocBatch', args),
      compileToPdf: (...args) => call('compileToPdf', args),
      ensurePackagesForCompile: (...args) => call('ensurePackagesForCompile', args),
      isCompilerReady: () => call('isCompilerReady', []),
    },
    dispose: (error) => {
      closed = error
      endpoint.removeEventListener('message', onMessage)
      pending.forEach((call) => call.reject(error))
      pending.clear()
    },
  }
}

/** Exposes only own methods in the finite compiler API, never object traversal. */
export function exposeCompilerWorker(api: CompilerWorkerApi, endpoint: Endpoint): () => void {
  const onMessage = async ({ data }: MessageEvent<Request>) => {
    if (!data || data.channel !== channel || !Number.isSafeInteger(data.id) || !Array.isArray(data.args)) return
    try {
      if (!Object.hasOwn(api, data.method) || typeof api[data.method] !== 'function') throw new Error('Unknown compiler method')
      const method = api[data.method] as (...args: unknown[]) => unknown
      const value = await method(...data.args)
      endpoint.postMessage({ channel, id: data.id, ok: true, value } satisfies Reply)
    } catch (error) {
      endpoint.postMessage({
        channel, id: data.id, ok: false,
        isError: error instanceof Error,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      } satisfies Reply)
    }
  }
  endpoint.addEventListener('message', onMessage)
  return () => endpoint.removeEventListener('message', onMessage)
}
