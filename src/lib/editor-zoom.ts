import {
  DEFAULT_EDITOR_FONT_SIZE,
  clampEditorFontSize,
  useSettingsStore,
} from '@/stores/settings-store'

const ZOOM_BADGE_MS = 900
/** Touchpads report pixel deltas; this many pixels count as one wheel notch. */
const SURFACE_PIXELS_PER_STEP = 40

export interface ZoomKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Positive steps zoom in. `reset` restores the default editor size. */
export function editorZoomFromKey(event: ZoomKeyEvent): number | 'reset' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  // Shift is allowed only so Ctrl++ and Ctrl+_ work on layouts where those are shifted.
  if (event.shiftKey && event.key !== '+' && event.key !== '_') return null
  if (event.key === '0') return 'reset'
  if (event.key === '=' || event.key === '+') return 1
  if (event.key === '-' || event.key === '_') return -1
  return null
}

export function zoomEditorFont(size: number, steps: number): number {
  return clampEditorFontSize(size + steps)
}

export function createWheelZoomAccumulator() {
  let accumulated = 0
  return {
    reset() {
      accumulated = 0
    },
    /** Whole notches to apply. Positive zooms in (scroll up). */
    push(deltaY: number, deltaMode: number): number {
      const delta = deltaMode === 0 ? deltaY / SURFACE_PIXELS_PER_STEP : deltaY
      accumulated -= delta
      const steps = Math.trunc(accumulated)
      if (steps === 0) return 0
      accumulated -= steps
      return steps
    },
  }
}

type BadgeListener = (label: string | null) => void
const badgeListeners = new Set<BadgeListener>()
let badgeTimer: ReturnType<typeof setTimeout> | null = null

export function subscribeZoomBadge(listener: BadgeListener): () => void {
  badgeListeners.add(listener)
  return () => {
    badgeListeners.delete(listener)
  }
}

export function showEditorZoomBadge(size: number): void {
  const label = `${size}px`
  for (const listener of badgeListeners) listener(label)
  if (badgeTimer) clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => {
    badgeTimer = null
    for (const listener of badgeListeners) listener(null)
  }, ZOOM_BADGE_MS)
}

export function applyEditorZoom(change: number | 'reset'): void {
  const { fontSize, setFontSize } = useSettingsStore.getState()
  const next = change === 'reset' ? DEFAULT_EDITOR_FONT_SIZE : zoomEditorFont(fontSize, change)
  showEditorZoomBadge(next)
  if (next !== fontSize) setFontSize(next)
}
