import { describe, expect, it, vi } from 'vitest'
import { connectCompilerWorker, exposeCompilerWorker, type CompilerWorkerApi } from '@/lib/compiler-rpc'

function endpoints() {
  class Endpoint {
    listeners = new Set<(event: MessageEvent) => void>()
    peer!: Endpoint
    postMessage(data: unknown) {
      const event = new MessageEvent('message', { data: structuredClone(data) })
      queueMicrotask(() => this.peer.listeners.forEach((listener) => listener(event)))
    }
    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) { this.listeners.add(listener) }
    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) { this.listeners.delete(listener) }
  }
  const left = new Endpoint()
  const right = new Endpoint()
  left.peer = right
  right.peer = left
  return [left, right]
}

function api(overrides: Partial<CompilerWorkerApi> = {}): CompilerWorkerApi {
  return {
    initCompiler: async () => {},
    compileTypst: async () => { throw new Error('unused') },
    compileTypstIncremental: async () => { throw new Error('unused') },
    compileToPdf: async () => ({ pdf: new Uint8Array([1, 2, 3]), diagnostics: [] }),
    resolveSourceLoc: async () => undefined,
    resolveSourceLocBatch: async () => [],
    ensurePackagesForCompile: async () => {},
    isCompilerReady: () => true,
    ...overrides,
  }
}

describe('compiler worker protocol', () => {
  it('correlates concurrent out-of-order replies and preserves undefined', async () => {
    const [client, worker] = endpoints()
    let finish!: (value: string) => void
    const stop = exposeCompilerWorker(api({ resolveSourceLoc: () => new Promise((resolve) => { finish = resolve }) }), worker)
    const rpc = connectCompilerWorker(client)
    const slow = rpc.api.resolveSourceLoc(new Uint8Array(), new Uint32Array())
    await expect(rpc.api.isCompilerReady()).resolves.toBe(true)
    await expect(rpc.api.resolveSourceLocBatch(new Uint8Array(), [])).resolves.toEqual([])
    finish('source')
    await expect(slow).resolves.toBe('source')
    rpc.dispose(new Error('done'))
    stop()
  })

  it('structured clones buffers without transferring ownership', async () => {
    const [client, worker] = endpoints()
    const bytes = new Uint8Array([3, 4, 5])
    const font = new Uint8Array([6, 7])
    exposeCompilerWorker(api({ initCompiler: async (options) => { options!.fontData![0][0] = 0 } }), worker)
    const rpc = connectCompilerWorker(client)
    await rpc.api.initCompiler({ fontData: [font] })
    const result = await rpc.api.compileToPdf('test', undefined, undefined, [{ path: '/image', data: bytes }])
    expect(bytes).toEqual(new Uint8Array([3, 4, 5]))
    expect(font).toEqual(new Uint8Array([6, 7]))
    expect(ArrayBuffer.isView(result.pdf)).toBe(true)
    expect(Object.prototype.toString.call(result.pdf)).toBe('[object Uint8Array]')
    expect(Array.from(result.pdf ?? [])).toEqual([1, 2, 3])
    await expect(rpc.api.resolveSourceLoc(bytes, new Uint32Array([1]))).resolves.toBeUndefined()
    rpc.dispose(new Error('done'))
  })

  it('preserves error names/messages and non-Error rejection values', async () => {
    const [client, worker] = endpoints()
    exposeCompilerWorker(api({
      initCompiler: async () => { throw new TypeError('bad font') },
      ensurePackagesForCompile: async () => { throw 'missing package' },
    }), worker)
    const rpc = connectCompilerWorker(client)
    await expect(rpc.api.initCompiler()).rejects.toMatchObject({ name: 'TypeError', message: 'bad font' })
    await expect(rpc.api.ensurePackagesForCompile([])).rejects.toBe('missing package')
    rpc.dispose(new Error('done'))
  })

  it('rejects all pending and future calls on disposal and removes the listener', async () => {
    const [client] = endpoints()
    const remove = vi.spyOn(client, 'removeEventListener')
    const rpc = connectCompilerWorker(client)
    const first = rpc.api.initCompiler()
    const second = rpc.api.compileToPdf('test')
    const error = new Error('worker died')
    rpc.dispose(error)
    await expect(first).rejects.toBe(error)
    await expect(second).rejects.toBe(error)
    await expect(rpc.api.isCompilerReady()).rejects.toBe(error)
    expect(remove).toHaveBeenCalledExactlyOnceWith('message', expect.any(Function))
  })

  it('rejects synchronous cloning failures without poisoning later calls', async () => {
    const [client, worker] = endpoints()
    exposeCompilerWorker(api(), worker)
    const send = vi.spyOn(client, 'postMessage').mockImplementationOnce(() => { throw new DOMException('cannot clone', 'DataCloneError') })
    const rpc = connectCompilerWorker(client)
    await expect(rpc.api.initCompiler()).rejects.toMatchObject({ name: 'DataCloneError' })
    await expect(rpc.api.isCompilerReady()).resolves.toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
    rpc.dispose(new Error('done'))
  })

  it('rejects inherited methods and ignores messages outside the protocol', async () => {
    const [client, worker] = endpoints()
    const send = vi.spyOn(worker, 'postMessage')
    const stop = exposeCompilerWorker(api(), worker)
    client.postMessage({ channel: 'other', id: 1, method: 'isCompilerReady', args: [] })
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    client.postMessage({ channel: 'typsmthng-compiler-v1', id: 2, method: 'constructor', args: [] })
    await Promise.resolve()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      id: 2, ok: false, error: expect.objectContaining({ message: 'Unknown compiler method' }),
    }))
    stop()
  })
})
