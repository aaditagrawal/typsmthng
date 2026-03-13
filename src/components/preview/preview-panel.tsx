import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EditorView } from '@codemirror/view'
import { useCompileStore } from '@/stores/compile-store'
import { resolvePreviewRenderMode, usePreviewStore } from '@/stores/preview-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { resolveSourceLocBatch } from '@/lib/compiler'
import { forceCompile, getInjectedPreambleLineCount } from '@/lib/compile-manager'
import { estimateFallbackLine, findApproxSourceLine, parseSourceSpanToRange } from '@/lib/preview-mapping'
import { jumpToDiagnostic } from '@/lib/editor-diagnostics'
import { perfMark, perfMeasure } from '@/lib/perf'
import { CanvasPreviewSurface } from '@/components/preview/canvas-preview-surface'
import {
  Loader2, AlertCircle, FileText,
  Sparkles, ChevronLeft, ChevronRight,
  ChevronDown, Scissors,
} from 'lucide-react'

const BRUTALIST_FONT = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
}

const dividerStyle = {
  width: '1px',
  height: '18px',
  background: 'var(--border-default)',
  flexShrink: 0,
} as const

const brutalistBtnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: '2px',
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  transition: 'background 0.1s, color 0.1s',
}

function BrutalistBtn({
  children,
  style,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      {...props}
      style={{
        ...brutalistBtnBase,
        ...(hovered && !props.disabled ? { background: 'var(--bg-hover)', color: 'var(--text-primary)' } : {}),
        ...style,
      }}
      onMouseEnter={(e) => { setHovered(true); props.onMouseEnter?.(e) }}
      onMouseLeave={(e) => { setHovered(false); props.onMouseLeave?.(e) }}
    >
      {children}
    </button>
  )
}

const ZOOM_OPTIONS = [
  { type: 'fit' as const, label: 'FIT WIDTH', mode: 'width' as const },
  { type: 'fit' as const, label: 'FIT PAGE', mode: 'page' as const },
  { type: 'divider' as const },
  { type: 'percent' as const, value: 50 },
  { type: 'percent' as const, value: 75 },
  { type: 'percent' as const, value: 100 },
  { type: 'percent' as const, value: 125 },
  { type: 'percent' as const, value: 150 },
  { type: 'percent' as const, value: 200 },
  { type: 'percent' as const, value: 300 },
]

const RENDER_MODE_OPTIONS = [
  { value: 'auto' as const, label: 'AUTO' },
  { value: 'svg' as const, label: 'SVG' },
  { value: 'canvas' as const, label: 'CANVAS' },
]

function ZoomDropdown() {
  const { zoom, fitMode, setFitMode, setZoom } = usePreviewStore(
    useShallow((s) => ({ zoom: s.zoom, fitMode: s.fitMode, setFitMode: s.setFitMode, setZoom: s.setZoom }))
  )
  const [open, setOpen] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const zoomLabel = fitMode === 'width' ? 'FIT-W' : fitMode === 'page' ? 'FIT-P' : `${zoom}%`

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleCustomZoom = () => {
    const val = parseInt(customValue, 10)
    if (!isNaN(val) && val >= 10 && val <= 500) {
      setZoom(val)
      setOpen(false)
      setCustomValue('')
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', marginRight: '8px' }}>
      <BrutalistBtn
        style={{
          width: 'auto',
          padding: '0 12px 0 8px',
          gap: '4px',
          fontWeight: 600,
          ...BRUTALIST_FONT,
        }}
        onClick={() => setOpen(!open)}
        title="Zoom"
      >
        <span>{zoomLabel}</span>
        <ChevronDown size={10} />
      </BrutalistBtn>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: '2px',
            zIndex: 50,
            minWidth: '140px',
            padding: '4px 0',
          }}
        >
          {ZOOM_OPTIONS.map((opt, i) => {
            if (opt.type === 'divider') {
              return (
                <div
                  key={i}
                  style={{
                    height: '1px',
                    background: 'var(--border-default)',
                    margin: '4px 0',
                  }}
                />
              )
            }
            if (opt.type === 'fit') {
              const isActive = fitMode === opt.mode
              return (
                <ZoomMenuItem
                  key={i}
                  label={opt.label}
                  isActive={isActive}
                  onClick={() => {
                    setFitMode(opt.mode)
                    setOpen(false)
                  }}
                />
              )
            }
            // percent
            const isActive = fitMode === 'custom' && zoom === opt.value
            return (
              <ZoomMenuItem
                key={i}
                label={`${opt.value}%`}
                isActive={isActive}
                onClick={() => {
                  setZoom(opt.value!)
                  setOpen(false)
                }}
              />
            )
          })}

          {/* Custom zoom input */}
          <div
            style={{
              height: '1px',
              background: 'var(--border-default)',
              margin: '4px 0',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
            }}
          >
            <input
              ref={customInputRef}
              type="number"
              min={10}
              max={500}
              placeholder="CUSTOM"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCustomZoom()
              }}
              style={{
                width: '60px',
                height: '24px',
                padding: '0 6px',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-default)',
                borderRadius: '2px',
                color: 'var(--text-primary)',
                ...BRUTALIST_FONT,
                fontSize: '10px',
                outline: 'none',
              }}
            />
            <span style={{ ...BRUTALIST_FONT, fontSize: '10px', color: 'var(--text-tertiary)' }}>%</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ZoomMenuItem({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        width: '100%',
        padding: '6px 12px',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        ...BRUTALIST_FONT,
        fontWeight: isActive ? 700 : 400,
      }}
    >
      {label}
    </button>
  )
}

