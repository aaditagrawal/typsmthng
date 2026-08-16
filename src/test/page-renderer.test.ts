import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computePixelPerPt, renderVectorPageToCanvas } from '@/lib/page-renderer'

const mocks = vi.hoisted(() => {
  const renderCanvas = vi.fn(async () => ({}))
  const runWithSession = vi.fn(
    async (
      _options: { artifactContent: Uint8Array },
      fn: (session: { renderCanvas: typeof renderCanvas }) => Promise<unknown>,
    ) => fn({ renderCanvas }),
  )
  return { renderCanvas, runWithSession }
})

vi.mock('@myriaddreamin/typst.ts', () => ({
  createTypstRenderer: () => ({
    init: async () => {},
    runWithSession: mocks.runWithSession,
  }),
}))

vi.mock('@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url', () => ({
  default: 'test-wasm-url',
}))

function makeConnectedCanvas(renderKey: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.dataset.renderKey = renderKey
  document.body.appendChild(canvas)
  return canvas
}

describe('computePixelPerPt', () => {
  it('derives resolution from displayed width and devicePixelRatio', () => {
    // 800 CSS px over a 595pt page at DPR 1 -> ~1.34, snapped up to 1.5
    expect(computePixelPerPt(800, 595, 1)).toBe(1.5)
    // Same pane at DPR 2 -> ~2.69, snapped up to 2.75
    expect(computePixelPerPt(800, 595, 2)).toBe(2.75)
  })

  it('clamps to the supported range', () => {
    expect(computePixelPerPt(100, 595, 1)).toBe(1)
    expect(computePixelPerPt(4000, 595, 3)).toBe(4.5)
  })

  it('falls back when the width is not yet measured', () => {
    expect(computePixelPerPt(0, 595, 2)).toBe(2.25)
  })
})

describe('page renderer batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''

    const fakeContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    }
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => fakeContext,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext
  })

  it('renders all pending pages for one artifact inside a single session', async () => {
    const artifact = new Uint8Array([1, 2, 3])
    const canvases = [0, 1, 2].map((i) => makeConnectedCanvas(`key-${i}`))

    await Promise.all(canvases.map((canvas, i) =>
      renderVectorPageToCanvas(artifact, i, canvas, {
        renderKey: `key-${i}`,
        widthPt: 100,
        heightPt: 100,
        pixelPerPt: 2,
      }),
    ))

    expect(mocks.runWithSession).toHaveBeenCalledTimes(1)
    expect(mocks.renderCanvas).toHaveBeenCalledTimes(3)
    const offsets = mocks.renderCanvas.mock.calls.map(
      (call) => (call as unknown as [{ pageOffset: number }])[0].pageOffset,
    )
    expect(offsets).toEqual([0, 1, 2])
  })

  it('opens one session per distinct artifact', async () => {
    const artifactA = new Uint8Array([1])
    const artifactB = new Uint8Array([2])
    const canvasA = makeConnectedCanvas('a')
    const canvasB = makeConnectedCanvas('b')

    await Promise.all([
      renderVectorPageToCanvas(artifactA, 0, canvasA, { renderKey: 'a' }),
      renderVectorPageToCanvas(artifactB, 0, canvasB, { renderKey: 'b' }),
    ])

    expect(mocks.runWithSession).toHaveBeenCalledTimes(2)
    const artifacts = mocks.runWithSession.mock.calls.map((call) => call[0].artifactContent)
    expect(artifacts[0]).toBe(artifactA)
    expect(artifacts[1]).toBe(artifactB)
  })

  it('skips renders whose renderKey went stale', async () => {
    const artifact = new Uint8Array([1])
    const canvas = makeConnectedCanvas('newer-key')

    await renderVectorPageToCanvas(artifact, 0, canvas, { renderKey: 'older-key' })

    expect(mocks.renderCanvas).not.toHaveBeenCalled()
  })

  it('skips renders whose canvas is no longer connected', async () => {
    const artifact = new Uint8Array([1])
    const canvas = document.createElement('canvas')
    canvas.dataset.renderKey = 'key'

    await renderVectorPageToCanvas(artifact, 0, canvas, { renderKey: 'key' })

    expect(mocks.runWithSession).not.toHaveBeenCalled()
    expect(mocks.renderCanvas).not.toHaveBeenCalled()
  })
})
