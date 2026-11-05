/** A lazy connection to an existing key/value object store. No schema upgrades. */
export type KeyvalStore = <T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
) => Promise<T>

export function createStore(databaseName: string, storeName: string): KeyvalStore {
  let connection: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    if (!connection) {
      connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onupgradeneeded = () => request.result.createObjectStore(storeName)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          database.onclose = () => { connection = undefined }
          database.onversionchange = () => {
            database.close()
            connection = undefined
          }
          resolve(database)
        }
      }).catch((error: unknown) => {
        connection = undefined
        throw error
      })
    }
    return connection
  }

  return async (mode, operation) => {
    const database = await open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      transaction.onabort = () => reject(transaction.error ?? new DOMException('Transaction aborted', 'AbortError'))
      try {
        const request = operation(transaction.objectStore(storeName))
        request.onerror = () => reject(request.error)
        if (mode === 'readonly') {
          request.onsuccess = () => resolve(request.result)
        } else {
          // A successful write can still be rolled back. Acknowledge only commit.
          transaction.oncomplete = () => resolve(request.result)
        }
      } catch (error) {
        transaction.abort()
        reject(error)
      }
    })
  }
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
