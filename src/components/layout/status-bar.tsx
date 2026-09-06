import * as stylex from '@stylexjs/stylex'
import { useUIStore } from '@/stores/ui-store'
import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
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
  const saveError = useProjectStore((s) => s.saveError)
  const vimMode = useSettingsStore((s) => s.vimMode)
  const compilerLabel = compileStatus === 'compiling'
    ? 'Compiling'
    : !compilerReady
      ? 'Initializing'
      : 'Compiler Ready'

  return (
    <footer
      {...stylex.props(styles.element1)}
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
      <div {...stylex.props(styles.element2)} role="status">
        <span>{compilerLabel}</span>
        {saveError ? (
          <span style={{ color: 'var(--status-error)', fontWeight: 700 }} title={saveError.message}>
            Save failed — {saveError.quota ? 'storage full' : 'error'}
          </span>
        ) : (
          <>
            {saveStatus === 'unsaved' && (
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Unsaved</span>
            )}
            {saveStatus === 'saving' && (
              <span>Saving...</span>
            )}
          </>
        )}
      </div>

      <div {...stylex.props(styles.element3)}>
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

const styles = stylex.create({
  "element1": {
    "display": "flex",
    "flexShrink": 0,
    "alignItems": "center",
    "justifyContent": "space-between",
    "userSelect": "none"
  },
  "element2": {
    "display": "flex",
    "alignItems": "center",
    "gap": "calc(var(--spacing) * 3)"
  },
  "element3": {
    "display": "flex",
    "alignItems": "center",
    "gap": "calc(var(--spacing) * 2.5)"
  }
})
