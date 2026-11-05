import { describe, expect, it, vi } from 'vitest'
import { createCompilerRpc, exposeCompilerRpc, WorkerTransportError, type CompilerWorkerApi } from '@/lib/compiler-rpc'

class Endpoint {
  listeners = new Set<(event: MessageEvent) => void>()
  postMessage = vi.fn<(message: unknown) => void>()
  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) { this.listeners.add(listener) }
  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) { this.listeners.delete(listener) }
  receive(data: unknown) { for (const listener of this.listeners) listener(new MessageEvent('message', { data })) }
}

function api(): CompilerWorkerApi {
  return {
    initCompiler: vi.fn(async () => {}),
    compileTypst: vi.fn(async () => ({ svg: '', vectorData: new Uint8Array([1]), pageDimensions: [], diagnostics: [], success: true })),
    compileToPdf: vi.fn(async () => ({ pdf: new Uint8Array([2]), diagnostics: [] })),
    resolveSourceLoc: vi.fn(async () => undefined),
    resolveSourceLocBatch: vi.fn(async () => []),
    ensurePackagesForCompile: vi.fn(async () => {}),
    isCompilerReady: () => true,
  }
}

function response(id: number, value: unknown) { return { channel: 'typst-compiler', id, ok: true, value } }

describe('compiler RPC', () => {
  it('matches concurrent out-of-order replies and ignores other messages', async () => {
    const endpoint = new Endpoint()
    const client = createCompilerRpc(endpoint)
    const first = client.call('isCompilerReady')
    const second = client.call('resolveSourceLoc', new Uint8Array([4]), new Uint32Array([3]))
    endpoint.receive({ ...response(1, false), channel: 'unrelated' })
    endpoint.receive(response(900, 'unrelated'))
    endpoint.receive(response(2, '4:3'))
    endpoint.receive(response(1, true))
    expect(await first).toBe(true)
    expect(await second).toBe('4:3')
    expect(endpoint.postMessage).toHaveBeenCalledWith({ channel: 'typst-compiler', id: 2, method: 'resolveSourceLoc',
      args: [new Uint8Array([4]), new Uint32Array([3])] })
  })

  it('rejects all pending and future calls and removes its listener on disposal', async () => {
    const endpoint = new Endpoint()
    const client = createCompilerRpc(endpoint)
    const first = expect(client.call('initCompiler')).rejects.toBeInstanceOf(WorkerTransportError)
    const second = expect(client.call('compileToPdf', 'doc')).rejects.toThrow('worker died')
    client.dispose(new WorkerTransportError('worker died'))
    await Promise.all([first, second])
    expect(endpoint.listeners.size).toBe(0)
    await expect(client.call('isCompilerReady')).rejects.toThrow('worker died')
    expect(endpoint.postMessage).toHaveBeenCalledTimes(2)
  })

  it('preserves application errors and thrown values without marking them as transport failures', async () => {
    const endpoint = new Endpoint()
    const client = createCompilerRpc(endpoint)
    const application = client.call('compileTypst', 'doc')
    endpoint.receive({ channel: 'typst-compiler', id: 1, ok: false,
      error: { kind: 'error', name: 'TypeError', message: 'layout failed', stack: 'worker stack' } })
    await expect(application).rejects.toMatchObject({ name: 'TypeError', message: 'layout failed', stack: 'worker stack' })
    const primitive = client.call('initCompiler')
    endpoint.receive({ channel: 'typst-compiler', id: 2, ok: false, error: { kind: 'value', value: 'failed' } })
    await expect(primitive).rejects.toBe('failed')
    const next = client.call('isCompilerReady')
    endpoint.receive(response(3, true))
    expect(await next).toBe(true)
  })

  it('distinguishes send failures from arguments that cannot be cloned', async () => {
    const endpoint = new Endpoint()
    const client = createCompilerRpc(endpoint)
    endpoint.postMessage.mockImplementationOnce(() => { throw new DOMException('not cloneable', 'DataCloneError') })
    await expect(client.call('initCompiler')).rejects.toMatchObject({ name: 'DataCloneError' })
    endpoint.postMessage.mockImplementationOnce(() => { throw new Error('closed port') })
    await expect(client.call('initCompiler')).rejects.toBeInstanceOf(WorkerTransportError)
  })

  it('dispatches the finite API and serializes application errors', async () => {
    const endpoint = new Endpoint()
    const backend = api()
    vi.mocked(backend.compileTypst).mockRejectedValueOnce(new TypeError('bad source'))
    const cleanup = exposeCompilerRpc(endpoint, backend)
    endpoint.receive({ channel: 'typst-compiler', id: 1, method: 'compileTypst', args: ['doc', [], '/main.typ', [], { wantSvg: false }] })
    await vi.waitFor(() => expect(endpoint.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, ok: false,
      error: expect.objectContaining({ kind: 'error', name: 'TypeError', message: 'bad source' }) })))
    expect(backend.compileTypst).toHaveBeenCalledWith('doc', [], '/main.typ', [], { wantSvg: false })
    endpoint.receive({ channel: 'typst-compiler', id: 2, method: 'constructor', args: [] })
    await vi.waitFor(() => expect(endpoint.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, ok: false,
      error: expect.objectContaining({ message: 'Unknown compiler method' }) })))
    cleanup()
    expect(endpoint.listeners.size).toBe(0)
  })
})
