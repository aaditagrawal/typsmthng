import { useUIStore } from '@/stores/ui-store'
import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'

export function StatusBar() {
  const cursorLine = useUIStore((s) => s.cursorLine)
  const cursorCol = useUIStore((s) => s.cursorCol)
  const compileStatus = useCompileStore((s) => s.status)
  const compilerReady = useCompileStore((s) => s.compilerReady)
  const compileTime = useCompileStore((s) => s.compileTime)
  const errors = useCompileStore((s) => s.errorCount)
  const warnings = useCompileStore((s) => s.warningCount)
  const saveStatus = useEditorStore((s) => s.saveStatus)
  const saveError = useProjectStore((s) => s.saveError)
  const vimMode = useSettingsStore((s) => s.vimMode)
  const compilerLabel = compileStatus === 'compiling'
    ? 'Compiling'
    : !compilerReady
      ? 'Initializing'
      : 'Compiler Ready'

  return (
    <footer className="flex items-center justify-between shrink-0 select-none h-7 bg-(--bg-surface) border-t border-t-(color:--border-default) text-(--text-tertiary) font-mono fs-11 tabular-nums tracking-wider uppercase px-2.5">
      <div className="flex items-center gap-3" role="status">
        <span>{compilerLabel}</span>
        {saveError ? (
          <span className="text-(--status-error) font-bold" title={saveError.message}>
            Save failed — {saveError.quota ? 'storage full' : 'error'}
          </span>
        ) : (
          <>
            {saveStatus === 'unsaved' && (
              <span className="text-(--accent) font-bold">Unsaved</span>
            )}
            {saveStatus === 'saving' && (
              <span>Saving...</span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {errors > 0 && (
          <>
            <span className="text-(--status-error)">[{errors}] Error{errors !== 1 ? 's' : ''}</span>
            <div className="w-px h-3.5 bg-(--border-default) shrink-0" />
          </>
        )}
        {warnings > 0 && (
          <>
            <span className="text-(--status-warning)">[{warnings}] Warning{warnings !== 1 ? 's' : ''}</span>
            <div className="w-px h-3.5 bg-(--border-default) shrink-0" />
          </>
        )}
        {compileTime > 0 && (
          <>
            <span>{compileTime}ms</span>
            <div className="w-px h-3.5 bg-(--border-default) shrink-0" />
          </>
        )}
        <span>Ln {cursorLine} : Col {cursorCol}</span>
        <div className="w-px h-3.5 bg-(--border-default) shrink-0" />
        {vimMode && (
          <>
            <span className="text-(--accent) font-bold">VIM</span>
            <div className="w-px h-3.5 bg-(--border-default) shrink-0" />
          </>
        )}
        <span className="text-(--accent) font-bold">Typst</span>
      </div>
    </footer>
  )
}
