import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { CanvasPreviewSurface } from '@/components/preview/canvas-preview-surface'
import { renderVectorPageToCanvas } from '@/lib/page-renderer'

vi.mock('@/lib/page-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/page-renderer')>()
  return {
    ...actual,
    renderVectorPageToCanvas: vi.fn(async () => {}),
  }
})

vi.mock('@myriaddreamin/typst.ts', () => ({
  createTypstRenderer: () => ({
    init: async () => {},
    runWithSession: async () => {},
  }),
}))

vi.mock('@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url', () => ({
  default: 'test-wasm-url',
}))

const renderPageMock = vi.mocked(renderVectorPageToCanvas)

const PAGES = [
  { width: 595, height: 842 },
  { width: 595, height: 842 },
]

describe('CanvasPreviewSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders each page once and re-renders on a new artifact', async () => {
    const first = new Uint8Array([1])
    const view = render(<CanvasPreviewSurface vectorData={first} pageDimensions={PAGES} />)

    await waitFor(() => expect(renderPageMock).toHaveBeenCalledTimes(2))
    const firstKeys = renderPageMock.mock.calls.map((call) => call[3]?.renderKey)
    expect(new Set(firstKeys).size).toBe(2)

    const second = new Uint8Array([2])
    view.rerender(<CanvasPreviewSurface vectorData={second} pageDimensions={PAGES} />)

    await waitFor(() => expect(renderPageMock).toHaveBeenCalledTimes(4))
    const secondKeys = renderPageMock.mock.calls.slice(2).map((call) => call[3]?.renderKey)
    // A new artifact revision produces new render keys for every page.
    expect(secondKeys[0]).not.toBe(firstKeys[0])
    expect(secondKeys[1]).not.toBe(firstKeys[1])
  })

  it('does not re-render when props are unchanged', async () => {
    const artifact = new Uint8Array([1])
    const view = render(<CanvasPreviewSurface vectorData={artifact} pageDimensions={PAGES} />)

    await waitFor(() => expect(renderPageMock).toHaveBeenCalledTimes(2))
    view.rerender(<CanvasPreviewSurface vectorData={artifact} pageDimensions={PAGES} />)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(renderPageMock).toHaveBeenCalledTimes(2)
  })
})
