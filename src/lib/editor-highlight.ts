/**
 * Temporary source-highlight decoration for the CodeMirror editor.
 *
 * When the user clicks on the preview panel we want to flash a band of lines
 * in the editor so they can see the "general area" that corresponds to the
 * click location.  The highlight fades out automatically after a short delay.
 */

import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/* ── Effect ── */

/** Dispatch with `{ fromLine, toLine }` (1-based) to show highlight, or `null` to clear. */
export const setSourceHighlight = StateEffect.define<{ fromLine: number; toLine: number } | null>()

/* ── Decoration mark ── */

const highlightLine = Decoration.line({ class: 'cm-source-highlight' })

/* ── State field ── */

export const sourceHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },

  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setSourceHighlight)) {
        if (!e.value) return Decoration.none

        const { fromLine, toLine } = e.value
        const doc = tr.state.doc
        const marks: Range<Decoration>[] = []

        for (let ln = Math.max(1, fromLine); ln <= Math.min(toLine, doc.lines); ln++) {
          marks.push(highlightLine.range(doc.line(ln).from))
        }

        return Decoration.set(marks, true)
      }
    }

    // Preserve decorations across unrelated transactions, mapping through edits
    return decos.map(tr.changes)
  },

  provide: (f) => EditorView.decorations.from(f),
})
