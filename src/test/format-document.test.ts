import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { formatEditorDocument, formatTypstSource, mapOffsetAfterFormat } from '@/lib/format-document'
import { useProjectStore } from '@/stores/project-store'

describe('format document', () => {
  it('formats with Typstyle in one undo step and does not reorder imports', async () => {
    const source = '#import "a.typ": b, a\n#let x=1'
    const formatted = await formatTypstSource(source)
    const items = formatted.split('\n').find((line) => line.includes('#import'))?.split(':').slice(1).join(':')
    expect(items).toBeTruthy()
    expect(items!.indexOf('b')).toBeLessThan(items!.indexOf('a'))
    expect(formatted).toContain('#let x = 1')

    useProjectStore.setState({ currentFilePath: '/main.typ' })
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [history()],
      }),
    })
    expect(await formatEditorDocument(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(formatted)
    undo(view)
    expect(view.state.doc.toString()).toBe(source)
    expect(await formatEditorDocument(view)).toBe(true)
    expect(await formatEditorDocument(view)).toBe(false)
    view.destroy()
  })

  it('leaves the buffer alone when the source does not parse or the path is not Typst', async () => {
    useProjectStore.setState({ currentFilePath: '/main.typ' })
    const broken = '#let café=('
    const brokenView = new EditorView({
      state: EditorState.create({ doc: broken, extensions: [history()] }),
    })
    expect(await formatEditorDocument(brokenView)).toBe(false)
    expect(brokenView.state.doc.toString()).toBe(broken)
    brokenView.destroy()

    useProjectStore.setState({ currentFilePath: '/notes.md' })
    const notes = new EditorView({ state: EditorState.create({ doc: '#let x=1' }) })
    expect(await formatEditorDocument(notes)).toBe(false)
    expect(notes.state.doc.toString()).toBe('#let x=1')
    notes.destroy()
  })

  it('keeps the caret on the same line and column', () => {
    const before = 'alpha\nbeta'
    const after = 'alpha\nbeta!'
    expect(mapOffsetAfterFormat(before, after, before.indexOf('b'))).toBe(after.indexOf('b'))
    expect(mapOffsetAfterFormat(before, after, before.length)).toBe('alpha\nbeta'.length)
  })
})
