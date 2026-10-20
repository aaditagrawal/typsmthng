import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { set as idbSet } from 'idb-keyval'
import { useSettingsStore } from '@/stores/settings-store'

vi.mock('idb-keyval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idb-keyval')>()
  return { ...actual, set: vi.fn(actual.set) }
})

const persist = vi.mocked(idbSet)

describe('settings persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    persist.mockReset()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    // Flush while storage mocks and the test environment are still active.
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('handles unavailable IndexedDB without losing the in-memory setting', async () => {
    vi.stubGlobal('indexedDB', undefined)
    useSettingsStore.getState().setFontSize(20)

    await vi.advanceTimersByTimeAsync(300)

    expect(useSettingsStore.getState().fontSize).toBe(20)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      'Failed to persist settings to IDB:', expect.any(TypeError),
    )
  })

  it('catches a synchronous indexedDB.open failure', async () => {
    const error = new DOMException('Storage access denied', 'SecurityError')
    const open = vi.fn(() => { throw error })
    vi.stubGlobal('indexedDB', { open })
    useSettingsStore.getState().setFontSize(21)

    await vi.advanceTimersByTimeAsync(300)

    expect(open).toHaveBeenCalledWith('typsmthng-settings')
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('Failed to persist settings to IDB:', error)
    expect(useSettingsStore.getState().fontSize).toBe(21)
  })

  it('handles a rejected write and permits a later persistence attempt', async () => {
    const error = new Error('Transaction failed')
    persist.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    useSettingsStore.getState().setFontSize(20)
    await vi.advanceTimersByTimeAsync(300)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('Failed to persist settings to IDB:', error)

    useSettingsStore.getState().setFontSize(22)
    await vi.advanceTimersByTimeAsync(300)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenLastCalledWith(
      'user-settings', expect.objectContaining({ fontSize: 22 }), expect.any(Function),
    )
  })

  it('debounces changes and persists the latest fields without transient UI state', async () => {
    persist.mockResolvedValue(undefined)
    useSettingsStore.getState().setFontSize(20)
    await vi.advanceTimersByTimeAsync(200)
    useSettingsStore.getState().setAutoCompile(false)
    await vi.advanceTimersByTimeAsync(299)
    expect(persist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(persist).toHaveBeenCalledExactlyOnceWith('user-settings', {
      fontSize: 20,
      autoCompile: false,
      compileDelay: 100,
      lineWrapping: true,
      lineNumbers: true,
      theme: 'dark',
      vimMode: false,
      pageSize: 'auto',
      systemFontsEnabled: true,
      googleFontsEnabled: true,
    }, expect.any(Function))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('flushes once on pagehide and cancels the pending debounce', async () => {
    persist.mockResolvedValue(undefined)
    useSettingsStore.getState().setLineNumbers(false)
    window.dispatchEvent(new Event('pagehide'))
    await vi.runOnlyPendingTimersAsync()

    expect(persist).toHaveBeenCalledExactlyOnceWith(
      'user-settings', expect.objectContaining({ lineNumbers: false }), expect.any(Function),
    )
    expect(console.warn).not.toHaveBeenCalled()
  })
})
