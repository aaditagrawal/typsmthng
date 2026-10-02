import { describe, expect, it, vi } from 'vitest'
import {
  applyEditorZoom,
  createWheelZoomAccumulator,
  editorZoomFromKey,
  showEditorZoomBadge,
  subscribeZoomBadge,
  zoomEditorFont,
} from '@/lib/editor-zoom'
import { useSettingsStore } from '@/stores/settings-store'

describe('editor zoom', () => {
  it('clamps the persisted editor font size to 8–40', () => {
    useSettingsStore.getState().setFontSize(100)
    expect(useSettingsStore.getState().fontSize).toBe(40)
    useSettingsStore.getState().setFontSize(3)
    expect(useSettingsStore.getState().fontSize).toBe(8)
    useSettingsStore.getState().setFontSize(15.4)
    expect(useSettingsStore.getState().fontSize).toBe(15)
  })

  it('steps font size by one point and resets to the default', () => {
    useSettingsStore.setState({ fontSize: 15 })
    expect(zoomEditorFont(15, 1)).toBe(16)
    expect(zoomEditorFont(8, -3)).toBe(8)
    expect(zoomEditorFont(40, 2)).toBe(40)

    applyEditorZoom(2)
    expect(useSettingsStore.getState().fontSize).toBe(17)
    applyEditorZoom('reset')
    expect(useSettingsStore.getState().fontSize).toBe(15)
    applyEditorZoom(-1)
    expect(useSettingsStore.getState().fontSize).toBe(14)
    useSettingsStore.getState().setFontSize(15)
  })

  it('recognizes Ctrl/Cmd zoom keys and ignores unrelated shortcuts', () => {
    expect(editorZoomFromKey({ key: '=', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(1)
    expect(editorZoomFromKey({ key: '+', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(1)
    expect(editorZoomFromKey({ key: '-', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(-1)
    expect(editorZoomFromKey({ key: '_', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(-1)
    expect(editorZoomFromKey({ key: '0', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe('reset')
    expect(editorZoomFromKey({ key: '0', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull()
    expect(editorZoomFromKey({ key: '=', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBeNull()
    expect(editorZoomFromKey({ key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBeNull()
  })

  it('turns pixel-delta wheels into notches and leaves plain scrolling alone', () => {
    const wheel = createWheelZoomAccumulator()
    expect(wheel.push(10, 0)).toBe(0)
    expect(wheel.push(30, 0)).toBe(-1)
    expect(wheel.push(-40, 0)).toBe(1)
    expect(wheel.push(-1, 1)).toBe(1)
    wheel.reset()
    expect(wheel.push(40, 0)).toBe(-1)
  })

  it('shows a transient zoom badge', () => {
    vi.useFakeTimers()
    const labels: Array<string | null> = []
    const unsubscribe = subscribeZoomBadge((label) => labels.push(label))
    showEditorZoomBadge(18)
    expect(labels).toEqual(['18px'])
    vi.advanceTimersByTime(900)
    expect(labels).toEqual(['18px', null])
    unsubscribe()
    vi.useRealTimers()
  })
})
