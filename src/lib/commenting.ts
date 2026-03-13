import type { EditorView } from '@codemirror/view'
import type { ChangeSpec } from '@codemirror/state'

const COMMENT_PREFIX = '// '
const COMMENT_PATTERN = /^(\s*)\/\/ ?/

function getSelectedLineNumbers(view: EditorView): number[] {
  const lines = new Set<number>()

  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number
    const endPos = range.empty ? range.to : Math.max(range.from, range.to - 1)
    const endLine = view.state.doc.lineAt(endPos).number
    for (let line = startLine; line <= endLine; line++) {
      lines.add(line)
    }
  }

  return [...lines].sort((a, b) => a - b)
}

export function toggleTypstLineComment(view: EditorView): boolean {
  const lineNumbers = getSelectedLineNumbers(view)
  if (lineNumbers.length === 0) return false

  const lines = lineNumbers.map((lineNumber) => view.state.doc.line(lineNumber))
  const shouldUncomment = lines.every((line) => COMMENT_PATTERN.test(line.text))

  const changes: ChangeSpec[] = []
  for (const line of lines) {
    const match = COMMENT_PATTERN.exec(line.text)
    const indentLength = line.text.match(/^\s*/)?.[0].length ?? 0

    if (shouldUncomment) {
      if (!match) continue
      changes.push({
        from: line.from + indentLength,
        to: line.from + indentLength + match[0].length - indentLength,
        insert: '',
      })
      continue
    }

    changes.push({
      from: line.from + indentLength,
      insert: COMMENT_PREFIX,
    })
  }

  if (changes.length === 0) return false
  view.dispatch({ changes })
  return true
}
