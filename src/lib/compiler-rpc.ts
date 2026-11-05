import type { CompileOptions, CompileResult, PdfCompileResult } from './compiler-backend'

export interface CompilerWorkerApi {
  initCompiler: (options?: { fontData?: Uint8Array[] }) => Promise<void>
  compileTypst: (
    source: string,
    extraFiles?: Array<{ path: string; content: string }>,
    mainFilePath?: string,
    extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
    options?: CompileOptions,
  ) => Promise<CompileResult>
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

type Method = keyof CompilerWorkerApi
type Request = { [K in Method]: { channel: 'typst-compiler'; id: number; method: K; args: Parameters<CompilerWorkerApi[K]> } }[Method]
type Failure = { kind: 'error'; name: string; message: string; stack?: string } | { kind: 'value'; value: unknown }
type Response = { channel: 'typst-compiler'; id: number } & (
  { ok: true; value: unknown } | { ok: false; error: Failure }
)

export interface CompilerEndpoint {
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

export interface CompilerRpc {
  call<K extends Method>(method: K, ...args: Parameters<CompilerWorkerApi[K]>): Promise<Awaited<ReturnType<CompilerWorkerApi[K]>>>
  dispose: (error: WorkerTransportError) => void
}

/** Only the finite compiler API crosses this boundary; buffers remain owned by callers. */
export function createCompilerRpc(endpoint: CompilerEndpoint): CompilerRpc {
  let nextId = 0
  let closed: WorkerTransportError | undefined
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  const onMessage = ({ data }: MessageEvent<Response>) => {
    if (data?.channel !== 'typst-compiler') return
    const call = pending.get(data.id)
    if (!call) return
    pending.delete(data.id)
    if (data.ok) {
      call.resolve(data.value)
    } else if (data.error.kind === 'value') {
      call.reject(data.error.value)
    } else {
      const error = new Error(data.error.message)
      error.name = data.error.name
      error.stack = data.error.stack
      call.reject(error)
    }
  }
  endpoint.addEventListener('message', onMessage)

  return {
    call<K extends Method>(method: K, ...args: Parameters<CompilerWorkerApi[K]>): Promise<Awaited<ReturnType<CompilerWorkerApi[K]>>> {
      if (closed) return Promise.reject(closed)
      const id = ++nextId
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: value => resolve(value as Awaited<ReturnType<CompilerWorkerApi[K]>>), reject })
        try {
          endpoint.postMessage({ channel: 'typst-compiler', id, method, args })
        } catch (error) {
          pending.delete(id)
          // Invalid arguments are application errors. A broken endpoint triggers fallback.
          reject(error && typeof error === 'object' && 'name' in error && error.name === 'DataCloneError'
            ? error
            : new WorkerTransportError(error instanceof Error ? error.message : String(error)))
        }
      })
    },
    dispose(error) {
      closed = error
      endpoint.removeEventListener('message', onMessage)
      for (const call of pending.values()) call.reject(error)
      pending.clear()
    },
  }
}

function invoke(api: CompilerWorkerApi, request: Request): unknown {
  // An explicit dispatch also prevents messages from invoking inherited properties.
  switch (request.method) {
    case 'initCompiler': return api.initCompiler(...request.args)
    case 'compileTypst': return api.compileTypst(...request.args)
    case 'resolveSourceLoc': return api.resolveSourceLoc(...request.args)
    case 'resolveSourceLocBatch': return api.resolveSourceLocBatch(...request.args)
    case 'compileToPdf': return api.compileToPdf(...request.args)
    case 'ensurePackagesForCompile': return api.ensurePackagesForCompile(...request.args)
    case 'isCompilerReady': return api.isCompilerReady(...request.args)
    default: throw new Error('Unknown compiler method')
  }
}

export function exposeCompilerRpc(endpoint: CompilerEndpoint, api: CompilerWorkerApi): () => void {
  const onMessage = async ({ data }: MessageEvent<Request>) => {
    if (data?.channel !== 'typst-compiler' || !Number.isSafeInteger(data.id) || !Array.isArray(data.args)) return
    const reply = (response: Response) => endpoint.postMessage(response)
    try {
      const value = await invoke(api, data)
      reply({ channel: 'typst-compiler', id: data.id, ok: true, value })
    } catch (error) {
      reply({
        channel: 'typst-compiler', id: data.id, ok: false,
        error: error instanceof Error
          ? { kind: 'error', name: error.name, message: error.message, stack: error.stack }
          : { kind: 'value', value: error },
      })
    }
  }
  endpoint.addEventListener('message', onMessage)
  return () => endpoint.removeEventListener('message', onMessage)
}
