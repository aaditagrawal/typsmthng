import { useRef, useSyncExternalStore } from 'react'

type SetState<T> = (update: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void
type Listener<T> = (state: T, previous: T) => void

interface StoreApi<T> {
  getState: () => T
  getInitialState: () => T
  setState: SetState<T>
  subscribe: (listener: Listener<T>) => () => void
}

interface Store<T> extends StoreApi<T> {
  (): T
  <U>(selector: (state: T) => U): U
}

/** Immutable application state with synchronous subscriptions and React snapshots. */
export function create<T extends object>(initialize: (set: SetState<T>, get: () => T) => T): Store<T> {
  const listeners = new Set<Listener<T>>()
  let state: T
  const getState = () => state
  const setState: SetState<T> = (update, replace = false) => {
    const patch = typeof update === 'function' ? update(state) : update
    if (Object.is(patch, state)) return
    const previous = state
    state = replace ? patch as T : Object.assign({}, state, patch)
    for (const listener of listeners) listener(state, previous)
  }
  const initialState = state = initialize(setState, getState)
  const api: StoreApi<T> = {
    getState,
    getInitialState: () => initialState,
    setState,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }

  function useStore<U = T>(selector: (state: T) => U = (value) => value as unknown as U): U {
    return useSyncExternalStore(api.subscribe, () => selector(state), () => selector(initialState))
  }
  return Object.assign(useStore, api)
}

/** Stabilize the plain object selections used by components with multiple fields. */
export function useShallow<T, U extends object>(selector: (state: T) => U): (state: T) => U {
  const previous = useRef<U | undefined>(undefined)
  return (state) => {
    const next = selector(state)
    const last = previous.current
    if (Object.is(last, next)) return next
    if (last) {
      const keys = Object.keys(next) as Array<keyof U>
      if (Object.keys(last).length === keys.length) {
        let equal = true
        for (const key of keys) {
          if (!Object.hasOwn(last, key) || !Object.is(last[key], next[key])) {
            equal = false
            break
          }
        }
        if (equal) return last
      }
    }
    previous.current = next
    return next
  }
}
