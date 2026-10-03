import { describe, expect, it } from 'vitest'
import { centeredCaretScrollTop } from '@/lib/centered-scrolling'
import { useSettingsStore } from '@/stores/settings-store'

describe('centered scrolling', () => {
  it('defaults off and persists the editor switch', () => {
    expect(useSettingsStore.getState().centeredScrolling).toBe(false)
    useSettingsStore.getState().setCenteredScrolling(true)
    expect(useSettingsStore.getState().centeredScrolling).toBe(true)
    useSettingsStore.getState().setCenteredScrolling(false)
  })

  it('scrolls the caret line to the center without moving past the top', () => {
    expect(centeredCaretScrollTop(400, 20, 200)).toBe(310)
    expect(centeredCaretScrollTop(10, 20, 200)).toBe(0)
  })
})
