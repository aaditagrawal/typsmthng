import { useEffect, useRef, useState } from 'react'
import type { PageDimension } from '@/lib/compiler'
import { computePixelPerPt, renderVectorPageToCanvas } from '@/lib/page-renderer'

const RESIZE_DEBOUNCE_MS = 150
const EAGER_RENDER_PAGE_COUNT = 2
const VISIBILITY_ROOT_MARGIN = '320px 0px'

let artifactRevisionCounter = 0
const artifactRevisions = new WeakMap<Uint8Array, number>()

/** Monotonically-increasing revision per compile artifact identity. */
function getArtifactRevision(vectorData: Uint8Array): number {
  let revision = artifactRevisions.get(vectorData)
  if (revision === undefined) {
    revision = ++artifactRevisionCounter
    artifactRevisions.set(vectorData, revision)
  }
  return revision
}

function CanvasPreviewPage({
  vectorData,
  page,
  pageIndex,
  pixelPerPt,
}: {
  vectorData: Uint8Array
  page: PageDimension
  pageIndex: number
  pixelPerPt: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastRenderedKeyRef = useRef<string | null>(null)
  // Without IntersectionObserver support, treat every page as visible.
  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const pageOffset = page.pageOffset ?? pageIndex
  const renderKey = `${getArtifactRevision(vectorData)}:${pageOffset}:${pixelPerPt}`

  // Track live visibility so offscreen pages skip repaints on new compiles and
  // re-render lazily when scrolled back into view.
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => setIsVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: VISIBILITY_ROOT_MARGIN },
    )

    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // The first pages render eagerly so the initial paint does not wait for
    // the observer's first callback.
    const eagerInitial = pageIndex < EAGER_RENDER_PAGE_COUNT && lastRenderedKeyRef.current === null
    if (!isVisible && !eagerInitial) return
    if (lastRenderedKeyRef.current === renderKey) return

    lastRenderedKeyRef.current = renderKey
    canvas.dataset.renderKey = renderKey

    let cancelled = false
    void renderVectorPageToCanvas(
      vectorData,
      pageOffset,
      canvas,
      {
        backgroundColor: '#ffffff',
        pixelPerPt,
        widthPt: page.width,
        heightPt: page.height,
        renderKey,
      },
    ).catch((err) => {
      if (lastRenderedKeyRef.current === renderKey) {
        lastRenderedKeyRef.current = null
      }
      if (!cancelled) {
        console.error(`Failed to render canvas preview page ${pageIndex + 1}:`, err)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isVisible, renderKey, vectorData, pageOffset, pixelPerPt, pageIndex, page.width, page.height])

  return (
    <div
      ref={hostRef}
      className="canvas-preview-page"
      data-page-index={pageIndex}
      style={{
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.08)',
        width: '100%',
        aspectRatio: `${page.width} / ${page.height}`,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
        }}
      />
    </div>
  )
}

export function CanvasPreviewSurface({
  vectorData,
  pageDimensions,
}: {
  vectorData: Uint8Array
  pageDimensions: PageDimension[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [surfaceWidth, setSurfaceWidth] = useState(0)
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => window.devicePixelRatio || 1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      setSurfaceWidth(el.clientWidth)
      setDevicePixelRatio(window.devicePixelRatio || 1)
    }
    measure()

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleMeasure = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        measure()
      }, RESIZE_DEBOUNCE_MS)
    }

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null
    observer?.observe(el)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      {pageDimensions.map((page, pageIndex) => (
        <CanvasPreviewPage
          key={`${page.pageOffset ?? pageIndex}-${page.width}-${page.height}`}
          vectorData={vectorData}
          page={page}
          pageIndex={pageIndex}
          pixelPerPt={computePixelPerPt(surfaceWidth, page.width, devicePixelRatio)}
        />
      ))}
    </div>
  )
}
