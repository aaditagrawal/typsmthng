import type {
  IncrementalCompileRequest,
  IncrementalCompileResponse,
  PdfCompileResult,
} from './compiler-backend'

export interface CompilerWorkerApi {
  initCompiler(options?: { fontData?: Uint8Array[] }): Promise<void>
  compileTypstIncremental(request: IncrementalCompileRequest): Promise<IncrementalCompileResponse>
  resolveSourceLocBatch(vectorData: Uint8Array, paths: Uint32Array[]): Promise<Array<string | undefined>>
  compileToPdf(
    source: string,
    extraFiles?: Array<{ path: string; content: string }>,
    mainFilePath?: string,
    extraBinaryFiles?: Array<{ path: string; data: Uint8Array }>,
  ): Promise<PdfCompileResult>
  ensurePackagesForCompile(specs: string[]): Promise<void>
}

type Method = keyof CompilerWorkerApi
type Response = { id: number } & (
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; message: string; stack?: string } }
)

interface Endpoint {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/** Only the compiler's five async methods, not a general object/proxy protocol. */
export function createCompilerWorkerClient(endpoint: Endpoint): {
  api: CompilerWorkerApi
  dispose(reason: Error): void
} {
  let nextId = 0
  let closed: Error | undefined
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const onMessage = ({ data }: MessageEvent<Response>) => {
    const call = pending.get(data.id)
    if (!call) return
    pending.delete(data.id)
    if (data.ok) call.resolve(data.value)
    else {
      const error = new Error(data.error.message)
      error.name = data.error.name
      error.stack = data.error.stack
      call.reject(error)
    }
  }
  endpoint.addEventListener('message', onMessage)

  function call<M extends Method>(method: M, ...args: Parameters<CompilerWorkerApi[M]>): ReturnType<CompilerWorkerApi[M]> {
    const promise = new Promise<unknown>((resolve, reject) => {
      if (closed) return reject(closed)
      const id = ++nextId
      pending.set(id, { resolve, reject })
      try {
        // Inputs belong to the project/preview stores: never detach them.
        endpoint.postMessage({ id, method, args }, [])
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
    return promise as ReturnType<CompilerWorkerApi[M]>
  }

  return {
    api: {
      initCompiler: (...args) => call('initCompiler', ...args),
      compileTypstIncremental: (...args) => call('compileTypstIncremental', ...args),
      resolveSourceLocBatch: (...args) => call('resolveSourceLocBatch', ...args),
      compileToPdf: (...args) => call('compileToPdf', ...args),
      ensurePackagesForCompile: (...args) => call('ensurePackagesForCompile', ...args),
    },
    dispose(reason) {
      closed = reason
      endpoint.removeEventListener('message', onMessage)
      for (const call of pending.values()) call.reject(reason)
      pending.clear()
    },
  }
}

export function exposeCompilerWorker(api: CompilerWorkerApi, endpoint: Endpoint): void {
  endpoint.addEventListener('message', async ({ data }: MessageEvent<{
    id: number
    method: Method
    args: unknown[]
  }>) => {
    const { id, method, args } = data
    try {
      if (!Object.hasOwn(api, method)) throw new Error(`Unknown compiler method: ${method}`)
      const value: unknown = await (api[method] as (...args: unknown[]) => Promise<unknown>)(...args)
      let bytes: Uint8Array | null | undefined
      if (method === 'compileTypstIncremental') {
        const response = value as IncrementalCompileResponse
        if (response.kind === 'result') bytes = response.result.vectorData
      } else if (method === 'compileToPdf') {
        bytes = (value as PdfCompileResult).pdf
      }
      // Compiler bindings return owned JS copies, not views into WASM memory.
      // The backend finishes rendering before returning and retains neither.
      endpoint.postMessage({ id, ok: true, value }, bytes ? [bytes.buffer as ArrayBuffer] : [])
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      endpoint.postMessage({ id, ok: false, error: {
        name: error.name, message: error.message, stack: error.stack,
      } }, [])
    }
  })
}
