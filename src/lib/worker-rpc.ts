export interface MessageEndpoint {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

type Arguments<T> = T extends (...args: infer A) => unknown ? A : never
type Result<T> = T extends (...args: never[]) => infer R ? Awaited<R> : never
const protocol = 'typsmthng-rpc'

export class WorkerTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerTransportError'
  }
}

export function createWorkerRpc<Api>(endpoint: MessageEndpoint) {
  let nextId = 0
  let closed: WorkerTransportError | undefined
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: unknown) => void }>()
  const onMessage = ({ data }: MessageEvent) => {
    if (!data || data.protocol !== protocol || data.kind !== 'reply') return
    const call = pending.get(data.id)
    if (!call) return
    pending.delete(data.id)
    if (data.failed && data.error) {
      const error = new Error(data.error.message)
      error.name = data.error.name
      error.stack = data.error.stack
      call.reject(error)
    } else if (data.failed) {
      call.reject(data.thrown)
    } else {
      call.resolve(data.result)
    }
  }
  endpoint.addEventListener('message', onMessage)
  return {
    call<K extends keyof Api>(method: K, ...args: Arguments<Api[K]>): Promise<Result<Api[K]>> {
      return new Promise((resolve, reject) => {
        if (closed) return reject(closed)
        const id = nextId++
        pending.set(id, { resolve: (value) => resolve(value as Result<Api[K]>), reject })
        try {
          // Clone buffers, as before. Transferring them would detach project data.
          endpoint.postMessage({ protocol, kind: 'call', id, method, args })
        } catch (error) {
          pending.delete(id)
          reject(error)
        }
      })
    },
    close(error = new WorkerTransportError('Compiler worker was terminated')) {
      if (closed) return
      closed = error
      endpoint.removeEventListener('message', onMessage)
      for (const call of pending.values()) call.reject(error)
      pending.clear()
    },
  }
}

/** Only own named operations can be called, never arbitrary properties. */
export function serveWorkerRpc(api: Record<string, (...args: never[]) => unknown>, endpoint: MessageEndpoint) {
  const onMessage = async ({ data }: MessageEvent) => {
    if (!data || data.protocol !== protocol || data.kind !== 'call'
      || !Number.isSafeInteger(data.id) || typeof data.method !== 'string' || !Array.isArray(data.args)) return
    const reply = { protocol, kind: 'reply', id: data.id }
    try {
      if (!Object.hasOwn(api, data.method) || typeof api[data.method] !== 'function') {
        throw new Error(`Unknown worker operation: ${data.method}`)
      }
      const result = await api[data.method](...data.args as never[])
      endpoint.postMessage({ ...reply, result })
    } catch (reason) {
      const failure = reason instanceof Error
        ? { error: { name: reason.name, message: reason.message, stack: reason.stack } }
        : { thrown: reason }
      endpoint.postMessage({ ...reply, failed: true, ...failure })
    }
  }
  endpoint.addEventListener('message', onMessage)
  return () => endpoint.removeEventListener('message', onMessage)
}
