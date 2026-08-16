import type { KeyBinding } from '@codemirror/view'
import { copyLineDown } from '@codemirror/commands'
import { useProjectStore } from '@/stores/project-store'
import { forceCompile } from './compile-manager'
import { useSettingsStore } from '@/stores/settings-store'
import { exportCurrentProjectPdf } from './pdf-export'
import { toggleTypstLineComment } from './commenting'
import { useAiStore } from '@/stores/ai-store'
import { triggerAiInline } from './ai/inline-trigger'

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
  // Mod-j also has a window-level fallback in App.tsx so the theme toggle
  // works when focus is outside CodeMirror; that handler skips events this
  // binding already consumed.
  {
    key: 'Mod-i',
    run: (view) => {
      // Opt-in: fall through to default Mod-i behavior until AI is configured.
      if (!useAiStore.getState().enabled) return false
      return triggerAiInline(view)
    },
  },
  {
    key: 'Mod-j',
    run: () => {
      cycleTheme()
      return true
    },
  },
]

export function cycleTheme(): void {
  const { theme, setTheme } = useSettingsStore.getState()
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  setTheme(next)
}
