import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { PreviewPanel } from '@/components/preview/preview-panel'
import { useCompileStore } from '@/stores/compile-store'
import { usePreviewStore } from '@/stores/preview-store'

vi.mock('@/components/preview/canvas-preview-surface', () => ({
  CanvasPreviewSurface: () => <div data-testid="canvas-preview" />,
}))

describe('PreviewPanel pagination', () => {
  beforeEach(() => {
    useCompileStore.getState().clearPreview()
    usePreviewStore.setState({ currentPage: 1 })
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
