import type { KeyBinding } from '@codemirror/view'
import { useProjectStore } from '@/stores/project-store'
import { useEditorStore } from '@/stores/editor-store'
import { forceCompile } from './compile-manager'
import { useUIStore } from '@/stores/ui-store'
import { exportCurrentProjectPdf } from './pdf-export'
import { toggleTypstLineComment } from './commenting'

export const typstKeymap: KeyBinding[] = [
  {
    key: 'Mod-/',
    run: (view) => toggleTypstLineComment(view),
  },
  {
    key: 'Mod-s',
    run: () => {
      const projectStore = useProjectStore.getState()
      const currentPath = projectStore.currentFilePath
      if (currentPath) {
        projectStore.updateFileContent(currentPath, useEditorStore.getState().source)
      }
      projectStore.saveCurrentProject()
      return true
    },
  },
  {
    key: 'Mod-Enter',
    run: (view) => {
      const currentPath = useProjectStore.getState().currentFilePath
      forceCompile(view.state.doc.toString(), currentPath)
      return true
    },
  },
  {
    key: 'Mod-Shift-Enter',
    run: (view) => {
      void exportCurrentProjectPdf({ liveSource: view.state.doc.toString() })
      return true
    },
  },
  {
    key: 'Mod-j',
    run: () => {
      const { theme, setTheme } = useUIStore.getState()
      const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
      setTheme(next)
      return true
    },
  },
]
