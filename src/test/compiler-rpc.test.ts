import { afterEach, describe, expect, it } from 'vitest'
import { createCompilerWorkerClient, exposeCompilerWorker, type CompilerWorkerApi } from '@/lib/compiler-rpc'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function connect(overrides: Partial<CompilerWorkerApi> = {}) {
  const channel = new MessageChannel()
  const api: CompilerWorkerApi = {
    initCompiler: async () => {},
    ensurePackagesForCompile: async () => {},
    resolveSourceLocBatch: async (_data, paths) => paths.map(path => `source:${path[0]}`),
    compileToPdf: async source => ({ pdf: new TextEncoder().encode(source), diagnostics: [] }),
    compileTypstIncremental: async () => ({ kind: 'needs-sync', missingPaths: ['/main.typ'] }),
    ...overrides,
  }
  exposeCompilerWorker(api, channel.port2)
  const client = createCompilerWorkerClient(channel.port1)
  channel.port1.start()
  channel.port2.start()
  cleanups.push(() => {
    client.dispose(new Error('closed'))
    channel.port1.close()
    channel.port2.close()
  })
  return client
}

describe('compiler worker protocol over real message ports', () => {
  it('preserves result bytes and caller-owned inputs across repeated calls', async () => {
    const vector = new Uint8Array([3, 8, 21])
    const client = connect({
      compileTypstIncremental: async () => ({ kind: 'result', result: {
        vectorData: vector, svg: null, success: true, diagnostics: [],
        pageDimensions: [{ width: 595, height: 842, pageOffset: 0 }],
      } }),
    })
    const response = await client.api.compileTypstIncremental({
      mainFilePath: '/main.typ', manifest: [], textPayloads: [], binaryPayloads: [],
    })
    expect(response.kind === 'result' && Array.from(response.result.vectorData!)).toEqual([3, 8, 21])
    expect(vector.byteLength).toBe(0) // worker-owned result was transferred, not cloned

    const input = new Uint8Array([9, 2])
    expect(await client.api.resolveSourceLocBatch(input, [new Uint32Array([42])])).toEqual(['source:42'])
    expect(input).toEqual(new Uint8Array([9, 2]))
    expect(Array.from((await client.api.compileToPdf('first')).pdf!)).toEqual(Array.from(new TextEncoder().encode('first')))
    expect(Array.from((await client.api.compileToPdf('second')).pdf!)).toEqual(Array.from(new TextEncoder().encode('second')))
  })

  it('correlates concurrent responses and propagates application errors', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const client = connect({
      compileToPdf: async source => {
        if (source === 'slow') await blocked
        if (source === 'bad') throw new TypeError('invalid source')
        return { pdf: new TextEncoder().encode(source), diagnostics: [] }
      },
    })
    const slow = client.api.compileToPdf('slow')
    expect((await client.api.compileToPdf('fast')).pdf).toEqual(new TextEncoder().encode('fast'))
    release()
    expect((await slow).pdf).toEqual(new TextEncoder().encode('slow'))
    await expect(client.api.compileToPdf('bad')).rejects.toMatchObject({ name: 'TypeError', message: 'invalid source' })
    await expect(client.api.initCompiler()).resolves.toBeUndefined()
  })

  it('rejects in-flight and subsequent calls when disposed', async () => {
    const client = connect({ initCompiler: () => new Promise(() => {}) })
    const pending = client.api.initCompiler()
    client.dispose(new Error('Worker terminated'))
    await expect(pending).rejects.toThrow('Worker terminated')
    await expect(client.api.initCompiler()).rejects.toThrow('Worker terminated')
  })
})
