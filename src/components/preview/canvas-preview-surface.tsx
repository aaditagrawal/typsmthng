import { useEffect, useMemo, useRef, useState } from 'react'
import type { PageDimension } from '@/lib/compiler'
import { renderVectorPageToCanvas } from '@/lib/page-renderer'

function getPixelPerPt(zoomBucket: number): number {
  if (zoomBucket >= 200) return 4
  if (zoomBucket >= 150) return 3.25
  if (zoomBucket >= 125) return 2.75
  return 2.25
}

function resolveRenderZoomBucket(zoom: number, fitMode: 'width' | 'page' | 'custom'): number {
  if (fitMode !== 'custom') return 100
  if (zoom >= 225) return 250
  if (zoom >= 175) return 200
  if (zoom >= 140) return 150
  if (zoom >= 115) return 125
  return 100
}

function CanvasPreviewPage({
  vectorData,
  page,
  pageIndex,
  zoomBucket,
}: {
  vectorData: Uint8Array
  page: PageDimension
  pageIndex: number
  zoomBucket: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shouldRender, setShouldRender] = useState(pageIndex < 2)
  const renderKey = useMemo(
    () => `${page.pageOffset ?? pageIndex}:${zoomBucket}`,
    [page.pageOffset, pageIndex, zoomBucket],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || shouldRender) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true)
          observer.disconnect()
        }
      },
      { rootMargin: '320px 0px' },
    )

    observer.observe(host)
    return () => observer.disconnect()
  }, [shouldRender])

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) return

    let cancelled = false
    const canvas = canvasRef.current
    canvas.dataset.renderKey = renderKey

    void renderVectorPageToCanvas(
      vectorData,
      page.pageOffset ?? pageIndex,
      canvas,
      {
        backgroundColor: '#ffffff',
        pixelPerPt: getPixelPerPt(zoomBucket),
        widthPt: page.width,
        heightPt: page.height,
        renderKey,
      },
    ).catch((err) => {
      if (!cancelled) {
        console.error(`Failed to render canvas preview page ${pageIndex + 1}:`, err)
      }
    })

    return () => {
      cancelled = true
    }
  }, [page.pageOffset, pageIndex, renderKey, shouldRender, vectorData, zoomBucket, page.width, page.height])

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
  zoom,
  fitMode,
}: {
  vectorData: Uint8Array
  pageDimensions: PageDimension[]
  zoom: number
  fitMode: 'width' | 'page' | 'custom'
}) {
  const zoomBucket = resolveRenderZoomBucket(zoom, fitMode)

  return (
    <div
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
          zoomBucket={zoomBucket}
        />
      ))}
    </div>
  )
}
