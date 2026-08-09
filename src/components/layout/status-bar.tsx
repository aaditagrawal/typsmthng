import { useUIStore } from '@/stores/ui-store'
import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { useSettingsStore } from '@/stores/settings-store'

const separatorStyle = {
  width: '1px',
  height: '14px',
  background: 'var(--border-default)',
  flexShrink: 0,
} as const

export function StatusBar() {
  const cursorLine = useUIStore((s) => s.cursorLine)
  const cursorCol = useUIStore((s) => s.cursorCol)
  const compileStatus = useCompileStore((s) => s.status)
  const compilerReady = useCompileStore((s) => s.compilerReady)
  const compileTime = useCompileStore((s) => s.compileTime)
  const errors = useCompileStore((s) => s.errorCount)
  const warnings = useCompileStore((s) => s.warningCount)
  const saveStatus = useEditorStore((s) => s.saveStatus)
  const vimMode = useSettingsStore((s) => s.vimMode)
  const compilerLabel = compileStatus === 'compiling'
    ? 'Compiling'
    : !compilerReady
      ? 'Initializing'
      : 'Compiler Ready'

  return (
    <footer
      className="flex items-center justify-between shrink-0 select-none"
      style={{
        height: '28px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-default)',
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        padding: '0 10px',
      }}
    >
      <div className="flex items-center gap-3">
        <span>{compilerLabel}</span>
        {saveStatus === 'unsaved' && (
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Unsaved</span>
        )}
        {saveStatus === 'saving' && (
          <span>Saving...</span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {errors > 0 && (
          <>
            <span style={{ color: 'var(--status-error)' }}>[{errors}] Error{errors !== 1 ? 's' : ''}</span>
            <div style={separatorStyle} />
          </>
        )}
        {warnings > 0 && (
          <>
            <span style={{ color: 'var(--status-warning)' }}>[{warnings}] Warning{warnings !== 1 ? 's' : ''}</span>
            <div style={separatorStyle} />
          </>
        )}
        {compileTime > 0 && (
          <>
            <span>{compileTime}ms</span>
            <div style={separatorStyle} />
          </>
        )}
        <span>Ln {cursorLine} : Col {cursorCol}</span>
        <div style={separatorStyle} />
        {vimMode && (
          <>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>VIM</span>
            <div style={separatorStyle} />
          </>
        )}
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Typst</span>
      </div>
    </footer>
  )
}
