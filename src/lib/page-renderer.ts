import { createTypstRenderer, type RenderSession } from '@myriaddreamin/typst.ts'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

interface PageRenderOptions {
  backgroundColor?: string
  pixelPerPt?: number
  widthPt?: number
  heightPt?: number
  /** When set, paint is skipped if the canvas dataset no longer matches. */
  renderKey?: string
}

interface QueuedPageRender {
  vectorData: Uint8Array
  pageOffset: number
  canvas: HTMLCanvasElement
  options?: PageRenderOptions
  resolve: () => void
  reject: (err: unknown) => void
}

let rendererPromise: Promise<Awaited<ReturnType<typeof createTypstRenderer>>> | null = null
/**
 * Pending page renders. Consecutive entries that share the same artifact are
 * painted inside a single WASM session so the artifact is parsed once per
 * compile instead of once per page.
 */
const renderQueue: QueuedPageRender[] = []
/** Serialize WASM session work — the shared renderer is not reentrant. */
let draining = false

async function getRenderer() {
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const renderer = createTypstRenderer()
      await renderer.init({
        getModule: () => ({ module_or_path: rendererWasmUrl }),
      })
      return renderer
    })().catch((err) => {
      rendererPromise = null
      throw err
    })
  }

  return rendererPromise
}

function isQueuedRenderCurrent(entry: QueuedPageRender): boolean {
  if (!entry.canvas.isConnected) return false
  const renderKey = entry.options?.renderKey
  if (!renderKey) return true
  return entry.canvas.dataset.renderKey === renderKey
}

async function paintQueuedRender(session: RenderSession, entry: QueuedPageRender): Promise<void> {
  const pixelPerPt = entry.options?.pixelPerPt ?? 2.5
  const widthPt = entry.options?.widthPt
  const heightPt = entry.options?.heightPt
  const renderCanvas = document.createElement('canvas')
  if (widthPt && heightPt) {
    renderCanvas.width = Math.max(1, Math.ceil(widthPt * pixelPerPt))
    renderCanvas.height = Math.max(1, Math.ceil(heightPt * pixelPerPt))
  }

  const renderContext = renderCanvas.getContext('2d')
  if (!renderContext) {
    throw new Error('Canvas 2D context is unavailable')
  }

  await session.renderCanvas({
    canvas: renderContext,
    pageOffset: entry.pageOffset,
    backgroundColor: entry.options?.backgroundColor ?? '#ffffff',
    pixelPerPt,
    dataSelection: {
      body: true,
    },
  })

  if (!isQueuedRenderCurrent(entry)) return

  const target = entry.canvas
  target.width = renderCanvas.width
  target.height = renderCanvas.height
  const targetContext = target.getContext('2d')
  if (!targetContext) {
    throw new Error('Target canvas 2D context is unavailable')
  }
  targetContext.clearRect(0, 0, target.width, target.height)
  targetContext.drawImage(renderCanvas, 0, 0)
}

async function drainRenderQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (renderQueue.length > 0) {
      const artifact = renderQueue[0].vectorData

      // Pull the run of entries sharing this artifact, dropping stale ones
      // before paying for a session.
      const group: QueuedPageRender[] = []
      while (renderQueue.length > 0 && renderQueue[0].vectorData === artifact) {
        const entry = renderQueue.shift()!
        if (isQueuedRenderCurrent(entry)) {
          group.push(entry)
        } else {
          entry.resolve()
        }
      }
      if (group.length === 0) continue

      let renderer: Awaited<ReturnType<typeof getRenderer>>
      try {
        renderer = await getRenderer()
      } catch (err) {
        for (const entry of group) entry.reject(err)
        continue
      }

      try {
        await renderer.runWithSession(
          { format: 'vector', artifactContent: artifact },
          async (session) => {
            let entry: QueuedPageRender | undefined = group.shift()
            while (entry) {
              if (isQueuedRenderCurrent(entry)) {
                try {
                  await paintQueuedRender(session, entry)
                  entry.resolve()
                } catch (err) {
                  entry.reject(err)
                }
              } else {
                entry.resolve()
              }
              // Also absorb entries enqueued mid-drain for the same artifact.
              entry = group.shift()
                ?? (renderQueue.length > 0 && renderQueue[0].vectorData === artifact
                  ? renderQueue.shift()
                  : undefined)
            }
          },
        )
      } catch (err) {
        // Session setup failed — fail whatever was left unprocessed.
        for (const entry of group) entry.reject(err)
      }
    }
  } finally {
    draining = false
  }
}

const MIN_PIXEL_PER_PT = 1
const MAX_PIXEL_PER_PT = 4.5
const PIXEL_PER_PT_STEP = 0.25
const FALLBACK_PIXEL_PER_PT = 2.25

/**
 * Resolution derived from the actual displayed width and devicePixelRatio,
 * snapped to coarse steps so small resizes do not thrash re-renders.
 */
export function computePixelPerPt(
  surfaceWidth: number,
  pageWidthPt: number,
  devicePixelRatio: number,
): number {
  if (surfaceWidth <= 0 || pageWidthPt <= 0) return FALLBACK_PIXEL_PER_PT
  const raw = (surfaceWidth * devicePixelRatio) / pageWidthPt
  const snapped = Math.ceil(raw / PIXEL_PER_PT_STEP) * PIXEL_PER_PT_STEP
  return Math.min(MAX_PIXEL_PER_PT, Math.max(MIN_PIXEL_PER_PT, snapped))
}

export function renderVectorPageToCanvas(
  vectorData: Uint8Array,
  pageOffset: number,
  canvas: HTMLCanvasElement,
  options?: PageRenderOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    renderQueue.push({ vectorData, pageOffset, canvas, options, resolve, reject })
    void drainRenderQueue()
  })
}
