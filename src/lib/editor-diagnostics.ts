/**
 * Diagnostic highlighting for the CodeMirror editor.
 *
 * Parses Typst compiler diagnostics (with ranges like "19:5-19:31") and renders
 * them as inline underline decorations in the editor, so the user can see
 * exactly which span of code caused the error.
 */

import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { Diagnostic } from '@/stores/compile-store'

/* ── Effect ── */

/** Dispatch with an array of diagnostics to highlight, or empty array to clear. */
export const setDiagnostics = StateEffect.define<Diagnostic[]>()

/* ── Decoration marks ── */

const errorMark = Decoration.mark({ class: 'cm-diagnostic-error' })
const warningMark = Decoration.mark({ class: 'cm-diagnostic-warning' })

/* ── Range parser ── */

/**
 * Parse a Typst diagnostic range string like "19:5-19:31" into
 * { fromLine, fromCol, toLine, toCol } (all 1-based).
 *
 * Also handles single-position ranges like "19:5" (no end position).
 */
function parseRange(range: string): { fromLine: number; fromCol: number; toLine: number; toCol: number } | null {
  if (!range) return null

  const dashIdx = range.indexOf('-')
  if (dashIdx === -1) {
    // Single position: "19:5"
    const parts = range.split(':')
    if (parts.length < 2) return null
    const line = parseInt(parts[0], 10)
    const col = parseInt(parts[1], 10)
    if (isNaN(line) || isNaN(col)) return null
    return { fromLine: line, fromCol: col, toLine: line, toCol: col }
  }

  const startPart = range.slice(0, dashIdx)
  const endPart = range.slice(dashIdx + 1)

  const startParts = startPart.split(':')
  const endParts = endPart.split(':')

  if (startParts.length < 2 || endParts.length < 2) return null

  const fromLine = parseInt(startParts[0], 10)
  const fromCol = parseInt(startParts[1], 10)
  const toLine = parseInt(endParts[0], 10)
  const toCol = parseInt(endParts[1], 10)

  if (isNaN(fromLine) || isNaN(fromCol) || isNaN(toLine) || isNaN(toCol)) return null

  return { fromLine, fromCol, toLine, toCol }
}

/**
 * Convert a 1-based line:col to a 0-based document offset.
 */
function lineColToPos(doc: { line(n: number): { from: number; length: number }; lines: number }, line: number, col: number): number | null {
  if (line < 1 || line > doc.lines) return null
  const lineInfo = doc.line(line)
  // col is 1-based; clamp to line length
  const offset = Math.min(col - 1, lineInfo.length)
  return lineInfo.from + offset
}

/* ── State field ── */

export const diagnosticField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },

  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagnostics)) {
        const diagnostics = e.value
        if (diagnostics.length === 0) return Decoration.none

        const doc = tr.state.doc
        const marks: Range<Decoration>[] = []

        for (const diag of diagnostics) {
          const parsed = parseRange(diag.range)
          if (!parsed) continue

          const from = lineColToPos(doc, parsed.fromLine, parsed.fromCol)
          const to = lineColToPos(doc, parsed.toLine, parsed.toCol)
          if (from === null || to === null) continue

          // Ensure we have a visible range — if from === to, extend to end of line
          const actualTo = from === to
            ? Math.min(from + 1, doc.line(parsed.fromLine).from + doc.line(parsed.fromLine).length)
            : to

          if (from >= actualTo) continue

          const mark = diag.severity === 'warning' ? warningMark : errorMark
          marks.push(mark.range(from, actualTo))
        }

        // Sort by from position (required by CodeMirror)
        marks.sort((a, b) => a.from - b.from || a.to - b.to)
        return Decoration.set(marks)
      }
    }

    // Preserve decorations across unrelated transactions, mapping through edits
    return decos.map(tr.changes)
  },

  provide: (f) => EditorView.decorations.from(f),
})

/**
 * Navigate the editor to the given diagnostic range.
 */
export function jumpToDiagnostic(view: EditorView, diag: Diagnostic): void {
  const parsed = parseRange(diag.range)
  if (!parsed) return

  const from = lineColToPos(view.state.doc, parsed.fromLine, parsed.fromCol)
  if (from === null) return

  view.dispatch({
    selection: { anchor: from },
    scrollIntoView: true,
  })
  view.focus()
}
