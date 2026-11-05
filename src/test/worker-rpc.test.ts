import { describe, expect, it } from 'vitest'
import { createWorkerRpc, serveWorkerRpc, WorkerTransportError, type MessageEndpoint } from '@/lib/worker-rpc'

function endpoints() {
  const listeners = [new Set<(event: MessageEvent) => void>(), new Set<(event: MessageEvent) => void>()]
  const pair = [0, 1].map((index): MessageEndpoint => ({
    postMessage(data) {
      const clone = structuredClone(data)
      queueMicrotask(() => listeners[1 - index].forEach((listener) => listener(new MessageEvent('message', { data: clone }))))
    },
    addEventListener: (_, listener) => { listeners[index].add(listener) },
    removeEventListener: (_, listener) => { listeners[index].delete(listener) },
  }))
  return { client: pair[0], server: pair[1], listeners }
}

describe('worker RPC', () => {
  it('matches concurrent replies, preserves undefined and clones buffers', async () => {
    const { client, server } = endpoints()
    const waits: Array<() => void> = []
    const stop = serveWorkerRpc({ echo: (value: unknown) => new Promise((resolve) => { waits.push(() => resolve(value)) }) }, server)
    const rpc = createWorkerRpc<{ echo(value: unknown): Promise<unknown> }>(client)
    const data = new Uint8Array([1, 2, 255])
    const first = rpc.call('echo', data)
    const second = rpc.call('echo', undefined)
    await Promise.resolve()
    waits[1]()
    expect(await second).toBeUndefined()
    waits[0]()
    const result = await first
    // Node's structuredClone uses a different realm from jsdom's typed arrays.
    expect(ArrayBuffer.isView(result)).toBe(true)
    expect(Array.from(result as Uint8Array)).toEqual(Array.from(data))
    expect(result).not.toBe(data)
    expect(data.byteLength).toBe(3)
    rpc.close()
    stop()
  })

  it('preserves Error fields and raw thrown values, including undefined', async () => {
    const { client, server } = endpoints()
    serveWorkerRpc({ fail: (reason: unknown) => { throw reason } }, server)
    const rpc = createWorkerRpc<{ fail(reason: unknown): Promise<void> }>(client)
    const error = new TypeError('bad input')
    await expect(rpc.call('fail', error)).rejects.toMatchObject({ name: error.name, message: error.message, stack: error.stack })
    for (const reason of [undefined, null, 'bad input', 7, { message: 'plain record' }]) {
      await expect(rpc.call('fail', reason)).rejects.toEqual(reason)
    }
    rpc.close()
  })

  it('rejects all pending and later calls on teardown and removes listeners', async () => {
    const { client, listeners } = endpoints()
    const rpc = createWorkerRpc<{ wait(): Promise<void> }>(client)
    const first = rpc.call('wait')
    const second = rpc.call('wait')
    const error = new WorkerTransportError('font configuration changed')
    rpc.close(error)
    await expect(first).rejects.toBe(error)
    await expect(second).rejects.toBe(error)
    await expect(rpc.call('wait')).rejects.toBe(error)
    expect(listeners[0].size).toBe(0)
  })

  it('rejects uncloneable arguments and results without breaking later calls', async () => {
    const { client, server } = endpoints()
    serveWorkerRpc({ echo: (value: unknown) => value, bad: () => () => {} }, server)
    const rpc = createWorkerRpc<{ echo(value: unknown): Promise<unknown>; bad(): Promise<unknown> }>(client)
    await expect(rpc.call('echo', () => {})).rejects.toBeDefined()
    await expect(rpc.call('bad')).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(await rpc.call('echo', 'ok')).toBe('ok')
    rpc.close()
  })

  it('rejects inherited methods rather than exposing arbitrary object properties', async () => {
    const { client, server } = endpoints()
    serveWorkerRpc({}, server)
    const rpc = createWorkerRpc<{ toString(): Promise<string> }>(client)
    await expect(rpc.call('toString')).rejects.toThrow('Unknown worker operation')
    rpc.close()
  })
})
