/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { createCompilerRpcClient, exposeCompilerRpc, WorkerTransportError, type CompilerWorkerApi } from '@/lib/compiler-rpc'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function connection() {
  const { port1, port2 } = new MessageChannel()
  const api: CompilerWorkerApi = {
    initCompiler: vi.fn(async () => {}),
    compileTypst: vi.fn(async () => ({ svg: null, vectorData: null, pageDimensions: [], diagnostics: [], success: true })),
    compileTypstIncremental: vi.fn(),
    compileToPdf: vi.fn(async () => ({ pdf: new Uint8Array([37, 80, 68, 70]), diagnostics: [] })),
    resolveSourceLoc: vi.fn(async () => undefined),
    resolveSourceLocBatch: vi.fn(async () => []),
    ensurePackagesForCompile: vi.fn(async () => {}),
    isCompilerReady: vi.fn(() => true),
  }
  const client = createCompilerRpcClient(port1)
  const stop = exposeCompilerRpc(api, port2)
  port1.start()
  port2.start()
  cleanups.push(() => { client.dispose(new WorkerTransportError('closed')); stop(); port1.close(); port2.close() })
  return { api, client, port1, port2 }
}

describe('compiler worker RPC over real structured-clone message ports', () => {
  it('matches out-of-order results by request id and clones live buffers', async () => {
    const { api, client } = connection()
    let finish!: (value: string | undefined) => void
    vi.mocked(api.resolveSourceLoc).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const input = new Uint8Array([1, 2, 255])
    const delayed = client.api.resolveSourceLoc(input, new Uint32Array([4, 5]))
    const pdf = await client.api.compileToPdf('= Document', undefined, '/main.typ', [{ path: '/image', data: input }])
    expect(Array.from(pdf.pdf!)).toEqual([37, 80, 68, 70])
    expect(input.byteLength).toBe(3)
    const received = vi.mocked(api.compileToPdf).mock.calls[0][3]![0].data
    expect(received).not.toBe(input)
    expect(Array.from(received)).toEqual([1, 2, 255])
    finish('source-location')
    expect(await delayed).toBe('source-location')
    expect(await client.api.isCompilerReady()).toBe(true)
    expect(await client.api.resolveSourceLoc(input, new Uint32Array())).toBeUndefined()
  })

  it('preserves error details and thrown structured values without breaking subsequent calls', async () => {
    const { api, client } = connection()
    vi.mocked(api.initCompiler).mockRejectedValueOnce(new TypeError('layout failed')).mockRejectedValueOnce({ code: 42 }).mockRejectedValueOnce(new Date(1234))
    await expect(client.api.initCompiler()).rejects.toMatchObject({ name: 'TypeError', message: 'layout failed' })
    await expect(client.api.initCompiler()).rejects.toEqual({ code: 42 })
    const thrownDate = await client.api.initCompiler().catch((value: Date) => value)
    expect(thrownDate).toHaveProperty('getTime')
    expect((thrownDate as Date).getTime()).toBe(1234)
    await expect(client.api.initCompiler()).resolves.toBeUndefined()
  })

  it('rejects prototype methods and ignores unrelated messages', async () => {
    const { api, port1 } = connection()
    const reply = new Promise<unknown>((resolve) => port1.once('message', resolve))
    port1.postMessage({ protocol: 'foreign', kind: 'call', id: 21, method: 'initCompiler', args: [] })
    port1.postMessage({ protocol: 'typsmthng-compiler-v1', kind: 'call', id: 22, method: 'constructor', args: [] })
    expect(await reply).toMatchObject({ id: 22, ok: false, error: { name: 'TypeError' } })
    expect(api.initCompiler).not.toHaveBeenCalled()
  })

  it('cleans up pending promises and rejects future calls on worker disposal', async () => {
    const { api, client, port1 } = connection()
    vi.mocked(api.initCompiler).mockImplementation(() => new Promise(() => {}))
    const remove = vi.spyOn(port1, 'removeEventListener')
    const first = client.api.initCompiler()
    const second = client.api.initCompiler()
    const checks = [expect(first).rejects.toThrow('worker terminated'), expect(second).rejects.toThrow('worker terminated')]
    client.dispose(new WorkerTransportError('worker terminated'))
    await Promise.all(checks)
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
    await expect(client.api.initCompiler()).rejects.toThrow('worker terminated')
  })

  it('rejects postMessage serialization errors and remains usable', async () => {
    const { client } = connection()
    const options = { fontData: [() => {}] }
    // A malformed runtime caller can supply data that TypeScript normally excludes.
    const unsafeCall: (value: unknown) => Promise<void> = client.api.initCompiler as (value: unknown) => Promise<void>
    await expect(unsafeCall(options)).rejects.toMatchObject({ name: 'DataCloneError' })
    await expect(client.api.initCompiler()).resolves.toBeUndefined()
  })
})
