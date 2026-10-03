import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { CONTENT_SEARCH_LIMIT, searchProjectContent } from '@/lib/content-search'
import { jumpToFileLocation, revealPosition } from '@/lib/editor-jump'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'

const files = [
  { path: '/main.typ', content: 'hello needle\nsecond', isBinary: false },
  { path: '/notes.md', content: 'Needle in a heading', isBinary: false },
  { path: '/.typsmthng/template.json', content: 'needle hidden', isBinary: false },
  { path: '/fig.png', content: '', isBinary: true },
  { path: '/empty/.folder', content: '', isBinary: false },
]

describe('project content search', () => {
  it('returns path, line, column, and a collapsed preview', () => {
    expect(searchProjectContent(files, 'needle')).toEqual([
      { path: '/main.typ', line: 1, column: 7, preview: 'hello needle' },
      { path: '/notes.md', line: 1, column: 1, preview: 'Needle in a heading' },
    ])
    expect(searchProjectContent(files, '   ')).toEqual([])
  })

  it('searches the live editor buffer and caps the result list', () => {
    const hits = searchProjectContent(files, 'live', {
      currentPath: '/main.typ',
      currentSource: 'stored\nlive match here',
    })
    expect(hits).toEqual([
      { path: '/main.typ', line: 2, column: 1, preview: 'live match here' },
    ])

    const many = Array.from({ length: CONTENT_SEARCH_LIMIT + 5 }, (_, index) => `row ${index} token`).join('\n')
    expect(searchProjectContent(
      [{ path: '/main.typ', content: many, isBinary: false }],
      'token',
    )).toHaveLength(CONTENT_SEARCH_LIMIT)
  })

  it('counts columns in Unicode characters', () => {
    expect(searchProjectContent(
      [{ path: '/main.typ', content: 'é needle', isBinary: false }],
      'needle',
    )[0]?.column).toBe(3)
  })
})

describe('editor jump', () => {
  it('moves the caret in the open file', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'alpha\nbeta needle\n' }),
    })
    useEditorStore.setState({ editorView: view, editorJump: { path: '/old.typ', line: 1, column: 1 } })
    useProjectStore.setState({ currentFilePath: '/main.typ' })

    jumpToFileLocation('/main.typ', 2, 6)

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2)
    expect(view.state.selection.main.head).toBe('alpha\n'.length + 5)
    expect(useEditorStore.getState().editorJump).toBeNull()
    view.destroy()
  })

  it('selects another file and remembers the position until the editor opens it', () => {
    useEditorStore.setState({ editorView: null, editorJump: null })
    useProjectStore.setState({ currentFilePath: '/other.typ' })

    jumpToFileLocation('/main.typ', 4, 2)

    expect(useProjectStore.getState().currentFilePath).toBe('/main.typ')
    expect(useEditorStore.getState().editorJump).toEqual({ path: '/main.typ', line: 4, column: 2 })
  })

  it('clamps a reveal to the document', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'ab' }) })
    revealPosition(view, 9, 9)
    expect(view.state.selection.main.head).toBe(2)
    view.destroy()
  })
})
