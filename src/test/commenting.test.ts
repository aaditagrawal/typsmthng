import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { toggleTypstLineComment } from '@/lib/commenting'

function createTestView(doc: string, selection: EditorSelection) {
  let state = EditorState.create({ doc, selection })

  return {
    get state() {
      return state
    },
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      state = state.update(spec).state
    },
  }
}

describe('toggleTypstLineComment', () => {
  it('comments the current line', () => {
    const view = createTestView('Hello world', EditorSelection.single(0))

    expect(toggleTypstLineComment(view as never)).toBe(true)
    expect(view.state.doc.toString()).toBe('// Hello world')
  })

  it('uncomments commented lines', () => {
    const view = createTestView('  // Hello world', EditorSelection.single(0))

    expect(toggleTypstLineComment(view as never)).toBe(true)
    expect(view.state.doc.toString()).toBe('  Hello world')
  })

  it('comments all selected lines at their indentation level', () => {
    const doc = ['alpha', '  beta', 'gamma'].join('\n')
    const view = createTestView(doc, EditorSelection.single(0, doc.length))

    expect(toggleTypstLineComment(view as never)).toBe(true)
    expect(view.state.doc.toString()).toBe(['// alpha', '  // beta', '// gamma'].join('\n'))
  })
})
