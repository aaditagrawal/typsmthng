import { act, render, renderHook, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { create, useShallow } from '@/lib/store'

describe('application store', () => {
  it('merges functional updates, skips identity updates and unsubscribes', () => {
    const store = create(() => ({ count: 0, label: 'first' }))
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setState((state) => state)
    expect(listener).not.toHaveBeenCalled()
    const initial = store.getState()
    store.setState((state) => ({ count: state.count + 1 }))
    expect(listener).toHaveBeenCalledExactlyOnceWith({ count: 1, label: 'first' }, initial)
    unsubscribe()
    store.setState(store.getInitialState(), true)
    expect(store.getState()).toBe(initial)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('updates selected fields while unrelated updates retain shallow snapshots', () => {
    const useStore = create(() => ({ count: 0, other: 0 }))
    let renders = 0
    function Counter({ field }: { field: 'count' | 'other' }) {
      const { value } = useStore(useShallow((state) => ({ value: state[field] })))
      renders++
      return <output>{value}</output>
    }
    const view = render(<Counter field="count" />)
    const initialRenders = renders
    act(() => useStore.setState({ other: 5 }))
    expect(renders).toBe(initialRenders)
    act(() => useStore.setState({ count: 2 }))
    expect(screen.getByRole('status')).toHaveTextContent('2')
    view.rerender(<Counter field="other" />)
    expect(screen.getByRole('status')).toHaveTextContent('5')
    view.unmount()
  })

  it('uses the initial snapshot for server rendering and supports the whole state hook', () => {
    const useStore = create(() => ({ count: 0 }))
    useStore.setState({ count: 3 })
    function Counter() { return <output>{useStore().count}</output> }
    expect(renderToString(<Counter />)).toContain('>0<')
    const view = render(<Counter />)
    expect(screen.getByRole('status')).toHaveTextContent('3')
    view.unmount()
  })

  it('compares own keys and preserves Object.is value semantics in shallow selections', () => {
    const useStore = create<{ selection: Record<string, number | undefined> }>(() => ({
      selection: { left: undefined },
    }))
    const view = renderHook(() => useStore(useShallow((state) => state.selection)))
    const first = view.result.current
    act(() => useStore.setState({ selection: { left: undefined } }))
    expect(view.result.current).toBe(first)
    act(() => useStore.setState({ selection: { right: undefined } }))
    expect(view.result.current).not.toBe(first)
    expect(view.result.current).toEqual({ right: undefined })
    act(() => useStore.setState({ selection: { value: NaN } }))
    const nan = view.result.current
    act(() => useStore.setState({ selection: { value: NaN } }))
    expect(view.result.current).toBe(nan)
    act(() => useStore.setState({ selection: { value: 0 } }))
    act(() => useStore.setState({ selection: { value: -0 } }))
    expect(Object.is(view.result.current.value, -0)).toBe(true)
    act(() => useStore.setState({ selection: {} }))
    expect(view.result.current).toEqual({})
    view.unmount()
  })
})
