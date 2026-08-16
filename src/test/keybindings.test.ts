import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { typstKeymap } from '@/lib/keybindings'

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
})
