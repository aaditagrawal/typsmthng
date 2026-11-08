import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafariBanner } from '@/components/layout/safari-banner'

describe('SafariBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Version/18.0 Safari/605.1.15')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mockPersist(persist: () => Promise<boolean>) {
    vi.stubGlobal('navigator', { userAgent: 'Version/18.0 Safari/605.1.15', storage: { persist } })
  }

  it('requests once, shows granted feedback, and hides after two seconds', async () => {
    let resolvePersist!: (granted: boolean) => void
    const persist = vi.fn(() => new Promise<boolean>((resolve) => { resolvePersist = resolve }))
    mockPersist(persist)
    const { container } = render(<SafariBanner />)
    const allow = screen.getByRole('button', { name: 'Allow storage' })
    fireEvent.click(allow)
    fireEvent.click(allow)
    expect(allow).toBeDisabled()
    expect(persist).toHaveBeenCalledTimes(1)
    await act(async () => resolvePersist(true))
    expect(screen.getByText('Storage protected. Safari will keep your data.')).toBeInTheDocument()
    expect(localStorage.getItem('safari-banner-dismissed')).toBe('1')
    act(() => vi.advanceTimersByTime(1999))
    expect(container).not.toBeEmptyDOMElement()
    act(() => vi.advanceTimersByTime(1))
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['denied', 'rejected'] as const)('shows denied feedback when permission is %s', async (outcome) => {
    mockPersist(() => outcome === 'denied' ? Promise.resolve(false) : Promise.reject(new Error('denied')))
    render(<SafariBanner />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Allow storage' })))
    expect(screen.getByText(/Request denied/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow storage' })).not.toBeInTheDocument()
    expect(localStorage.getItem('safari-banner-dismissed')).toBeNull()
  })

  it('ignores a permission result after dismissal without scheduling another hide', async () => {
    let resolvePersist!: (granted: boolean) => void
    mockPersist(() => new Promise<boolean>((resolve) => { resolvePersist = resolve }))
    const { container } = render(<SafariBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow storage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await act(async () => resolvePersist(true))
    expect(container).toBeEmptyDOMElement()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up the granted dismissal timer on unmount', async () => {
    mockPersist(() => Promise.resolve(true))
    const { unmount } = render(<SafariBanner />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Allow storage' })))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
