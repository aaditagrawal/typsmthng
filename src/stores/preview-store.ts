import { create } from 'zustand'

interface PreviewState {
  zoom: number
  fitMode: 'width' | 'page' | 'custom'
  currentPage: number
  renderMode: PreviewRenderMode
  setZoom: (zoom: number) => void
  setFitMode: (mode: 'width' | 'page' | 'custom') => void
  setCurrentPage: (page: number) => void
  setRenderMode: (mode: PreviewRenderMode) => void
  zoomIn: () => void
  zoomOut: () => void
}

export type PreviewRenderMode = 'auto' | 'svg' | 'canvas'

const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300]
const REVERSED_ZOOM_STEPS = [...ZOOM_STEPS].reverse()
export function resolvePreviewRenderMode(mode: PreviewRenderMode, _totalPages: number): Exclude<PreviewRenderMode, 'auto'> {
  if (mode !== 'auto') return mode
  return 'canvas'
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  zoom: 100,
  fitMode: 'width',
  currentPage: 1,
  renderMode: 'auto',

  setZoom: (zoom) => {
    const nextZoom = Math.max(10, Math.min(500, zoom))
    const state = get()
    if (state.zoom === nextZoom && state.fitMode === 'custom') return
    set({ zoom: nextZoom, fitMode: 'custom' })
  },
  setFitMode: (fitMode) => {
    if (get().fitMode === fitMode) return
    set({ fitMode })
  },
  setCurrentPage: (currentPage) => {
    if (get().currentPage === currentPage) return
    set({ currentPage })
  },
  setRenderMode: (renderMode) => {
    if (get().renderMode === renderMode) return
    set({ renderMode })
  },

  zoomIn: () => {
    const { zoom, fitMode } = get()
    const next = ZOOM_STEPS.find((s) => s > zoom) ?? 300
    if (next === zoom && fitMode === 'custom') return
    set({ zoom: next, fitMode: 'custom' })
  },

  zoomOut: () => {
    const { zoom, fitMode } = get()
    const next = REVERSED_ZOOM_STEPS.find((s) => s < zoom) ?? 25
    if (next === zoom && fitMode === 'custom') return
    set({ zoom: next, fitMode: 'custom' })
  },
}))
