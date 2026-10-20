import { useRef, useCallback, useId } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore, PAGE_SIZE_OPTIONS } from '@/stores/settings-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import type { PageSize } from '@/stores/settings-store'
import { forceCompile } from '@/lib/compile-manager'
import { useModalA11y } from '@/components/ui/context-menu'

type Theme = 'light' | 'dark' | 'system'

function Toggle({ checked, onChange, labelId }: {
  checked: boolean
  onChange: (v: boolean) => void
  labelId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
      className="relative w-9 h-5 rounded-xs border border-(color:--border-default) bg-(--tog-bg) cursor-pointer transition-colors duration-150 shrink-0 p-0"
      style={{ '--tog-bg': checked ? 'var(--accent)' : 'var(--bg-inset)' }}
    >
      <span
        className="absolute top-0.5 left-(--knob-x) w-3.5 h-3.5 rounded-xs bg-white transition-all duration-150"
        style={{ '--knob-x': checked ? '18px' : '2px' }}
      />
    </button>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode | ((labelId: string) => React.ReactNode)
}) {
  const labelId = useId()
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-b-(color:--border-subtle) gap-3">
      <div className="flex-1 min-w-0">
        <div
          id={labelId}
          className="font-mono fs-12 text-(--text-primary) tracking-(--ls)"
          style={{ '--ls': '0.02em' }}
        >
          {label}
        </div>
        {description && (
          <div className="font-mono fs-11 text-(--text-tertiary) mt-0.5">
            {description}
          </div>
        )}
      </div>
      {typeof children === 'function' ? children(labelId) : children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono fs-11 font-semibold text-(--text-tertiary) tracking-(--ls) uppercase mt-5 mb-1"
      style={{ '--ls': '0.08em' }}
    >
      {children}
    </div>
  )
}

