import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { persist } = vi.hoisted(() => ({ persist: vi.fn() }))
vi.mock('idb-keyval', () => ({ createStore: () => 'settings-test', get: vi.fn(), set: persist }))

import { useSettingsStore } from '@/stores/settings-store'

describe('settings persistence failures', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    persist.mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['synchronous', 'asynchronous'])('handles %s storage failures without an uncaught error', async (mode) => {
    const error = new Error('Storage unavailable')
    if (mode === 'synchronous') persist.mockImplementationOnce(() => { throw error })
    else persist.mockRejectedValueOnce(error)
    useSettingsStore.getState().setFontSize(19)
    await vi.runAllTimersAsync()
    expect(console.warn).toHaveBeenCalledWith('Failed to persist settings to IDB:', error)
    expect(useSettingsStore.getState().fontSize).toBe(19)
    useSettingsStore.getState().setFontSize(20)
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('flushes the latest settings on pagehide before the debounce expires', async () => {
    useSettingsStore.getState().setFontSize(21)
    window.dispatchEvent(new Event('pagehide'))
    expect(persist).toHaveBeenCalledWith('user-settings', expect.objectContaining({ fontSize: 21 }), 'settings-test')
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
