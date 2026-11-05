import type {
  CompileOptions,
  CompileResult,
  IncrementalCompileRequest,
  IncrementalCompileResponse,
  PdfCompileResult,
} from './compiler-backend'

interface CompilerInitOptions {
  fontData?: Uint8Array[]
}

export interface CompilerWorkerApi {
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

export type CompilerRemoteApi = {
  [Method in keyof CompilerWorkerApi]: (...args: Parameters<CompilerWorkerApi[Method]>) => Promise<Awaited<ReturnType<CompilerWorkerApi[Method]>>>
}

type Method = keyof CompilerWorkerApi
const methods = new Set<Method>([
  'initCompiler', 'compileTypst', 'compileTypstIncremental', 'resolveSourceLoc',
  'resolveSourceLocBatch', 'compileToPdf', 'ensurePackagesForCompile', 'isCompilerReady',
])
const PROTOCOL = 'typsmthng-compiler-v1'

interface Endpoint {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

export class WorkerTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerTransportError'
  }
}

function isEnvelope(value: unknown): value is Record<string, unknown> & { id: number } {
  return typeof value === 'object' && value !== null
    && 'protocol' in value && value.protocol === PROTOCOL
    && 'id' in value && typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0
}

/** Fixed compiler calls only. Buffers are cloned, so live project data is never detached. */
export function createCompilerRpcClient(endpoint: Endpoint) {
  let nextId = 1
  let disposed: WorkerTransportError | undefined
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  const onMessage = ({ data }: MessageEvent<unknown>) => {
    if (!isEnvelope(data) || data.kind !== 'reply') return
    const call = pending.get(data.id)
    if (!call) return
    if (data.ok === true) {
      pending.delete(data.id)
      call.resolve(data.value)
    } else if (data.ok === false && data.errorKind === 'value') {
      pending.delete(data.id)
      call.reject(data.value)
    } else if (data.ok === false && typeof data.error === 'object' && data.error !== null) {
      const errorData = data.error
      if (!('message' in errorData) || typeof errorData.message !== 'string'
        || !('name' in errorData) || typeof errorData.name !== 'string') return
      const error = new Error(errorData.message)
      error.name = errorData.name
      if ('stack' in errorData && typeof errorData.stack === 'string') error.stack = errorData.stack
      pending.delete(data.id)
      call.reject(error)
    }
  }
  endpoint.addEventListener('message', onMessage)

  function call<M extends Method>(method: M, args: Parameters<CompilerWorkerApi[M]>): ReturnType<CompilerRemoteApi[M]> {
    const promise = new Promise<unknown>((resolve, reject) => {
      if (disposed) { reject(disposed); return }
      const id = nextId++
      pending.set(id, { resolve, reject })
      try {
        endpoint.postMessage({ protocol: PROTOCOL, kind: 'call', id, method, args })
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
    // Method and arguments are paired above; the wire reply supplies its corresponding result.
    return promise as ReturnType<CompilerRemoteApi[M]>
  }

  const api: CompilerRemoteApi = {
    initCompiler: (...args) => call('initCompiler', args),
    compileTypst: (...args) => call('compileTypst', args),
    compileTypstIncremental: (...args) => call('compileTypstIncremental', args),
    resolveSourceLoc: (...args) => call('resolveSourceLoc', args),
    resolveSourceLocBatch: (...args) => call('resolveSourceLocBatch', args),
    compileToPdf: (...args) => call('compileToPdf', args),
    ensurePackagesForCompile: (...args) => call('ensurePackagesForCompile', args),
    isCompilerReady: (...args) => call('isCompilerReady', args),
  }

  return {
    api,
    dispose(reason: WorkerTransportError) {
      disposed = reason
      endpoint.removeEventListener('message', onMessage)
      for (const call of pending.values()) call.reject(reason)
      pending.clear()
    },
  }
}

export function exposeCompilerRpc(api: CompilerWorkerApi, endpoint: Endpoint): () => void {
  const onMessage = async ({ data }: MessageEvent<unknown>) => {
    if (!isEnvelope(data) || data.kind !== 'call') return
    const reply = { protocol: PROTOCOL, kind: 'reply', id: data.id }
    try {
      if (typeof data.method !== 'string' || !methods.has(data.method as Method) || !Array.isArray(data.args)) {
        throw new TypeError('Unknown compiler worker method or invalid arguments')
      }
      const result = await Reflect.apply(api[data.method as Method], api, data.args)
      endpoint.postMessage({ ...reply, ok: true, value: result })
    } catch (error) {
      const failure = error instanceof Error
        ? { ...reply, ok: false, error: { name: error.name, message: error.message, stack: error.stack } }
        : { ...reply, ok: false, errorKind: 'value', value: error }
      try {
        endpoint.postMessage(failure)
      } catch {
        endpoint.postMessage({ ...reply, ok: false, error: { name: 'DataCloneError', message: 'Compiler worker error could not be cloned' } })
      }
    }
  }
  endpoint.addEventListener('message', onMessage)
  return () => endpoint.removeEventListener('message', onMessage)
}
