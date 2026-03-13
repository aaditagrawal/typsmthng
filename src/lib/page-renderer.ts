import { createTypstRenderer } from '@myriaddreamin/typst.ts'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

interface PageRenderOptions {
  backgroundColor?: string
  pixelPerPt?: number
  widthPt?: number
  heightPt?: number
}

let rendererPromise: Promise<Awaited<ReturnType<typeof createTypstRenderer>>> | null = null

async function getRenderer() {
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const renderer = createTypstRenderer()
      await renderer.init({
        getModule: () => rendererWasmUrl,
      })
      return renderer
    })().catch((err) => {
      rendererPromise = null
      throw err
    })
  }

  return rendererPromise
}

export async function renderVectorPageToCanvas(
  vectorData: Uint8Array,
  pageOffset: number,
  canvas: HTMLCanvasElement,
  options?: PageRenderOptions,
): Promise<void> {
  const pixelPerPt = options?.pixelPerPt ?? 2.5
  const widthPt = options?.widthPt
  const heightPt = options?.heightPt
  const renderCanvas = document.createElement('canvas')
  if (widthPt && heightPt) {
    renderCanvas.width = Math.max(1, Math.ceil(widthPt * pixelPerPt))
    renderCanvas.height = Math.max(1, Math.ceil(heightPt * pixelPerPt))
  }

  const renderContext = renderCanvas.getContext('2d')
  if (!renderContext) {
    throw new Error('Canvas 2D context is unavailable')
  }

  const renderer = await getRenderer()
  await renderer.runWithSession(
    { format: 'vector', artifactContent: vectorData },
    async (session) => {
      await session.renderCanvas({
        canvas: renderContext,
        pageOffset,
        backgroundColor: options?.backgroundColor ?? '#ffffff',
        pixelPerPt,
        dataSelection: {
          body: true,
        },
      })
    },
  )

  canvas.width = renderCanvas.width
  canvas.height = renderCanvas.height
  const targetContext = canvas.getContext('2d')
  if (!targetContext) {
    throw new Error('Target canvas 2D context is unavailable')
  }
  targetContext.clearRect(0, 0, canvas.width, canvas.height)
  targetContext.drawImage(renderCanvas, 0, 0)
}
