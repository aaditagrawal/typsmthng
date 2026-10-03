import { describe, expect, it } from 'vitest'
import { isFormatShortcut, isSettingsShortcut, isSidebarShortcut } from '@/lib/workspace-shortcuts'

const base = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }

describe('workspace shortcuts', () => {
  it('opens settings on Ctrl+, and Cmd+,', () => {
    expect(isSettingsShortcut({ ...base, key: ',' })).toBe(true)
    expect(isSettingsShortcut({ ...base, ctrlKey: false, metaKey: true, key: ',' })).toBe(true)
    expect(isSettingsShortcut({ ...base, shiftKey: true, key: ',' })).toBe(false)
    expect(isSettingsShortcut({ ...base, altKey: true, key: ',' })).toBe(false)
    expect(isSettingsShortcut({ ...base, key: 'k' })).toBe(false)
  })

  it('formats on Ctrl+Shift+I', () => {
    expect(isFormatShortcut({ ...base, shiftKey: true, key: 'I' })).toBe(true)
    expect(isFormatShortcut({ ...base, shiftKey: true, key: 'i' })).toBe(true)
    expect(isFormatShortcut({ ...base, key: 'i' })).toBe(false)
    expect(isFormatShortcut({ ...base, shiftKey: true, altKey: true, key: 'I' })).toBe(false)
  })

  it('toggles the sidebar on Ctrl+\\ without treating Vim specially', () => {
    expect(isSidebarShortcut({ ...base, key: '\\' })).toBe(true)
    expect(isSidebarShortcut({ ...base, ctrlKey: false, metaKey: true, key: '\\' })).toBe(true)
    expect(isSidebarShortcut({ ...base, shiftKey: true, key: '\\' })).toBe(false)
    expect(isSidebarShortcut({ ...base, key: '|' })).toBe(false)
  })
})