function RenderModeDropdown() {
  const totalPages = useCompileStore((s) => s.totalPages)
  const { renderMode, setRenderMode } = usePreviewStore(
    useShallow((s) => ({ renderMode: s.renderMode, setRenderMode: s.setRenderMode }))
  )
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const resolvedMode = resolvePreviewRenderMode(renderMode, totalPages)

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const label = renderMode === 'auto'
    ? `AUTO:${resolvedMode.toUpperCase()}`
    : renderMode.toUpperCase()

  return (
    <div ref={dropdownRef} style={{ position: 'relative', marginRight: '8px' }}>
      <BrutalistBtn
        style={{
          width: 'auto',
          padding: '0 12px 0 8px',
          gap: '4px',
          fontWeight: 600,
          ...BRUTALIST_FONT,
        }}
        onClick={() => setOpen((value) => !value)}
        title="Preview render mode"
      >
        <span>{label}</span>
        <ChevronDown size={10} />
      </BrutalistBtn>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: '2px',
            zIndex: 50,
            minWidth: '160px',
            padding: '4px 0',
          }}
        >
          {RENDER_MODE_OPTIONS.map((option) => (
            <ZoomMenuItem
              key={option.value}
              label={option.value === 'auto' ? `${option.label} (${resolvedMode.toUpperCase()})` : option.label}
              isActive={renderMode === option.value}
              onClick={() => {
                setRenderMode(option.value)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function useCompileToast() {
  const compileTime = useCompileStore((s) => s.compileTime)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastShownCompileTimeRef = useRef(0)

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (compileTime <= 0 || compileTime === lastShownCompileTimeRef.current) return
    lastShownCompileTimeRef.current = compileTime

    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    showTimerRef.current = setTimeout(() => setToast({ message: `Compiled in ${compileTime}ms`, type: 'success' }), 0)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2000)
  }, [compileTime])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
    }
  }, [])

  return toast
}

function PreviewToolbar({ onNavigate }: { onNavigate?: (page: number) => void }) {
  const { totalPages, errorCount } = useCompileStore(
    useShallow((s) => ({ totalPages: s.totalPages, errorCount: s.errorCount }))
  )
  const { currentPage, setCurrentPage } = usePreviewStore(
    useShallow((s) => ({
      currentPage: s.currentPage,
      setCurrentPage: s.setCurrentPage,
    }))
  )
  const [compileBtnHovered, setCompileBtnHovered] = useState(false)
  const compileToast = useCompileToast()

  const errors = errorCount
  const handleCompile = () => {
    const source = useEditorStore.getState().source
    const currentPath = useProjectStore.getState().currentFilePath
    forceCompile(source, currentPath)
  }

  const navigateTo = (page: number) => {
    setCurrentPage(page)
    onNavigate?.(page)
  }

  return (
    <div
      className="flex items-center justify-between h-10 pl-3 pr-5 shrink-0 select-none"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        ...BRUTALIST_FONT,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {/* Left -- Compile button + toast + errors */}
      <div className="flex items-center" style={{ gap: '8px', paddingLeft: '8px' }}>
        <button
          onClick={handleCompile}
          onMouseEnter={() => setCompileBtnHovered(true)}
          onMouseLeave={() => setCompileBtnHovered(false)}
          className="flex items-center gap-1.5"
          style={{
            height: '28px',
            padding: '0 12px',
            borderRadius: '2px',
            background: compileBtnHovered
              ? 'color-mix(in srgb, var(--accent) 85%, white)'
              : 'var(--accent)',
            color: '#fff',
            border: '1px solid var(--accent)',
            cursor: 'pointer',
            ...BRUTALIST_FONT,
            fontWeight: 700,
            transition: 'background 0.1s',
          }}
        >
          <Sparkles size={12} />
          Compile
        </button>
        {compileToast && (
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '2px',
              background: 'var(--bg-elevated)',
              border: `1px solid ${compileToast.type === 'error' ? 'var(--status-error)' : 'var(--border-strong)'}`,
              color: compileToast.type === 'error' ? 'var(--status-error)' : 'var(--text-secondary)',
              ...BRUTALIST_FONT,
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            {compileToast.message}
          </span>
        )}
        {errors > 0 && (
          <>
            <div style={dividerStyle} />
            <span
              className="flex items-center gap-1"
              style={{ color: 'var(--status-error)', ...BRUTALIST_FONT }}
            >
              <AlertCircle size={12} />
              [{errors}] Error{errors !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Right -- page counter, nav, zoom */}
      <div className="flex items-center" style={{ gap: '8px' }}>
        {/* Page counter */}
        {totalPages > 0 && (
          <>
            <span style={{ color: 'var(--text-secondary)', ...BRUTALIST_FONT }}>
              <span style={{ color: 'var(--text-primary)' }}>{String(currentPage).padStart(2, '0')}</span>
              <span style={{ color: 'var(--text-tertiary)' }}> / {String(totalPages).padStart(2, '0')}</span>
            </span>
            <div style={dividerStyle} />
          </>
        )}

        {/* Page navigation arrows */}
        {totalPages > 1 && (
          <>
            <BrutalistBtn
              style={{
                opacity: currentPage <= 1 ? 0.35 : 1,
                cursor: currentPage <= 1 ? 'default' : 'pointer',
              }}
              onClick={() => navigateTo(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              title="Previous page"
            >
              <ChevronLeft size={14} />
            </BrutalistBtn>
            <BrutalistBtn
              style={{
                opacity: currentPage >= totalPages ? 0.35 : 1,
                cursor: currentPage >= totalPages ? 'default' : 'pointer',
              }}
              onClick={() => navigateTo(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              title="Next page"
            >
              <ChevronRight size={14} />
            </BrutalistBtn>
            <div style={dividerStyle} />
          </>
        )}

        <RenderModeDropdown />
        <div style={dividerStyle} />

        {/* Zoom dropdown */}
        <ZoomDropdown />
      </div>
    </div>
  )
}

function PageIndicator({ totalPages }: { totalPages: number }) {
  const currentPage = usePreviewStore((s) => s.currentPage)
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    requestAnimationFrame(() => setVisible(true))
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(false), 1500)
  }, [])

  useEffect(() => {
    show()
  }, [currentPage, show])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (totalPages <= 1) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '12px',
        right: '12px',
        padding: '4px 10px',
        borderRadius: '2px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-secondary)',
        ...BRUTALIST_FONT,
        fontSize: '10px',
        fontWeight: 600,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        zIndex: 10,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      Page {currentPage} of {totalPages}
    </div>
  )
}


/**
 * Scroll the editor so that `lineNumber` is centred and visible,
 * showing the general area that corresponds to the preview click.
 */
function scrollEditorToArea(fromLineNumber: number, toLineNumber = fromLineNumber) {
  const view = useEditorStore.getState().editorView
  if (!view) return

  const totalLines = view.state.doc.lines
  const from = Math.max(1, Math.min(fromLineNumber, totalLines))
  const to = Math.max(from, Math.min(toLineNumber, totalLines))
  const center = Math.round((from + to) / 2)
  const line = view.state.doc.line(center)

  view.dispatch({
    effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
  })
}

const MIN_ZOOM = 10
const MAX_ZOOM = 500
const WHEEL_ZOOM_SENSITIVITY = 0.5
const ZOOM_COMMIT_DELAY_MS = 150
const PREVIEW_TO_EDITOR_ROLLOVER_LINES = 20
const PREVIEW_CANDIDATE_LIMIT = 72
const PREVIEW_CANDIDATE_POOL_SIZE = PREVIEW_CANDIDATE_LIMIT * 3
const PREVIEW_CANDIDATE_LIMIT_MEDIUM = 48
const PREVIEW_CANDIDATE_LIMIT_LARGE = 32
const MAX_RENDER_NODE_SCAN = 1400
const MAX_TEXT_NODE_SCAN = 1200
const PREVIEW_CLICK_TOAST_DURATION_MS = 1500
const PREVIEW_PAN_DRAG_THRESHOLD_PX = 3
const PREVIEW_LONG_PRESS_DURATION_MS = 450
const PREVIEW_LINK_CLICK_DELAY_MS = 220
const RENDER_NODE_SELECTOR = '.typst-text, .typst-shape, image, path, use'
const PREVIEW_TEXT_SELECTOR = '.tsel'

function clampZoom(zoom: number): number {
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)))
}

