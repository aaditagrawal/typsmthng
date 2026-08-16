import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PreviewPanel } from '@/components/preview/preview-panel'
import { useCompileStore } from '@/stores/compile-store'
import { usePreviewStore } from '@/stores/preview-store'
import { forceCompile } from '@/lib/compile-manager'

vi.mock('@/components/preview/canvas-preview-surface', () => ({
  CanvasPreviewSurface: () => <div data-testid="canvas-preview" />,
}))

vi.mock('@/lib/compile-manager', () => ({
  forceCompile: vi.fn(async () => {}),
  getInjectedPreambleLineCountForProject: vi.fn(() => 0),
}))

const forceCompileMock = vi.mocked(forceCompile)

describe('PreviewPanel pagination', () => {
  beforeEach(() => {
    useCompileStore.getState().clearPreview()
    usePreviewStore.setState({ currentPage: 1, renderMode: 'auto', zoom: 100, fitMode: 'width' })
    vi.clearAllMocks()
  })

  it('clamps the current page when a new result has fewer pages', async () => {
    useCompileStore.getState().setSvgResult(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      new Uint8Array([1]),
      Array.from({ length: 5 }, () => ({ width: 595, height: 842 })),
    )
    usePreviewStore.getState().setCurrentPage(5)

    const view = render(<PreviewPanel />)
    act(() => {
      useCompileStore.getState().setSvgResult(
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
        new Uint8Array([2]),
        [{ width: 595, height: 842 }],
      )
    })

    await waitFor(() => expect(usePreviewStore.getState().currentPage).toBe(1))
    expect(view.container.textContent).toContain('01 / 01')
  })
})

describe('PreviewPanel toolbar dropdowns', () => {
  beforeEach(() => {
    useCompileStore.getState().clearPreview()
    usePreviewStore.setState({ currentPage: 1, renderMode: 'auto', zoom: 100, fitMode: 'width' })
    vi.clearAllMocks()
  })

  it('closes the zoom menu on Escape and restores focus to the trigger', () => {
    render(<PreviewPanel />)

    const trigger = screen.getByTitle('Zoom')
    fireEvent.click(trigger)
    expect(screen.getByText('FIT WIDTH')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('FIT WIDTH')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes the render mode menu on Escape', () => {
    render(<PreviewPanel />)

    fireEvent.click(screen.getByTitle('Preview render mode'))
    expect(screen.getByText('SVG')).toBeInTheDocument()
    expect(screen.getByText('Canvas: faster, no click-to-source')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('SVG')).not.toBeInTheDocument()
  })

  it('clamps out-of-range custom zoom and commits on Enter', () => {
    render(<PreviewPanel />)

    fireEvent.click(screen.getByTitle('Zoom'))
    const input = screen.getByLabelText('Custom zoom percentage')
    fireEvent.change(input, { target: { value: '900' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(usePreviewStore.getState().zoom).toBe(500)
    expect(usePreviewStore.getState().fitMode).toBe('custom')
  })

  it('commits the custom zoom on blur', () => {
    render(<PreviewPanel />)

    fireEvent.click(screen.getByTitle('Zoom'))
    const input = screen.getByLabelText('Custom zoom percentage')
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.blur(input)

    expect(usePreviewStore.getState().zoom).toBe(60)
  })
})

describe('PreviewPanel svg-on-demand', () => {
  beforeEach(() => {
    useCompileStore.getState().clearPreview()
    usePreviewStore.setState({ currentPage: 1, renderMode: 'auto', zoom: 100, fitMode: 'width' })
    vi.clearAllMocks()
  })

  it('forces a recompile when svg mode is selected but the result lacks svg', async () => {
    useCompileStore.setState({
      svg: null,
      vectorData: new Uint8Array([1]),
      pageDimensions: [{ width: 595, height: 842 }],
      totalPages: 1,
      status: 'success',
    })
    usePreviewStore.setState({ renderMode: 'svg' })

    render(<PreviewPanel />)

    await waitFor(() => expect(forceCompileMock).toHaveBeenCalledTimes(1))
  })

  it('does not recompile when svg is already available', async () => {
    useCompileStore.getState().setSvgResult(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      new Uint8Array([1]),
      [{ width: 595, height: 842 }],
    )
    usePreviewStore.setState({ renderMode: 'svg' })

    render(<PreviewPanel />)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(forceCompileMock).not.toHaveBeenCalled()
  })
})

describe('PreviewPanel diagnostics and toasts', () => {
  beforeEach(() => {
    useCompileStore.getState().clearPreview()
    usePreviewStore.setState({ currentPage: 1, renderMode: 'auto', zoom: 100, fitMode: 'width' })
    vi.clearAllMocks()
  })

  it('renders diagnostic rows as keyboard-reachable buttons', () => {
    useCompileStore.getState().setDiagnostics([
      { severity: 'error', path: 'main.typ', range: '3:1', message: 'unexpected token' },
    ])
    useCompileStore.setState({ status: 'error' })

    render(<PreviewPanel />)

    const row = screen.getByRole('button', { name: /unexpected token/ })
    expect(row).toBeInTheDocument()
    expect(row.tagName).toBe('BUTTON')
  })

  it('announces the compile toast via a live region', async () => {
    render(<PreviewPanel />)

    act(() => {
      useCompileStore.getState().setCompileTime(42)
    })

    await waitFor(() => {
      const toast = screen.getByRole('status')
      expect(toast).toHaveTextContent('Compiled in 42ms')
    })
  })
})
