import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cycleTheme, typstKeymap } from '@/lib/keybindings'
import { useSettingsStore } from '@/stores/settings-store'

describe('editor keybindings', () => {
  it('duplicates the selected line with Mod-D', () => {
    const binding = typstKeymap.find(({ key }) => key === 'Mod-d')
    const view = new EditorView({
      state: EditorState.create({ doc: 'first\nsecond' }),
    })

    expect(binding?.run?.(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('first\nfirst\nsecond')
    view.destroy()
  })

  it('does not define a second Mod-S handler', () => {
    expect(typstKeymap.some(({ key }) => key?.toLowerCase() === 'mod-s')).toBe(false)
  })

  it('cycles the theme with Mod-J', () => {
    const binding = typstKeymap.find(({ key }) => key === 'Mod-j')
    const view = new EditorView({
      state: EditorState.create({ doc: '' }),
    })

    useSettingsStore.setState({ theme: 'system' })
    expect(binding?.run?.(view)).toBe(true)
    expect(useSettingsStore.getState().theme).toBe('light')
    expect(binding?.run?.(view)).toBe(true)
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(binding?.run?.(view)).toBe(true)
    expect(useSettingsStore.getState().theme).toBe('system')
    view.destroy()
  })

  it('exposes the same cycle for the window-level Mod-J fallback', () => {
    useSettingsStore.setState({ theme: 'light' })
    cycleTheme()
    expect(useSettingsStore.getState().theme).toBe('dark')
  })
})
