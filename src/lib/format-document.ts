import type { EditorView } from '@codemirror/view'
import { useProjectStore } from '@/stores/project-store'

/** Typstyle defaults reorder imports. This port must not. */
const FORMAT_CONFIG = { reorder_import_items: false }

/**
 * Format a Typst buffer with Typstyle. The WASM package is loaded on demand
 * so it stays out of the main compiler (the compiler cap is 25 MB; this
 * module is about 659 KB and is a separate asset).
 */
export async function formatTypstSource(source: string): Promise<string> {
  const { format } = await import('@typstyle/typstyle-wasm-bundler')
  return format(source, FORMAT_CONFIG)
}

/** Map a pre-format offset onto the formatted text by line and Unicode column. */
export function mapOffsetAfterFormat(before: string, after: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, before.length))
  const prefix = before.slice(0, clamped)
  const newline = prefix.lastIndexOf('\n')
  const line = prefix.split('\n').length - 1
  const column = Array.from(prefix.slice(newline + 1)).length
  const lines = after.split('\n')
  const lineIndex = Math.min(line, Math.max(lines.length - 1, 0))
  let pos = 0
  for (let index = 0; index < lineIndex; index += 1) {
    pos += (lines[index]?.length ?? 0) + 1
  }
  const target = lines[lineIndex] ?? ''
  pos += Array.from(target).slice(0, Math.min(column, Array.from(target).length)).join('').length
  return Math.min(pos, after.length)
}

/** Replace the whole buffer in one history step. Parse failures and no-ops do nothing. */
export async function formatEditorDocument(view: EditorView): Promise<boolean> {
  const path = useProjectStore.getState().currentFilePath
  if (!path?.toLowerCase().endsWith('.typ')) return false

  const before = view.state.doc.toString()
  const { anchor, head } = view.state.selection.main
  let formatted: string
  try {
    formatted = await formatTypstSource(before)
  } catch {
    return false
  }
  if (formatted === before || view.state.doc.toString() !== before) return false

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: formatted },
    selection: {
      anchor: mapOffsetAfterFormat(before, formatted, anchor),
      head: mapOffsetAfterFormat(before, formatted, head),
    },
  })
  return true
}
