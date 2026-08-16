import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateToast } from '@/components/layout/update-toast'

describe('UpdateToast', () => {
  it('shows a pending service-worker update and invokes it once', () => {
    const update = vi.fn()
    render(<UpdateToast />)

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-update-available', { detail: { update } }))
    })

    expect(screen.getByText('New version available')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(update).toHaveBeenCalledOnce()
    expect(screen.queryByText('New version available')).not.toBeInTheDocument()
  })

  it('ignores malformed events and allows dismissing a valid update', () => {
    render(<UpdateToast />)

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-update-available', { detail: {} }))
    })
    expect(screen.queryByText('New version available')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-update-available', { detail: { update: vi.fn() } }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update' }))
    expect(screen.queryByText('New version available')).not.toBeInTheDocument()
  })
})
