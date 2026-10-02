import { EditorView } from '@codemirror/view'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'

export function revealPosition(view: EditorView, line: number, column: number): void {
  const doc = view.state.doc
  const lineNo = Math.min(Math.max(1, line), doc.lines)
  const lineObj = doc.line(lineNo)
  const col = Math.min(Math.max(1, column), lineObj.length + 1)
  const pos = Math.min(lineObj.from + col - 1, doc.length)
  view.dispatch({
    selection: { anchor: pos, head: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  })
  view.focus()
}

export function jumpToFileLocation(path: string, line: number, column: number): void {
  const currentPath = useProjectStore.getState().currentFilePath
  const view = useEditorStore.getState().editorView
  if (view && currentPath === path) {
    useEditorStore.getState().clearEditorJump()
    revealPosition(view, line, column)
    return
  }
  useEditorStore.getState().requestEditorJump({ path, line, column })
  useProjectStore.getState().selectFile(path)
}