function getCurrentVisualZoomPercent(pageEl: HTMLElement): number {
  const parentEl = pageEl.parentElement as HTMLElement | null
  if (!parentEl) return 100

  const pageRect = pageEl.getBoundingClientRect()
  if (pageRect.width <= 0) return 100

  // Use content-box width (excluding padding) since CSS `width: XX%` is
  // relative to the containing block's content width.
  const parentStyle = getComputedStyle(parentEl)
  const parentContentWidth =
    parentEl.clientWidth -
    parseFloat(parentStyle.paddingLeft) -
    parseFloat(parentStyle.paddingRight)
  if (parentContentWidth <= 0) return 100

  return Math.max(MIN_ZOOM, (pageRect.width / parentContentWidth) * 100)
}

function applyZoomStyle(pageEl: HTMLElement, fitMode: 'width' | 'page' | 'custom', zoom: number) {
  // Synchronously update parent alignment so scroll-restore calculations see
  // the correct layout without waiting for a React re-render.
  const parentEl = pageEl.parentElement as HTMLElement | null
  if (parentEl) {
    parentEl.style.alignItems = fitMode === 'custom' ? 'flex-start' : 'center'
  }

  if (fitMode === 'width') {
    pageEl.style.width = '100%'
    pageEl.style.maxWidth = '800px'
    pageEl.style.maxHeight = ''
    pageEl.style.transform = ''
    pageEl.style.transformOrigin = ''
    return
  }
  if (fitMode === 'page') {
    pageEl.style.width = ''
    pageEl.style.maxWidth = '100%'
    pageEl.style.maxHeight = 'calc(100vh - 140px)'
    pageEl.style.transform = ''
    pageEl.style.transformOrigin = ''
    return
  }

  // Use layout scaling instead of CSS transform scaling so zoomed content
  // updates scroll dimensions and edge areas (especially right-side content)
  // remain reachable.
  pageEl.style.width = `${zoom}%`
  pageEl.style.maxWidth = `${8 * zoom}px`
  pageEl.style.maxHeight = ''
  pageEl.style.transform = ''
  pageEl.style.transformOrigin = ''
}

/**
 * Compute page break positions and cumulative page-height ratios.
 */
function usePageMetrics() {
  const pageDimensions = useCompileStore((s) => s.pageDimensions)

  return useMemo(() => {
    if (pageDimensions.length === 0) {
      return {
        breaks: [] as Array<{ percent: number; pageNum: number }>,
        cumulativeRatios: [] as number[],
      }
    }

    const totalHeight = pageDimensions.reduce((sum, p) => sum + p.height, 0)
    if (totalHeight === 0) {
      return {
        breaks: [] as Array<{ percent: number; pageNum: number }>,
        cumulativeRatios: [] as number[],
      }
    }

    const breaks: Array<{ percent: number; pageNum: number }> = []
    const cumulativeRatios: number[] = []
    let cumHeight = 0
    for (let i = 0; i < pageDimensions.length; i++) {
      cumHeight += pageDimensions[i].height
      const ratio = cumHeight / totalHeight
      cumulativeRatios.push(ratio)
      if (i < pageDimensions.length - 1) {
        breaks.push({
          percent: ratio * 100,
          pageNum: i + 2,
        })
      }
    }

    return { breaks, cumulativeRatios }
  }, [pageDimensions])
}

/**
 * A page break indicator overlaid on the SVG preview.
 * Positioned absolutely at the correct % of the SVG height.
 */
function PageBreakLine({ percent, pageNum }: { percent: number; pageNum: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: `${percent}%`,
        left: 0,
        right: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {/* The dashed line */}
      <div
        style={{
          position: 'absolute',
          top: '-0.5px',
          left: 0,
          right: 0,
          height: '1px',
          backgroundImage: 'repeating-linear-gradient(to right, var(--accent) 0, var(--accent) 6px, transparent 6px, transparent 12px)',
        }}
      />
      {/* Page label */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          right: '8px',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 6px',
          borderRadius: '2px',
          background: 'var(--accent)',
          color: '#fff',
          ...BRUTALIST_FONT,
          fontSize: '8px',
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        <Scissors size={8} />
        PAGE {pageNum}
      </div>
    </div>
  )
}

function buildSvgTreePath(target: Element, root: Element): Uint32Array | null {
  const indices: number[] = []
  let el: Element | null = target

  while (el && el !== root) {
    const parentNodeEl: Element | null = el.parentElement
    if (!parentNodeEl) return null

    let idx = 0
    let sib: Element | null = parentNodeEl.firstElementChild
    while (sib && sib !== el) {
      idx++
      sib = sib.nextElementSibling
    }
    if (sib !== el) return null

    indices.unshift(idx)
    el = parentNodeEl
  }

  return el === root ? new Uint32Array(indices) : null
}

interface CandidatePath {
  path: Uint32Array
  distance: number
}

interface ScoredElement {
  el: Element
  distance: number
}

function pushBoundedCandidate(scored: ScoredElement[], candidate: ScoredElement, maxSize: number): void {
  if (scored.length < maxSize) {
    scored.push(candidate)
    return
  }

  let worstIdx = 0
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].distance > scored[worstIdx].distance) worstIdx = i
  }

  if (candidate.distance < scored[worstIdx].distance) {
    scored[worstIdx] = candidate
  }
}

