import { create } from 'zustand'
// Type-only: erased at compile time, does not pull CodeMirror into the home graph.
import type { EditorView } from '@codemirror/view'

export type SaveStatus = 'saved' | 'saving' | 'unsaved'

export interface EditorJump {
  path: string
  line: number
  column: number
}

interface EditorState {
  source: string
  isDirty: boolean
  saveStatus: SaveStatus
  editorView: EditorView | null
  lastUserEditAt: number
  editorJump: EditorJump | null
  setSource: (source: string) => void
  setDirty: (dirty: boolean) => void
  setEditorView: (view: EditorView | null) => void
  requestEditorJump: (jump: EditorJump) => void
  clearEditorJump: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  source: '',
  isDirty: false,
  saveStatus: 'saved',
  editorView: null,
  lastUserEditAt: 0,
  editorJump: null,

  setSource: (source) => {
    set({ source, isDirty: true, saveStatus: 'unsaved', lastUserEditAt: Date.now() })
  },

  setDirty: (isDirty) => set({
    isDirty,
    saveStatus: isDirty ? 'unsaved' : 'saved',
  }),
  setEditorView: (editorView) => set({ editorView }),
  requestEditorJump: (editorJump) => set({ editorJump }),
  clearEditorJump: () => set({ editorJump: null }),
}))
