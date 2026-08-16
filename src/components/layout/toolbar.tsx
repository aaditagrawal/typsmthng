import { useRef, useState } from 'react'
import { Sun, Moon, Monitor, Download, FolderInput, FolderOutput, Loader2, Settings, PanelLeft, PanelLeftClose } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import { exportProject, importProject } from '@/lib/project-io'
import { exportCurrentProjectPdf } from '@/lib/pdf-export'
import { basename } from '@/lib/paths'

function ThemeToggle() {
  const theme = useUIStore((s) => s.theme)

  const cycle = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    useSettingsStore.getState().setTheme(next)
  }

  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon
  const label = theme === 'system' ? 'Theme: system (click to switch to light)' : theme === 'light' ? 'Theme: light (click to switch to dark)' : 'Theme: dark (click to switch to system)'

  return (
    <button onClick={cycle} className="toolbar-button" title={label} aria-label={label}>
      <Icon size={16} />
    </button>
  )
}

export function Toolbar() {
  const sidebarOpen = useProjectStore((s) => s.sidebarOpen)
  const setSidebarOpen = useProjectStore((s) => s.setSidebarOpen)
  const currentFilePath = useProjectStore((s) => s.currentFilePath)
  const fileName = (currentFilePath && basename(currentFilePath)) || 'main.typ'
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const handleExport = async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      await exportProject()
    } finally {
      setExportBusy(false)
    }
  }

  const handlePdfExport = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      await exportCurrentProjectPdf()
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <header
      className="flex items-center h-10 shrink-0 select-none"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-1 px-3">
        <button
          className="inline-flex items-center justify-center shrink-0"
          onClick={() => {
            const projectStore = useProjectStore.getState()
            const currentPath = projectStore.currentFilePath
            if (currentPath) {
              projectStore.updateFileContent(currentPath, useEditorStore.getState().source)
            }
            projectStore.goHome()
          }}
          title="Back to projects"
          style={{
            width: '24px',
            height: '24px',
            background: 'var(--accent)',
            color: '#fff',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '12px',
            lineHeight: 1,
            borderRadius: '1px',
            letterSpacing: '-0.01em',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          t.
        </button>
        <div style={{ width: '4px' }} />
        <button
          className="toolbar-button"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>
        <button
          className="toolbar-button"
          title="Settings"
          onClick={() => useSettingsStore.getState().setSettingsOpen(true)}
        >
          <Settings size={16} />
        </button>
        <ThemeToggle />
      </div>

      {/* Center -- file tab */}
      <div className="flex-1 flex justify-center">
        <div
          className="flex items-center"
          style={{
            padding: '4px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: '2px',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
          }}
        >
          {fileName}
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1 pl-3 pr-5">
        <input
          ref={importInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file || importBusy) return
            setImportBusy(true)
            try {
              const result = await importProject(file)
              if (!result) {
                window.alert('Could not import that zip. Make sure it contains a Typst or LaTeX project.')
              } else if (result.warnings.length > 0) {
                const preview = result.warnings
                  .slice(0, 5)
                  .map((warning) => `• ${warning.message}`)
                  .join('\n')
                const extra = result.warnings.length > 5
                  ? `\n…and ${result.warnings.length - 5} more`
                  : ''
                window.alert(
                  `Imported "${result.projectName}" with ${result.warnings.length} LaTeX conversion warning(s):\n\n${preview}${extra}`,
                )
              }
            } catch {
              window.alert('Could not import that zip. Make sure it contains a Typst or LaTeX project.')
            } finally {
              setImportBusy(false)
              if (importInputRef.current) importInputRef.current.value = ''
            }
          }}
        />
        <button
          className="toolbar-button"
          title="Import project (.zip)"
          disabled={importBusy}
          onClick={() => importInputRef.current?.click()}
        >
          {importBusy ? <Loader2 size={16} className="animate-spin" /> : <FolderInput size={16} />}
        </button>
        <button
          className="toolbar-button"
          title="Export project (.zip)"
          disabled={exportBusy}
          onClick={() => { void handleExport() }}
        >
          {exportBusy ? <Loader2 size={16} className="animate-spin" /> : <FolderOutput size={16} />}
        </button>
        <button
          className="toolbar-button"
          style={{ marginRight: '8px' }}
          title="Download PDF"
          disabled={pdfBusy}
          onClick={() => { void handlePdfExport() }}
        >
          {pdfBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        </button>
      </div>
    </header>
  )
}