function getCachedElementList<T extends Element>(
  cache: WeakMap<Element, T[]>,
  root: Element,
  selector: string,
): T[] {
  const cached = cache.get(root)
  if (cached && cached.length > 0 && cached[0].isConnected) {
    return cached
  }

  const next = Array.from(root.querySelectorAll(selector)) as T[]
  if (next.length > 0) {
    cache.set(root, next)
  } else {
    cache.delete(root)
  }
  return next
}

function getAdaptiveCandidateLimit(nodeCount: number): number {
  if (nodeCount > 8000) return PREVIEW_CANDIDATE_LIMIT_LARGE
  if (nodeCount > 3000) return PREVIEW_CANDIDATE_LIMIT_MEDIUM
  return PREVIEW_CANDIDATE_LIMIT
}

function collectCandidatePaths(
  svgRoot: Element,
  target: Element,
  clientX: number,
  clientY: number,
  limit = PREVIEW_CANDIDATE_LIMIT,
  renderNodes: Element[] = [],
): CandidatePath[] {
  const scored: ScoredElement[] = []
  const seen = new Set<Element>()

  // 1) Ancestors from clicked node are likely best.
  let cur: Element | null = target
  let depth = 0
  while (cur && cur !== svgRoot) {
    if (!seen.has(cur)) {
      seen.add(cur)
      pushBoundedCandidate(scored, { el: cur, distance: depth * 2 }, PREVIEW_CANDIDATE_POOL_SIZE)
    }
    cur = cur.parentElement
    depth++
  }

  // 2) Elements in the browser hit stack are cheap and usually highly relevant.
  const stack = document.elementsFromPoint(clientX, clientY)
  for (let i = 0; i < stack.length; i++) {
    const node = stack[i]
    if (!svgRoot.contains(node)) continue
    if (seen.has(node)) continue
    seen.add(node)
    pushBoundedCandidate(scored, { el: node, distance: i * 1.5 }, PREVIEW_CANDIDATE_POOL_SIZE)
  }

  // 3) Nearby render nodes around click for robust fallback.
  const nodes = renderNodes.length > 0 ? renderNodes : Array.from(svgRoot.querySelectorAll(RENDER_NODE_SELECTOR))
  const scanStep = nodes.length > MAX_RENDER_NODE_SCAN
    ? Math.ceil(nodes.length / MAX_RENDER_NODE_SCAN)
    : 1

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += scanStep) {
    const node = nodes[nodeIndex]
    if (seen.has(node)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue

    const cx = (rect.left + rect.right) / 2
    const cy = (rect.top + rect.bottom) / 2
    const dy = Math.abs(cy - clientY)
    const dx = Math.abs(cx - clientX)
    const distance = dy + dx * 0.2
    pushBoundedCandidate(scored, { el: node, distance }, PREVIEW_CANDIDATE_POOL_SIZE)
  }

  scored.sort((a, b) => a.distance - b.distance)

  const paths: CandidatePath[] = []
  for (const c of scored.slice(0, limit)) {
    const path = buildSvgTreePath(c.el, svgRoot)
    if (!path) continue
    paths.push({ path, distance: c.distance })
  }

  return paths
}

function pickNearestPreviewText(
  pageEl: HTMLElement,
  target: Element,
  clientX: number,
  clientY: number,
  textNodes: HTMLElement[] = [],
): string | null {
  const direct = target.closest('.tsel') as HTMLElement | null
  if (direct && pageEl.contains(direct)) {
    const text = direct.textContent?.trim() ?? ''
    if (text) return text
  }

  // Fast path through browser hit stack before scanning all text nodes.
  const stack = document.elementsFromPoint(clientX, clientY)
  for (const hit of stack) {
    const hitText = hit.closest(PREVIEW_TEXT_SELECTOR) as HTMLElement | null
    if (!hitText || !pageEl.contains(hitText)) continue
    const text = hitText.textContent?.trim() ?? ''
    if (text) return text
  }

  const nodes = textNodes.length > 0 ? textNodes : Array.from(pageEl.querySelectorAll(PREVIEW_TEXT_SELECTOR)) as HTMLElement[]
  const scanStep = nodes.length > MAX_TEXT_NODE_SCAN
    ? Math.ceil(nodes.length / MAX_TEXT_NODE_SCAN)
    : 1
  let bestText: string | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += scanStep) {
    const node = nodes[nodeIndex]
    const text = node.textContent?.trim() ?? ''
    if (!text) continue
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue

    const cx = (rect.left + rect.right) / 2
    const cy = (rect.top + rect.bottom) / 2
    const dy = Math.abs(cy - clientY)
    const dx = Math.abs(cx - clientX)
    const score = dy + dx * 0.25

    if (score < bestScore) {
      bestScore = score
      bestText = text
    }
  }

  return bestText
}

/**
 * Maps a click on the preview SVG to an approximate source line number.
 *
 * Primary: nearest visible preview text snippet -> approximate source line.
 * Fallback: linear Y-ratio mapping.
 */
