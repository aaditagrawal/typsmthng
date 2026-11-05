type Store = <T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>) => Promise<T>

/** Open lazily, keeping the existing database version and object-store layout. */
export function createStore(databaseName: string, storeName: string): Store {
  let connection: Promise<IDBDatabase> | undefined

  function open(): Promise<IDBDatabase> {
    if (connection) return connection
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.onupgradeneeded = () => request.result.createObjectStore(storeName)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const invalidate = () => {
          if (connection === pending) connection = undefined
        }
        database.onclose = invalidate
        database.onversionchange = () => {
          database.close()
          invalidate()
        }
        resolve(database)
      }
    })
    connection = pending
    void pending.catch(() => {
      if (connection === pending) connection = undefined
    })
    return pending
  }

  return async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    let database = await open()
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(storeName, mode)
    } catch (error) {
      // Only retry before a transaction starts. Replaying a failed write could
      // overwrite a newer value or conceal a quota/transaction error.
      if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error
      connection = undefined
      database = await open()
      transaction = database.transaction(storeName, mode)
    }

    return new Promise<T>((resolve, reject) => {
      let request: IDBRequest<T>
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? new DOMException('Storage transaction aborted', 'AbortError'))
      transaction.onerror = () => reject(transaction.error ?? request?.error)
      try {
        request = operation(transaction.objectStore(storeName))
        if (mode === 'readonly') request.onsuccess = () => resolve(request.result)
      } catch (error) {
        transaction.abort()
        reject(error)
      }
    })
  }
}

let defaultStore: Store | undefined
function resolveStore(store?: Store): Store {
  return store ?? (defaultStore ??= createStore('keyval-store', 'keyval'))
}

export function get<T>(key: IDBValidKey, store?: Store): Promise<T | undefined> {
  return resolveStore(store)('readonly', (objectStore) => objectStore.get(key))
}

export async function set(key: IDBValidKey, value: unknown, store?: Store): Promise<void> {
  await resolveStore(store)('readwrite', (objectStore) => objectStore.put(value, key))
}

export async function del(key: IDBValidKey, store?: Store): Promise<void> {
  await resolveStore(store)('readwrite', (objectStore) => objectStore.delete(key))
}

export function keys<K extends IDBValidKey = IDBValidKey>(store?: Store): Promise<K[]> {
  return resolveStore(store)('readonly', (objectStore) => objectStore.getAllKeys()) as Promise<K[]>
}
