import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore, del, get, keys, set } from '@/lib/key-value-store'

function storageFixture() {
  const requests: Array<{ result: unknown; error: unknown; onupgradeneeded?: () => void; onerror?: () => void; onsuccess?: () => void }> = []
  const transactions: Array<{ oncomplete?: () => void; onabort?: () => void; onerror?: () => void; error: unknown; abort: ReturnType<typeof vi.fn>; objectStore: ReturnType<typeof vi.fn> }> = []
  const request: { result: unknown; error: unknown; onsuccess?: () => void } = { result: 'saved value', error: null }
  const objectStore = { get: vi.fn(() => request), put: vi.fn(() => request), delete: vi.fn(() => request), getAllKeys: vi.fn(() => request) }
  const database = {
    createObjectStore: vi.fn(), close: vi.fn(), onclose: () => {}, onversionchange: () => {},
    transaction: vi.fn(() => {
      const transaction = { error: null, abort: vi.fn(), objectStore: vi.fn(() => objectStore) }
      transactions.push(transaction)
      return transaction
    }),
  }
  const open = vi.fn(() => {
    const request = { result: database, error: null }
    requests.push(request)
    return request
  })
  vi.stubGlobal('indexedDB', { open })
  return { requests, transactions, request, objectStore, database, open }
}
const tick = () => Promise.resolve()
afterEach(() => vi.unstubAllGlobals())

describe('key-value store', () => {
  it('opens lazily, preserves names and waits for transaction completion on writes', async () => {
    const fixture = storageFixture()
    const store = createStore('typsmthng-projects', 'projects')
    expect(fixture.open).not.toHaveBeenCalled()
    let finished = false
    const pending = set('project', new Uint8Array([4]), store).then(() => { finished = true })
    expect(fixture.open).toHaveBeenCalledWith('typsmthng-projects')
    fixture.requests[0].onupgradeneeded?.()
    expect(fixture.database.createObjectStore).toHaveBeenCalledWith('projects')
    fixture.requests[0].onsuccess?.()
    await tick()
    expect(fixture.database.transaction).toHaveBeenCalledWith('projects', 'readwrite')
    expect(fixture.objectStore.put).toHaveBeenCalledWith(new Uint8Array([4]), 'project')
    await tick()
    expect(finished).toBe(false)
    fixture.transactions[0].oncomplete?.()
    await pending
    expect(finished).toBe(true)
  })

  it('rejects aborted transactions and retries failed database opens', async () => {
    const fixture = storageFixture()
    const store = createStore('settings', 'settings')
    const first = set('key', 'value', store)
    const error = new DOMException('denied', 'SecurityError')
    fixture.requests[0].error = error
    fixture.requests[0].onerror?.()
    await expect(first).rejects.toBe(error)
    const second = set('key', 'value', store)
    fixture.requests[1].onsuccess?.()
    await tick()
    fixture.transactions[0].onabort?.()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.open).toHaveBeenCalledTimes(2)
  })

  it('returns read results on request success without waiting for transaction completion', async () => {
    const fixture = storageFixture()
    const pending = get('key', createStore('data', 'values'))
    fixture.requests[0].onsuccess?.()
    await tick()
    fixture.request.onsuccess?.()
    expect(await pending).toBe('saved value')
  })

  it('reopens after version changes and closed connections without replaying writes', async () => {
    const fixture = storageFixture()
    const store = createStore('data', 'values')
    const first = get('key', store)
    fixture.requests[0].onsuccess?.()
    await tick()
    fixture.transactions[0].oncomplete?.()
    expect(await first).toBe('saved value')
    fixture.database.onversionchange()
    expect(fixture.database.close).toHaveBeenCalledOnce()
    const second = keys(store)
    fixture.requests[1].onsuccess?.()
    await tick()
    fixture.transactions[1].oncomplete?.()
    await second
    fixture.database.transaction.mockImplementationOnce(() => { throw new DOMException('closed', 'InvalidStateError') })
    const third = del('key', store)
    await tick()
    expect(fixture.open).toHaveBeenCalledTimes(3)
    fixture.requests[2].onsuccess?.()
    await tick()
    fixture.transactions[2].oncomplete?.()
    await third
    expect(fixture.objectStore.delete).toHaveBeenCalledTimes(1)
  })
})
