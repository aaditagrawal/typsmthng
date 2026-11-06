/** A lazy connection to an existing key/value object store. No schema upgrades. */
export type KeyvalStore = <T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
) => Promise<T>

export function createStore(databaseName: string, storeName: string): KeyvalStore {
  let connection: Promise<IDBDatabase> | undefined
  let database: IDBDatabase | undefined
  const clearConnection = () => {
    database = undefined
    connection = undefined
  }
  const open = (): Promise<IDBDatabase> => {
    if (!connection) {
      connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onupgradeneeded = () => request.result.createObjectStore(storeName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const opened = request.result
          opened.onclose = clearConnection
          opened.onversionchange = () => {
            opened.close()
            clearConnection()
          }
          database = opened
          resolve(opened)
        }
      }).catch((error: unknown) => {
        connection = undefined
        throw error
      })
    }
    return connection
  }

  return (mode, operation) => new Promise((resolve, reject) => {
    const run = (opened: IDBDatabase) => {
      let transaction: IDBTransaction | undefined
      try {
        transaction = opened.transaction(storeName, mode)
        const active = transaction
        active.onabort = () => reject(active.error ?? new DOMException('Transaction aborted', 'AbortError'))
        const request = operation(active.objectStore(storeName))
        request.onerror = () => reject(request.error)
        if (mode === 'readonly') {
          request.onsuccess = () => resolve(request.result)
        } else {
          // A successful write can still be rolled back. Acknowledge only commit.
          active.oncomplete = () => resolve(request.result)
        }
      } catch (error) {
        try { transaction?.abort() } catch { /* The callback may have already aborted it. */ }
        reject(error)
      }
    }
    // Warm calls need only the operation promise, without an async connection hop.
    if (database) run(database)
    else open().then(run, reject)
  })
}

export function get<T>(key: IDBValidKey, store: KeyvalStore): Promise<T | undefined> {
  return store('readonly', (objectStore) => objectStore.get(key))
}

export async function set(key: IDBValidKey, value: unknown, store: KeyvalStore): Promise<void> {
  await store('readwrite', (objectStore) => objectStore.put(value, key))
}

export async function del(key: IDBValidKey, store: KeyvalStore): Promise<void> {
  await store('readwrite', (objectStore) => objectStore.delete(key))
}

export function keys(store: KeyvalStore): Promise<IDBValidKey[]> {
  return store('readonly', (objectStore) => objectStore.getAllKeys())
}
