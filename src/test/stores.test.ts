import { describe, it, expect } from 'vitest'
import { useUIStore } from '@/stores/ui-store'
import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { resolvePreviewRenderMode, usePreviewStore } from '@/stores/preview-store'

describe('UI Store', () => {
  it('should initialize with dark theme', () => {
    const state = useUIStore.getState()
    expect(state.theme).toBe('dark')
    expect(state.resolvedTheme).toBe('dark')
  })

  it('should cycle themes correctly', () => {
    const store = useUIStore.getState()
    // dark -> system
    store.setTheme('system')
    expect(useUIStore.getState().theme).toBe('system')
    // system -> light
    store.setTheme('light')
    expect(useUIStore.getState().theme).toBe('light')
    expect(useUIStore.getState().resolvedTheme).toBe('light')
    // light -> dark
    store.setTheme('dark')
    expect(useUIStore.getState().theme).toBe('dark')
    expect(useUIStore.getState().resolvedTheme).toBe('dark')
  })

  it('should set cursor position', () => {
    useUIStore.getState().setCursorPosition(10, 5)
    const state = useUIStore.getState()
    expect(state.cursorLine).toBe(10)
    expect(state.cursorCol).toBe(5)
  })

  it('should apply dark class to html element', () => {
    useUIStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    useUIStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('Compile Store', () => {
  it('should initialize with idle status', () => {
    const state = useCompileStore.getState()
    expect(state.status).toBe('idle')
    expect(state.diagnostics).toEqual([])
    expect(state.errorCount).toBe(0)
    expect(state.warningCount).toBe(0)
    expect(state.svg).toBeNull()
    expect(state.autoCompile).toBe(true)
  })

  it('should update status', () => {
    useCompileStore.getState().setStatus('compiling')
    expect(useCompileStore.getState().status).toBe('compiling')
    useCompileStore.getState().setStatus('success')
    expect(useCompileStore.getState().status).toBe('success')
  })

  it('should track svg and page dimensions', () => {
    useCompileStore.getState().setSvgResult('<svg>test</svg>', new Uint8Array([1, 2, 3]), [
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ])
    const state = useCompileStore.getState()
    expect(state.svg).toBe('<svg>test</svg>')
    expect(state.pageDimensions).toHaveLength(2)
    expect(state.totalPages).toBe(2)
  })

  it('should clear preview state', () => {
    useCompileStore.getState().setSvgResult('<svg>test</svg>', new Uint8Array([1, 2, 3]), [
      { width: 595, height: 842 },
    ])
    useCompileStore.getState().setDiagnostics([
      { severity: 'error', path: '/main.typ', range: '1:1-1:2', message: 'boom' },
    ])
    useCompileStore.getState().setStatus('success')

    useCompileStore.getState().clearPreview()
    const state = useCompileStore.getState()
    expect(state.svg).toBeNull()
    expect(state.vectorData).toBeNull()
    expect(state.pageDimensions).toEqual([])
    expect(state.diagnostics).toEqual([])
    expect(state.status).toBe('idle')
  })

  it('should set compile time', () => {
    useCompileStore.getState().setCompileTime(150)
    expect(useCompileStore.getState().compileTime).toBe(150)
  })

  it('should derive diagnostic counts', () => {
    useCompileStore.getState().setDiagnostics([
      { severity: 'error', path: '', range: '', message: 'e1' },
      { severity: 'warning', path: '', range: '', message: 'w1' },
      { severity: 'warning', path: '', range: '', message: 'w2' },
    ])
    const state = useCompileStore.getState()
    expect(state.errorCount).toBe(1)
    expect(state.warningCount).toBe(2)
  })
})

describe('Editor Store', () => {
  it('should initialize with empty source', () => {
    const state = useEditorStore.getState()
    expect(state.source).toBe('')
    expect(state.isDirty).toBe(false)
    expect(state.saveStatus).toBe('saved')
    expect(state.lastUserEditAt).toBe(0)
  })

  it('should update source and mark dirty', () => {
    const before = Date.now()
    useEditorStore.getState().setSource('hello world')
    const state = useEditorStore.getState()
    expect(state.source).toBe('hello world')
    expect(state.isDirty).toBe(true)
    expect(state.lastUserEditAt).toBeGreaterThanOrEqual(before)
  })
})

describe('Preview Store', () => {
  it('should initialize with defaults', () => {
    const state = usePreviewStore.getState()
    expect(state.zoom).toBe(100)
    expect(state.fitMode).toBe('width')
    expect(state.currentPage).toBe(1)
    expect(state.renderMode).toBe('auto')
  })

  it('should zoom in through steps', () => {
    // Reset
    usePreviewStore.setState({ zoom: 100, fitMode: 'custom' })
    usePreviewStore.getState().zoomIn()
    expect(usePreviewStore.getState().zoom).toBe(125)
    expect(usePreviewStore.getState().fitMode).toBe('custom')
  })

  it('should zoom out through steps', () => {
    usePreviewStore.setState({ zoom: 100, fitMode: 'custom' })
    usePreviewStore.getState().zoomOut()
    expect(usePreviewStore.getState().zoom).toBe(75)
  })

  it('should clamp zoom to valid range', () => {
    usePreviewStore.getState().setZoom(500)
    expect(usePreviewStore.getState().zoom).toBe(500)
    usePreviewStore.getState().setZoom(5)
    expect(usePreviewStore.getState().zoom).toBe(10)
  })

  it('should set current page', () => {
    usePreviewStore.getState().setCurrentPage(3)
    expect(usePreviewStore.getState().currentPage).toBe(3)
  })

  it('should resolve auto preview mode based on document length', () => {
    expect(resolvePreviewRenderMode('auto', 2)).toBe('canvas')
    expect(resolvePreviewRenderMode('auto', 8)).toBe('canvas')
    expect(resolvePreviewRenderMode('svg', 12)).toBe('svg')
  })
})