function ThemeSegment({ value, onChange, labelId }: {
  value: Theme
  onChange: (v: Theme) => void
  labelId?: string
}) {
  const options: { label: string; value: Theme }[] = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'System', value: 'system' },
  ]

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex border border-(color:--border-default) rounded-xs overflow-hidden"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className="font-mono fs-11 tracking-(--ls) py-1 px-3 border-none border-r-(length:--seg-bw) border-r-(color:--border-default) bg-(--seg-bg) text-(--seg-fg) cursor-pointer transition-colors duration-100"
          style={{
            '--ls': '0.02em',
            '--seg-bw': opt.value !== 'system' ? '1px' : '0px',
            '--seg-bg': value === opt.value ? 'var(--accent)' : 'var(--bg-inset)',
            '--seg-fg': value === opt.value ? 'var(--accent-text)' : 'var(--text-secondary)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsModal() {
  const {
    open, setOpen,
    fontSize, setFontSize,
    autoCompile, setAutoCompile,
    compileDelay, setCompileDelay,
    lineWrapping, setLineWrapping,
    lineNumbers, setLineNumbers,
    theme, setTheme,
    vimMode, setVimMode,
    pageSize, setPageSize,
    systemFontsEnabled, setSystemFontsEnabled,
    googleFontsEnabled, setGoogleFontsEnabled,
  } = useSettingsStore(useShallow((s) => ({
    open: s.settingsOpen, setOpen: s.setSettingsOpen,
    fontSize: s.fontSize, setFontSize: s.setFontSize,
    autoCompile: s.autoCompile, setAutoCompile: s.setAutoCompile,
    compileDelay: s.compileDelay, setCompileDelay: s.setCompileDelay,
    lineWrapping: s.lineWrapping, setLineWrapping: s.setLineWrapping,
    lineNumbers: s.lineNumbers, setLineNumbers: s.setLineNumbers,
    theme: s.theme, setTheme: s.setTheme,
    vimMode: s.vimMode, setVimMode: s.setVimMode,
    pageSize: s.pageSize, setPageSize: s.setPageSize,
    systemFontsEnabled: s.systemFontsEnabled, setSystemFontsEnabled: s.setSystemFontsEnabled,
    googleFontsEnabled: s.googleFontsEnabled, setGoogleFontsEnabled: s.setGoogleFontsEnabled,
  })))

  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const handleClose = useCallback(() => setOpen(false), [setOpen])
  const forceRecompile = useCallback(() => {
    void forceCompile(
      useEditorStore.getState().source,
      useProjectStore.getState().currentFilePath,
    )
  }, [])
  const handleSystemFontsChange = useCallback((enabled: boolean) => {
    setSystemFontsEnabled(enabled)
    forceRecompile()
  }, [forceRecompile, setSystemFontsEnabled])
  const handleGoogleFontsChange = useCallback((enabled: boolean) => {
    setGoogleFontsEnabled(enabled)
    forceRecompile()
  }, [forceRecompile, setGoogleFontsEnabled])
  const handlePageSizeChange = useCallback((size: PageSize) => {
    setPageSize(size)
    forceRecompile()
  }, [forceRecompile, setPageSize])

  useModalA11y(panelRef, open, handleClose)

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) handleClose()
      }}
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="w-(--panel-w) max-w-120 max-h-(--panel-maxh) bg-(--bg-surface) border border-(color:--border-strong) rounded-xs flex flex-col overflow-hidden"
        style={{
          '--panel-w': 'calc(100% - 48px)',
          '--panel-maxh': 'calc(100vh - 80px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-b-(color:--border-default)">
          <span
            className="font-mono fs-14 font-semibold tracking-(--ls) uppercase text-(--text-primary)"
            style={{ '--ls': '0.08em' }}
          >
            Settings
          </span>
          <button
            onClick={handleClose}
            aria-label="Close settings"
            className="inline-flex items-center justify-center size-7 border border-transparent rounded-xs bg-transparent text-(--text-secondary) cursor-pointer transition-colors duration-100"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pt-1 pb-4 overflow-y-auto flex-1">
          <SectionLabel>Editor</SectionLabel>

          <SettingRow label="Font Size">
            {(labelId) => (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={12}
                  max={24}
                  value={fontSize}
                  aria-labelledby={labelId}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-20 accent-(--accent)"
                />
                <span className="font-mono fs-12 text-(--text-secondary) min-w-7 text-right">
                  {fontSize}px
                </span>
              </div>
            )}
          </SettingRow>

          <SettingRow label="Line Wrapping" description="Wrap long lines in the editor">
            {(labelId) => <Toggle checked={lineWrapping} onChange={setLineWrapping} labelId={labelId} />}
          </SettingRow>

          <SettingRow label="Line Numbers" description="Show line numbers in the gutter">
            {(labelId) => <Toggle checked={lineNumbers} onChange={setLineNumbers} labelId={labelId} />}
          </SettingRow>

          <SettingRow label="Vim Mode" description="Experimental vim keybindings">
            {(labelId) => <Toggle checked={vimMode} onChange={setVimMode} labelId={labelId} />}
          </SettingRow>

          <SectionLabel>Appearance</SectionLabel>

          <SettingRow label="Theme">
            {(labelId) => <ThemeSegment value={theme} onChange={setTheme} labelId={labelId} />}
          </SettingRow>

          <SectionLabel>Document</SectionLabel>

          <SettingRow label="Page Size" description="Overridden by #set page() in source">
            {(labelId) => (
            <select
              value={pageSize}
              aria-labelledby={labelId}
              onChange={(e) => handlePageSizeChange(e.target.value as PageSize)}
              className="font-mono fs-11 tracking-(--ls) py-1 px-2 bg-(--bg-inset) border border-(color:--border-default) rounded-xs text-(--text-primary) cursor-pointer outline-none"
              style={{ '--ls': '0.02em' }}
            >
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            )}
          </SettingRow>

          <SettingRow label="Device Fonts" description="Use fonts installed on this device when the browser allows access">
            {(labelId) => <Toggle checked={systemFontsEnabled} onChange={handleSystemFontsChange} labelId={labelId} />}
          </SettingRow>

          <SettingRow
            label="Google Fonts"
            description={'Auto-import declared Google Font families, like font: "Inter"'}
          >
            {(labelId) => <Toggle checked={googleFontsEnabled} onChange={handleGoogleFontsChange} labelId={labelId} />}
          </SettingRow>

          <SectionLabel>Compiler</SectionLabel>

          <SettingRow label="Auto Compile" description="Compile automatically on changes">
            {(labelId) => <Toggle checked={autoCompile} onChange={setAutoCompile} labelId={labelId} />}
          </SettingRow>

          <SettingRow label="Compile Delay" description="Delay before auto-compile triggers (ms)">
            {(labelId) => (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={50}
                  max={2000}
                  step={50}
                  value={compileDelay}
                  aria-labelledby={labelId}
                  onChange={(e) => setCompileDelay(Number(e.target.value))}
                  className="w-20 accent-(--accent)"
                />
                <span className="font-mono fs-12 text-(--text-secondary) min-w-10.5 text-right">
                  {compileDelay}ms
                </span>
              </div>
            )}
          </SettingRow>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-t-(color:--border-default) flex items-center justify-between">
          <span className="font-mono fs-11 text-(--text-tertiary)">
            Changes saved automatically
          </span>
          <button
            onClick={handleClose}
            className="font-mono fs-12 tracking-(--ls) py-1.25 px-4 border border-(color:--border-default) rounded-xs bg-(--bg-inset) text-(--text-secondary) cursor-pointer transition-colors duration-100"
            style={{ '--ls': '0.04em' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
              e.currentTarget.style.borderColor = 'var(--border-strong)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-inset)'
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.borderColor = 'var(--border-default)'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