function activatePreviewLink(pageEl: HTMLElement, href: string): boolean {
  const trimmedHref = href.trim()
  if (!trimmedHref) return false

  if (trimmedHref.startsWith('#')) {
    const id = trimmedHref.slice(1)
    if (!id) return false
    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id.replace(/["\\]/g, '\\$&')
    const target = pageEl.querySelector(`#${escapedId}`) as HTMLElement | SVGElement | null
    if (!target) return false
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    return true
  }

  if (/^(https?:|mailto:|tel:)/i.test(trimmedHref)) {
    window.open(trimmedHref, '_blank', 'noopener,noreferrer')
    return true
  }

  window.location.assign(trimmedHref)
  return true
}

function getPreviewLinkHref(pageEl: HTMLElement, target: Element): string | null {
  const linkEl = target.closest('a')
  if (!linkEl || !pageEl.contains(linkEl)) return null

  return linkEl.getAttribute('href')
    ?? linkEl.getAttribute('xlink:href')
    ?? linkEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
}

function usePreviewClickHandler(ignoreClickRef?: { current: boolean }) {
  const [clickToast, setClickToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderNodesCacheRef = useRef<WeakMap<Element, Element[]>>(new WeakMap())
  const textNodesCacheRef = useRef<WeakMap<Element, HTMLElement[]>>(new WeakMap())

  const locatePreviewContent = useCallback(async (
    target: Element,
    clientX: number,
    clientY: number,
  ) => {
    if (ignoreClickRef?.current) return
    const clickMapStart = perfMark()
    const pageEl = target.closest('.preview-page') as HTMLElement | null
    if (!pageEl) return

    const editorState = useEditorStore.getState()
    const source = editorState.source
    const totalLines = editorState.editorView?.state.doc.lines ?? source.split('\n').length
    if (totalLines === 0) return

    const rect = pageEl.getBoundingClientRect()
    const yRatio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    const fallbackLine = estimateFallbackLine(yRatio, totalLines)
    let targetLine = fallbackLine

    const vectorData = useCompileStore.getState().vectorData
    const svgRoot = pageEl.querySelector('svg')
    let candidateCount = 0
    let renderNodeCount = 0
    let usedFallbackText = false

    // Primary: renderer pipeline mapping via batch source-loc resolve.
    if (vectorData && svgRoot) {
      const renderNodes = getCachedElementList(renderNodesCacheRef.current, svgRoot, RENDER_NODE_SELECTOR)
      renderNodeCount = renderNodes.length
      const adaptiveLimit = getAdaptiveCandidateLimit(renderNodeCount)
      const candidates = collectCandidatePaths(
        svgRoot,
        target,
        clientX,
        clientY,
        adaptiveLimit,
        renderNodes,
      )
      candidateCount = candidates.length
      if (candidates.length > 0) {
        const injectedPreambleLines = getInjectedPreambleLineCount(source)
        const spans = await resolveSourceLocBatch(vectorData, candidates.map((c) => c.path))
        let best: { line: number; score: number } | null = null

        for (let i = 0; i < spans.length; i++) {
          const span = spans[i]
          if (!span) continue
          const range = parseSourceSpanToRange(span, totalLines, fallbackLine, injectedPreambleLines)
          if (!range) continue

          const mid = Math.round((range.fromLine + range.toLine) / 2)
          const widthPenalty = Math.max(0, range.toLine - range.fromLine) * 0.8
          const geomPenalty = candidates[i].distance * 0.02
          const score = widthPenalty + geomPenalty

          if (!best || score < best.score) {
            best = { line: mid, score }
          }
        }

        if (best) {
          targetLine = best.line
        }
      }
    }

    // Secondary fallback: nearest visible preview text.
    if (targetLine === fallbackLine) {
      usedFallbackText = true
      const textNodes = getCachedElementList(textNodesCacheRef.current, pageEl, PREVIEW_TEXT_SELECTOR)
      const clickedText = pickNearestPreviewText(pageEl, target, clientX, clientY, textNodes)
      const matchedLine = clickedText
        ? findApproxSourceLine(source, clickedText, fallbackLine)
        : null
      if (matchedLine) targetLine = matchedLine
    }

    const fromLine = Math.max(1, targetLine - PREVIEW_TO_EDITOR_ROLLOVER_LINES)
    const toLine = Math.min(totalLines, targetLine + PREVIEW_TO_EDITOR_ROLLOVER_LINES)
    scrollEditorToArea(fromLine, toLine)
    setClickToast(`AREA ~ Ln ${targetLine}`)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setClickToast(null), PREVIEW_CLICK_TOAST_DURATION_MS)
    perfMeasure('preview.click-map', clickMapStart, {
      renderNodes: renderNodeCount,
      candidates: candidateCount,
      fallback: usedFallbackText ? 1 : 0,
    })
  }, [ignoreClickRef])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    void locatePreviewContent(e.target as Element, e.clientX, e.clientY)
  }, [locatePreviewContent])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { clickToast, handleDoubleClick, locatePreviewContent }
}

interface PreviewPanState {
  pointerId: number
  startClientX: number
  startClientY: number
  startScrollLeft: number
  startScrollTop: number
  didMove: boolean
}

interface PreviewLongPressState {
  pointerId: number
  clientX: number
  clientY: number
  target: Element
}

interface ZoomAnchorSnapshot {
  cursorOffsetX: number
  cursorOffsetY: number
  anchorPageIndex?: number
  pageRatioX: number
  pageRatioY: number
}

interface ZoomGestureState {
  baseZoom: number
  currentZoom: number
  /** Cursor X relative to page element's bounding box at gesture start */
  originX: number
  /** Cursor Y relative to page element's bounding box at gesture start */
  originY: number
  /** Cursor viewport X at gesture start (for anchor restore on commit) */
  anchorClientX: number
  /** Cursor viewport Y at gesture start (for anchor restore on commit) */
  anchorClientY: number
}

function clampUnitRatio(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function captureZoomAnchor(
  scrollEl: HTMLDivElement,
  anchorEl: HTMLElement,
  clientX: number,
  clientY: number,
): ZoomAnchorSnapshot | null {
  const scrollRect = scrollEl.getBoundingClientRect()
  const pageRect = anchorEl.getBoundingClientRect()
  if (pageRect.width <= 0 || pageRect.height <= 0) return null

  return {
    cursorOffsetX: clientX - scrollRect.left,
    cursorOffsetY: clientY - scrollRect.top,
    anchorPageIndex: anchorEl.dataset.pageIndex ? Number.parseInt(anchorEl.dataset.pageIndex, 10) : undefined,
    pageRatioX: clampUnitRatio((clientX - pageRect.left) / pageRect.width),
    pageRatioY: clampUnitRatio((clientY - pageRect.top) / pageRect.height),
  }
}

function resolveZoomAnchorElement(rootEl: HTMLDivElement, anchor: ZoomAnchorSnapshot): HTMLElement {
  if (anchor.anchorPageIndex === undefined || Number.isNaN(anchor.anchorPageIndex)) {
    return rootEl
  }

  const pageEl = rootEl.querySelector(`[data-page-index="${anchor.anchorPageIndex}"]`) as HTMLElement | null
  return pageEl ?? rootEl
}

function restoreZoomAnchor(
  scrollEl: HTMLDivElement,
  rootEl: HTMLDivElement,
  anchor: ZoomAnchorSnapshot,
): void {
  const pageEl = resolveZoomAnchorElement(rootEl, anchor)
  const scrollRect = scrollEl.getBoundingClientRect()
  const pageRect = pageEl.getBoundingClientRect()
  if (pageRect.width <= 0 || pageRect.height <= 0) return

  const nextPageContentLeft = scrollEl.scrollLeft + (pageRect.left - scrollRect.left)
  const nextPageContentTop = scrollEl.scrollTop + (pageRect.top - scrollRect.top)

  // Keep the same document-space point under the cursor after layout zoom.
  // `nextPageContentLeft/Top` already include any centering/alignment shift, so
  // subtracting that shift again biases zoom toward the top-left corner.
  const targetScrollLeft = nextPageContentLeft + (anchor.pageRatioX * pageRect.width) - anchor.cursorOffsetX
  const targetScrollTop = nextPageContentTop + (anchor.pageRatioY * pageRect.height) - anchor.cursorOffsetY
  const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
  const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)

  scrollEl.scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft))
  scrollEl.scrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop))
}

