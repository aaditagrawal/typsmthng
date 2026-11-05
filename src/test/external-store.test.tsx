import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { create, useShallow } from '@/lib/external-store'

describe('external store', () => {
  it('merges updates, preserves initial state, supports replacement and unsubscribes', () => {
    const store = create(() => ({ value: 1, other: 2 }))
    const initial = store.getInitialState()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setState((state) => ({ value: state.value + 1 }))
    expect(store.getState()).toEqual({ value: 2, other: 2 })
    expect(listener).toHaveBeenLastCalledWith(store.getState(), initial)
    store.setState((state) => state)
    expect(listener).toHaveBeenCalledTimes(1)
    store.setState(initial, true)
    expect(store.getState()).toBe(initial)
    unsubscribe()
    store.setState({ value: 3 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps shallow selectors stable on unrelated updates and follows changed selectors', () => {
    const store = create(() => ({ value: 1, other: 2 }))
    let renders = 0
    const selections: unknown[] = []
    function Counter({ field }: { field: 'value' | 'other' }) {
      renders++
      const selected = store(useShallow((state) => ({ value: state[field] })))
      selections.push(selected)
      return <span>{selected.value}</span>
    }
    const view = render(<Counter field="value" />)
    const initialSelection = selections.at(-1)
    view.rerender(<Counter field="value" />)
    expect(selections.at(-1)).toBe(initialSelection)
    const before = renders
    act(() => store.setState({ other: 3 }))
    expect(renders).toBe(before)
    act(() => store.setState({ value: 4 }))
    expect(screen.getByText('4')).toBeInTheDocument()
    view.rerender(<Counter field="other" />)
    expect(screen.getByText('3')).toBeInTheDocument()
    view.unmount()
  })

  it('uses the initial snapshot when rendering on the server', () => {
    const store = create(() => ({ value: 1 }))
    store.setState({ value: 2 })
    function Value() { return <span>{store((state) => state.value)}</span> }
    expect(renderToString(<Value />)).toBe('<span>1</span>')
  })
})
