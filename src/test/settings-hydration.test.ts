import { afterEach, describe, expect, it, vi } from 'vitest'
import { get, set } from 'idb-keyval'
import { useSettingsStore } from '@/stores/settings-store'
import { useUIStore } from '@/stores/ui-store'

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(() => Promise.resolve()), createStore: vi.fn() }))

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('settings hydration', () => {
  it('keeps newer user edits while an IndexedDB read is pending', async () => {
    vi.useFakeTimers()
    let complete: (saved: unknown) => void = () => {}
    vi.mocked(get).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const pending = useSettingsStore.getState().loadSettings()
    useSettingsStore.getState().setFontSize(22)
    useSettingsStore.getState().setTheme('light')
    useSettingsStore.getState().setAutoCompile(false)
    complete({ fontSize: 14, theme: 'dark', autoCompile: true })
    await pending
    expect(useSettingsStore.getState()).toMatchObject({ fontSize: 22, theme: 'light', autoCompile: false })
    expect(useUIStore.getState().theme).toBe('light')
    await vi.advanceTimersByTimeAsync(300)
    expect(set).toHaveBeenLastCalledWith('user-settings', expect.objectContaining({ fontSize: 22, theme: 'light', autoCompile: false }), undefined)
  })

  it('restores saved settings when no user edit intervenes', async () => {
    vi.mocked(get).mockResolvedValueOnce({ fontSize: 14, theme: 'dark', autoCompile: true })
    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState()).toMatchObject({ fontSize: 14, theme: 'dark', autoCompile: true })
  })
})