function getCanvasAnchorElement(rootEl: HTMLDivElement, clientX: number, clientY: number): HTMLElement {
  const stack = document.elementsFromPoint(clientX, clientY)
  for (const node of stack) {
    const pageEl = node.closest('.canvas-preview-page') as HTMLElement | null
    if (pageEl && rootEl.contains(pageEl)) {
      return pageEl
    }
  }
  return rootEl
}

export function PreviewPanel() {
  const { status, svg, vectorData, diagnostics, pageDimensions, totalPages } = useCompileStore(
    useShallow((s) => ({
      status: s.status,
      svg: s.svg,
      vectorData: s.vectorData,
      diagnostics: s.diagnostics,
      pageDimensions: s.pageDimensions,
      totalPages: s.totalPages,
    }))
  )
  const { setCurrentPage, fitMode, renderMode, zoom } = usePreviewStore(
    useShallow((s) => ({
      setCurrentPage: s.setCurrentPage,
      fitMode: s.fitMode,
      renderMode: s.renderMode,
      zoom: s.zoom,
    }))
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const previewPageRef = useRef<HTMLDivElement>(null)
  const scrollPageFrameRef = useRef<number | null>(null)
  const wheelZoomFrameRef = useRef<number | null>(null)
  const wheelPendingDeltaRef = useRef(0)
  const zoomGestureRef = useRef<ZoomGestureState | null>(null)
  const commitZoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressPreviewClickRef = useRef(false)
  const suppressPreviewClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linkClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressStateRef = useRef<PreviewLongPressState | null>(null)
  const longPressTriggeredRef = useRef(false)
  const panStateRef = useRef<PreviewPanState | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const { breaks: pageBreaks, cumulativeRatios } = usePageMetrics()
  const { clickToast, handleDoubleClick, locatePreviewContent } = usePreviewClickHandler(suppressPreviewClickRef)

  const errors = diagnostics.filter((d) => d.severity === 'error')
  const resolvedRenderMode = resolvePreviewRenderMode(renderMode, totalPages)
  const hasSvg = svg !== null
  const hasCanvas = vectorData !== null && pageDimensions.length > 0
  const hasPreview = resolvedRenderMode === 'canvas' ? hasCanvas : hasSvg
  const interactiveSvg = resolvedRenderMode === 'svg' && hasSvg

  useEffect(() => {
    return () => {
      if (suppressPreviewClickTimerRef.current) {
        clearTimeout(suppressPreviewClickTimerRef.current)
      }
      if (linkClickTimerRef.current) {
        clearTimeout(linkClickTimerRef.current)
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
      if (commitZoomTimeoutRef.current) {
        clearTimeout(commitZoomTimeoutRef.current)
      }
    }
  }, [])

  const handlePanStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactiveSvg || e.pointerType === 'touch' || e.button !== 0) return
    const pageEl = previewPageRef.current
    if (!pageEl || !(e.target instanceof Element) || !pageEl.contains(e.target)) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, label')) return

    panStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: e.currentTarget.scrollLeft,
      startScrollTop: e.currentTarget.scrollTop,
      didMove: false,
    }
    longPressTriggeredRef.current = false
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
    }
    longPressStateRef.current = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      target: e.target as Element,
    }
    longPressTimerRef.current = setTimeout(() => {
      const longPressState = longPressStateRef.current
      if (!longPressState || longPressState.pointerId !== e.pointerId) return
      longPressTimerRef.current = null
      longPressTriggeredRef.current = true
      suppressPreviewClickRef.current = true
      void locatePreviewContent(longPressState.target, longPressState.clientX, longPressState.clientY)
    }, PREVIEW_LONG_PRESS_DURATION_MS)
    setIsPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [interactiveSvg, locatePreviewContent])

  const handlePanMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    if (!panState || panState.pointerId !== e.pointerId) return

    const dx = e.clientX - panState.startClientX
    const dy = e.clientY - panState.startClientY
    if (
      !panState.didMove
      && (Math.abs(dx) > PREVIEW_PAN_DRAG_THRESHOLD_PX || Math.abs(dy) > PREVIEW_PAN_DRAG_THRESHOLD_PX)
    ) {
      panState.didMove = true
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    e.currentTarget.scrollLeft = panState.startScrollLeft - dx
    e.currentTarget.scrollTop = panState.startScrollTop - dy
    if (panState.didMove) e.preventDefault()
  }, [])

  const handlePanEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    if (!panState || panState.pointerId !== e.pointerId) return

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    panStateRef.current = null
    setIsPanning(false)
    longPressStateRef.current = null
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    if (!panState.didMove) return
    suppressPreviewClickRef.current = true
    if (suppressPreviewClickTimerRef.current) {
      clearTimeout(suppressPreviewClickTimerRef.current)
    }
    suppressPreviewClickTimerRef.current = setTimeout(() => {
      suppressPreviewClickRef.current = false
      suppressPreviewClickTimerRef.current = null
    }, 0)
  }, [])

  const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const pageEl = previewPageRef.current
    if (!pageEl) return

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      e.preventDefault()
      e.stopPropagation()
      if (suppressPreviewClickTimerRef.current) {
        clearTimeout(suppressPreviewClickTimerRef.current)
      }
      suppressPreviewClickTimerRef.current = setTimeout(() => {
        suppressPreviewClickRef.current = false
        suppressPreviewClickTimerRef.current = null
      }, 0)
      return
    }

    const href = getPreviewLinkHref(pageEl, e.target as Element)
    if (!href) return

    e.preventDefault()
    e.stopPropagation()
    if (linkClickTimerRef.current) {
      clearTimeout(linkClickTimerRef.current)
    }
    linkClickTimerRef.current = setTimeout(() => {
      linkClickTimerRef.current = null
      activatePreviewLink(pageEl, href)
    }, PREVIEW_LINK_CLICK_DELAY_MS)
  }, [])

  const handlePreviewDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (linkClickTimerRef.current) {
      clearTimeout(linkClickTimerRef.current)
      linkClickTimerRef.current = null
    }
    e.preventDefault()
    e.stopPropagation()
    handleDoubleClick(e)
  }, [handleDoubleClick])

  useEffect(() => {
    const pageEl = previewPageRef.current
    if (!pageEl || !hasPreview) return

    const applyCurrentZoom = () => {
      const state = usePreviewStore.getState()
      applyZoomStyle(pageEl, state.fitMode, state.zoom)
    }

    applyCurrentZoom()

    const unsubscribe = usePreviewStore.subscribe((state, prevState) => {
      if (state.fitMode === prevState.fitMode && state.zoom === prevState.zoom) return
      applyZoomStyle(pageEl, state.fitMode, state.zoom)
    })

    return unsubscribe
  }, [hasPreview])

  // Track current page based on scroll position relative to page breaks
  useEffect(() => {
    const el = scrollRef.current
    const pageEl = previewPageRef.current
    if (!el || !pageEl || !hasPreview || cumulativeRatios.length <= 1) return

    const updateCurrentPageFromScroll = () => {
      scrollPageFrameRef.current = null

      const totalHeight = pageEl.offsetHeight
      if (totalHeight === 0) return

      const scrollRatio = Math.max(0, Math.min(1, el.scrollTop / totalHeight))

      // Find which page the scroll position falls into
      let page = 1
      for (let i = 0; i < cumulativeRatios.length; i++) {
        if (scrollRatio < cumulativeRatios[i]) {
          page = i + 1
          break
        }
        page = i + 1
      }

      if (page !== usePreviewStore.getState().currentPage) {
        setCurrentPage(page)
      }
    }

    const handleScroll = () => {
      if (scrollPageFrameRef.current !== null) return
      scrollPageFrameRef.current = requestAnimationFrame(updateCurrentPageFromScroll)
    }

    handleScroll()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (scrollPageFrameRef.current !== null) {
        cancelAnimationFrame(scrollPageFrameRef.current)
        scrollPageFrameRef.current = null
      }
    }
  }, [hasPreview, cumulativeRatios, setCurrentPage])

  // Scroll to a page break position when navigating
  const scrollToPage = useCallback((page: number) => {
    const el = scrollRef.current
    const pageEl = previewPageRef.current
    if (!el || !pageEl || cumulativeRatios.length === 0) return

    const clampedPage = Math.max(1, Math.min(cumulativeRatios.length, page))
    const ratio = clampedPage <= 1 ? 0 : (cumulativeRatios[clampedPage - 2] ?? 0)
    const targetY = ratio * pageEl.offsetHeight

    // Account for the 32px padding at top
    el.scrollTo({ top: targetY, behavior: 'smooth' })
  }, [cumulativeRatios])

  // Intercept pinch-to-zoom (trackpad) and Ctrl+scroll.
  // Uses GPU-accelerated `transform: scale()` during the gesture (zero reflow),
  // then commits to layout-based `width` once the gesture settles.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const commitZoom = () => {
      commitZoomTimeoutRef.current = null
      const gesture = zoomGestureRef.current
      const pageEl = previewPageRef.current
      const scrollEl = scrollRef.current
      if (!gesture || !pageEl || !scrollEl) return

      const finalZoom = gesture.currentZoom
      zoomGestureRef.current = null

      // Capture anchor while transform is still applied — the transform-origin
      // point stays at the original cursor viewport position.
      const anchorEl = resolvedRenderMode === 'canvas'
        ? getCanvasAnchorElement(pageEl, gesture.anchorClientX, gesture.anchorClientY)
        : pageEl
      const anchor = captureZoomAnchor(
        scrollEl, anchorEl, gesture.anchorClientX, gesture.anchorClientY,
      )

      // setZoom triggers applyZoomStyle which clears the transform and sets
      // layout-based width.
      usePreviewStore.getState().setZoom(finalZoom)

      if (anchor) {
        void scrollEl.offsetHeight
        restoreZoomAnchor(scrollEl, pageEl, anchor)
      }
    }

    const flushPendingZoom = () => {
      wheelZoomFrameRef.current = null
      const pendingDelta = wheelPendingDeltaRef.current
      wheelPendingDeltaRef.current = 0
      if (pendingDelta === 0) return

      const gesture = zoomGestureRef.current
      const pageEl = previewPageRef.current
      if (!gesture || !pageEl) return

      const nextZoom = clampZoom(gesture.currentZoom + pendingDelta)
      if (nextZoom === gesture.currentZoom) return
      gesture.currentZoom = nextZoom

      // GPU-accelerated transform — no DOM reflow regardless of SVG complexity.
      const scale = gesture.currentZoom / gesture.baseZoom
      pageEl.style.transform = `scale(${scale})`
      pageEl.style.transformOrigin = `${gesture.originX}px ${gesture.originY}px`

      // Debounce the layout commit until the gesture settles.
      if (commitZoomTimeoutRef.current !== null) {
        clearTimeout(commitZoomTimeoutRef.current)
      }
      commitZoomTimeoutRef.current = setTimeout(commitZoom, ZOOM_COMMIT_DELAY_MS)
    }

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return

      e.preventDefault()
      const pageEl = previewPageRef.current
      if (!pageEl) return

      // Start a new gesture on the first wheel event.
      if (!zoomGestureRef.current) {
        const store = usePreviewStore.getState()
        const baseZoom = store.fitMode === 'custom'
          ? store.zoom
          : getCurrentVisualZoomPercent(pageEl)
        const pageRect = pageEl.getBoundingClientRect()
        zoomGestureRef.current = {
          baseZoom,
          currentZoom: baseZoom,
          originX: e.clientX - pageRect.left,
          originY: e.clientY - pageRect.top,
          anchorClientX: e.clientX,
          anchorClientY: e.clientY,
        }
      }

      wheelPendingDeltaRef.current += -e.deltaY * WHEEL_ZOOM_SENSITIVITY
      if (wheelZoomFrameRef.current !== null) return
      wheelZoomFrameRef.current = requestAnimationFrame(flushPendingZoom)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      if (wheelZoomFrameRef.current !== null) {
        cancelAnimationFrame(wheelZoomFrameRef.current)
        wheelZoomFrameRef.current = null
      }
      if (commitZoomTimeoutRef.current !== null) {
        clearTimeout(commitZoomTimeoutRef.current)
        commitZoomTimeoutRef.current = null
      }
      wheelPendingDeltaRef.current = 0
      zoomGestureRef.current = null
    }
  }, [resolvedRenderMode])

  return (
    <div className="h-full flex flex-col">
      <PreviewToolbar onNavigate={scrollToPage} />

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onLostPointerCapture={handlePanEnd}
        style={{
          background: 'var(--bg-app)',
          cursor: interactiveSvg ? (isPanning ? 'grabbing' : 'grab') : 'default',
          userSelect: isPanning ? 'none' : undefined,
        }}
      >
        {/* Loading state */}
        {!hasPreview && (status === 'idle' || status === 'compiling') && (
          <div
            className="h-full flex items-center justify-center"
            style={{ minHeight: '200px' }}
          >
            <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span style={BRUTALIST_FONT}>
                {status === 'idle' ? 'Initializing compiler...' : 'Compiling...'}
              </span>
            </div>
          </div>
        )}

        {/* Preview surface */}
        {hasPreview && (
          <div
            className="flex flex-col"
            style={{
              padding: '32px 24px',
              alignItems: fitMode === 'custom' ? 'flex-start' : 'center',
            }}
          >
            <div
              ref={previewPageRef}
              className="preview-page"
              onClick={interactiveSvg ? handlePreviewClick : undefined}
              onDoubleClick={interactiveSvg ? handlePreviewDoubleClick : undefined}
              style={{
                position: 'relative',
                background: resolvedRenderMode === 'svg' ? 'white' : 'transparent',
                borderRadius: 0,
                boxShadow: resolvedRenderMode === 'svg'
                  ? '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.08)'
                  : 'none',
                cursor: interactiveSvg ? (isPanning ? 'grabbing' : 'grab') : 'default',
                width: '100%',
                maxWidth: '800px',
              }}
            >
              {resolvedRenderMode === 'svg' && svg && (
                <>
                  <div dangerouslySetInnerHTML={{ __html: svg }} />
                  {pageBreaks.map((brk) => (
                    <PageBreakLine
                      key={brk.pageNum}
                      percent={brk.percent}
                      pageNum={brk.pageNum}
                    />
                  ))}
                </>
              )}

              {resolvedRenderMode === 'canvas' && vectorData && pageDimensions.length > 0 && (
                <CanvasPreviewSurface
                  vectorData={vectorData}
                  pageDimensions={pageDimensions}
                  zoom={zoom}
                  fitMode={fitMode}
                />
              )}
            </div>
          </div>
        )}

        {/* Error state with no preview */}
        {!hasPreview && status === 'error' && errors.length > 0 && (
          <div
            className="h-full flex items-center justify-center"
            style={{ minHeight: '200px' }}
          >
            <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
              <AlertCircle size={20} style={{ color: 'var(--status-error)' }} />
              <span style={BRUTALIST_FONT}>
                Compilation failed with {errors.length} error{errors.length !== 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  const source = useEditorStore.getState().source
                  const currentPath = useProjectStore.getState().currentFilePath
                  void forceCompile(source, currentPath)
                }}
                style={{
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                  borderRadius: '2px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  ...BRUTALIST_FONT,
                  fontSize: '10px',
                }}
              >
                Retry Compile
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasPreview && (status === 'success' || (status === 'error' && errors.length === 0)) && (
          <div
            className="h-full flex items-center justify-center"
            style={{ minHeight: '200px' }}
          >
            <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
              <FileText size={20} />
              <span style={BRUTALIST_FONT}>
                No preview available
              </span>
            </div>
          </div>
        )}

        {/* Floating page indicator */}
        {hasPreview && (
          <PageIndicator totalPages={totalPages} />
        )}

        {/* Compile toast is now in the toolbar */}

        {/* Page click toast */}
        {clickToast && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 10px',
              borderRadius: '2px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              ...BRUTALIST_FONT,
              fontSize: '10px',
              fontWeight: 600,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {clickToast}
          </div>
        )}
      </div>

      {/* Error panel */}
      {errors.length > 0 && (
        <div
          className="shrink-0 overflow-auto"
          style={{
            maxHeight: '200px',
            padding: '12px 16px',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <div
            style={{
              ...BRUTALIST_FONT,
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--status-error)',
              marginBottom: '8px',
              paddingBottom: '6px',
              borderBottom: '1px solid var(--border-default)',
            }}
          >
            Errors [{errors.length}]
          </div>
          <div className="flex flex-col" style={{ gap: '4px' }}>
            {errors.map((d, i) => (
              <div
                key={i}
                className="flex items-start gap-2"
                style={{
                  ...BRUTALIST_FONT,
                  padding: '4px 0',
                  textTransform: 'none',
                  letterSpacing: 'normal',
                  cursor: d.range ? 'pointer' : 'default',
                  borderRadius: '3px',
                }}
                onClick={() => {
                  if (!d.range) return
                  const view = useEditorStore.getState().editorView
                  if (!view) return
                  // If the error is in a different file, switch to it first
                  const currentPath = useProjectStore.getState().currentFilePath
                  if (d.path && d.path !== currentPath) {
                    useProjectStore.getState().selectFile(d.path)
                    // Wait for file swap to complete before jumping
                    setTimeout(() => {
                      const v = useEditorStore.getState().editorView
                      if (v) jumpToDiagnostic(v, d)
                    }, 100)
                  } else {
                    jumpToDiagnostic(view, d)
                  }
                }}
                onMouseEnter={(e) => {
                  if (d.range) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = ''
                }}
              >
                <AlertCircle size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--status-error)' }} />
                <span style={{ color: 'var(--text-secondary)' }}>
                  {d.path && <span style={{ color: 'var(--text-tertiary)' }}>{d.path}:{d.range} </span>}
                  {d.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
