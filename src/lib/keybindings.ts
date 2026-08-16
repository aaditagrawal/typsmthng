import type { KeyBinding } from '@codemirror/view'
import { copyLineDown } from '@codemirror/commands'
import { useProjectStore } from '@/stores/project-store'
import { forceCompile } from './compile-manager'
import { useSettingsStore } from '@/stores/settings-store'
import { exportCurrentProjectPdf } from './pdf-export'
import { toggleTypstLineComment } from './commenting'

export const typstKeymap: KeyBinding[] = [
  {
    key: 'Mod-/',
    run: (view) => toggleTypstLineComment(view),
  },
  {
    key: 'Mod-d',
    run: copyLineDown,
  },
  // Mod-s is handled once at the window level in App.tsx so focus outside
  // CodeMirror still saves, without double-persisting from this keymap.
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
      const { theme, setTheme } = useSettingsStore.getState()
      const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
      setTheme(next)
      return true
    },
  },
]
