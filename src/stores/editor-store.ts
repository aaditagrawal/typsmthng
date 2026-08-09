import { create } from 'zustand'
// Type-only: erased at compile time, does not pull CodeMirror into the home graph.
import type { EditorView } from '@codemirror/view'

export type SaveStatus = 'saved' | 'saving' | 'unsaved'

interface EditorState {
  source: string
  isDirty: boolean
  saveStatus: SaveStatus
  editorView: EditorView | null
  lastUserEditAt: number
  setSource: (source: string) => void
  setDirty: (dirty: boolean) => void
  setEditorView: (view: EditorView | null) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  source: '',
  isDirty: false,
  saveStatus: 'saved',
  editorView: null,
  lastUserEditAt: 0,

  setSource: (source) => {
    set({ source, isDirty: true, saveStatus: 'unsaved', lastUserEditAt: Date.now() })
  },

  setDirty: (isDirty) => set({ isDirty }),
  setEditorView: (editorView) => set({ editorView }),
}))
