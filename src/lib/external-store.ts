import { useMemo, useSyncExternalStore } from 'react'

type Listener<T> = (state: T, previous: T) => void
type Update<T> = T | Partial<T> | ((state: T) => T | Partial<T>)

/** Immutable snapshots shared by React selectors and non-React consumers. */
export function create<T>(initialize: (set: (update: Update<T>, replace?: boolean) => void, get: () => T) => T) {
  const listeners = new Set<Listener<T>>()
  let state: T
  const getState = () => state
  const setState = (update: Update<T>, replace = false) => {
    const next = typeof update === 'function' ? (update as (value: T) => T | Partial<T>)(state) : update
    if (Object.is(next, state)) return
    const previous = state
    state = replace ? next as T : Object.assign({}, state, next)
    for (const listener of listeners) listener(state, previous)
  }
  const subscribe = (listener: Listener<T>) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const initial = state = initialize(setState, getState)

  function useStore<S>(selector: (state: T) => S): S {
    return useSyncExternalStore(subscribe, () => selector(state), () => selector(initial))
  }
  return Object.assign(useStore, { getState, setState, subscribe, getInitialState: () => initial })
}

function createShallowSelector<T, S extends Record<string, unknown>>() {
  let previous: S | undefined
  return (selector: (state: T) => S, state: T) => {
    const next = selector(state)
    if (previous) {
      const keys = Object.keys(next)
      if (keys.length === Object.keys(previous).length && keys.every((key) => Object.hasOwn(previous!, key) && Object.is(next[key], previous![key]))) {
        return previous
      }
    }
    previous = next
    return next
  }
}

/** The application selects plain records; retain their identity until a field changes. */
export function useShallow<T, S extends Record<string, unknown>>(selector: (state: T) => S): (state: T) => S {
  const select = useMemo(() => createShallowSelector<T, S>(), [])
  return (state) => select(selector, state)
}
