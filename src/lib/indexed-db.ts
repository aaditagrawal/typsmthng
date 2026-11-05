/** Named stores retain their existing schema. Opening never upgrades an existing database. */
export function createStore(databaseName: string, storeName: string) {
  let connection: Promise<IDBDatabase> | undefined

  return {
    storeName,
    open(): Promise<IDBDatabase> {
      if (!connection) {
        connection = new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(databaseName)
          request.onupgradeneeded = () => request.result.createObjectStore(storeName)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const database = request.result
            database.onversionchange = () => {
              database.close()
              connection = undefined
            }
            database.onclose = () => { connection = undefined }
            resolve(database)
          }
        }).catch((error: unknown) => {
          // A temporary denial/open failure must not poison all later saves.
          connection = undefined
          throw error
        })
      }
      return connection
    },
  }
}

type Store = ReturnType<typeof createStore>
const defaultStore = createStore('keyval-store', 'keyval')

function run<T>(store: Store, mode: 'readonly', requestFor: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T>
function run<T>(store: Store, mode: 'readwrite', requestFor: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<void>
function run<T>(
  store: Store,
  mode: IDBTransactionMode,
  requestFor: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T | void> {
  return store.open().then((database) => {
    const transaction = database.transaction(store.storeName, mode)
    // A synchronous failure queues no write and rejects the opening chain directly.
    const request = requestFor(transaction.objectStore(store.storeName))
    return new Promise<T | void>((resolve, reject) => {
      request.onerror = () => reject(request.error)
      if (mode === 'readonly') {
        request.onsuccess = () => resolve(request.result)
      } else {
        // A successful write request can still fail at commit time.
        transaction.onabort = () => reject(transaction.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'))
        transaction.onerror = () => reject(transaction.error)
        transaction.oncomplete = () => resolve()
      }
    })
  })
}

export function get<T>(key: IDBValidKey, store = defaultStore): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (objectStore) => objectStore.get(key))
}

export function set(key: IDBValidKey, value: unknown, store = defaultStore): Promise<void> {
  return run(store, 'readwrite', (objectStore) => objectStore.put(value, key))
}

export function del(key: IDBValidKey, store = defaultStore): Promise<void> {
  return run(store, 'readwrite', (objectStore) => objectStore.delete(key))
}

export function keys(store = defaultStore): Promise<IDBValidKey[]> {
  return run(store, 'readonly', (objectStore) => objectStore.getAllKeys())
}
