import { useRef } from 'react'
import { Sun, Moon, Monitor, Download, FolderInput, FolderOutput, Settings, PanelLeft, PanelLeftClose } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { compileToPdf, ensurePackagesForCompile } from '@/lib/compiler'
import { useSettingsStore } from '@/stores/settings-store'
import { exportProject, importProject } from '@/lib/project-io'
import { applyPagePreamble, ensureCompilerReady } from '@/lib/compile-manager'
import { findPreviewImportSpecs } from '@/lib/universe-registry'
import { buildCompileInputs } from '@/lib/compile-inputs'

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

async function handleDownloadPdf() {
  try {
    await ensureCompilerReady()
    const project = useProjectStore.getState().getCurrentProject()
    const currentFilePath = useProjectStore.getState().currentFilePath
    const liveSource = useEditorStore.getState().source
    const compileInputs = buildCompileInputs({
      project,
      currentFilePath,
      liveSource,
    })

    const packageSpecs = new Set<string>(findPreviewImportSpecs(compileInputs.mainSource))
    for (const file of compileInputs.extraFiles) {
      for (const spec of findPreviewImportSpecs(file.content)) {
        packageSpecs.add(spec)
      }
    }

    if (packageSpecs.size > 0) {
      await ensurePackagesForCompile([...packageSpecs])
    }

    const pdf = await compileToPdf(
      applyPagePreamble(compileInputs.mainSource),
      compileInputs.extraFiles,
      compileInputs.mainPath,
      compileInputs.extraBinaryFiles,
    )
    if (pdf) {
      const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project?.name ?? 'document'}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
  } catch (err) {
    console.error('Failed to export PDF:', err)
    window.alert('Failed to export PDF. Please try again.')
  }
}

export function Toolbar() {
  const sidebarOpen = useProjectStore((s) => s.sidebarOpen)
  const setSidebarOpen = useProjectStore((s) => s.setSidebarOpen)
  const currentFilePath = useProjectStore((s) => s.currentFilePath)
  const fileName = currentFilePath?.split('/').pop() ?? 'main.typ'
  const importInputRef = useRef<HTMLInputElement>(null)

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
            if (file) {
              const result = await importProject(file)
              if (result && result.warnings.length > 0) {
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
              e.target.value = ''
            }
          }}
        />
        <button
          className="toolbar-button"
          title="Import project (.zip)"
          onClick={() => importInputRef.current?.click()}
        >
          <FolderInput size={16} />
        </button>
        <button className="toolbar-button" title="Export project (.zip)" onClick={exportProject}>
          <FolderOutput size={16} />
        </button>
        <button className="toolbar-button" style={{ marginRight: '8px' }} title="Download PDF" onClick={handleDownloadPdf}>
          <Download size={16} />
        </button>
      </div>
    </header>
  )
}
