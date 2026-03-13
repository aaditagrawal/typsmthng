import { useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore, PAGE_SIZE_OPTIONS } from '@/stores/settings-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import type { PageSize } from '@/stores/settings-store'
import { forceCompile } from '@/lib/compile-manager'

type Theme = 'light' | 'dark' | 'system'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
      style={{
        position: 'relative',
        width: '36px',
        height: '20px',
        borderRadius: '2px',
        border: '1px solid var(--border-default)',
        background: checked ? 'var(--accent)' : 'var(--bg-inset)',
        cursor: 'pointer',
        transition: 'background 150ms ease',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '18px' : '2px',
          width: '14px',
          height: '14px',
          borderRadius: '2px',
          background: '#fff',
          transition: 'left 150ms ease',
        }}
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
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--border-subtle)',
        gap: '12px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              marginTop: '2px',
            }}
          >
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        marginTop: '20px',
        marginBottom: '4px',
      }}
    >
      {children}
    </div>
  )
}

function ThemeSegment({ value, onChange }: { value: Theme; onChange: (v: Theme) => void }) {
  const options: { label: string; value: Theme }[] = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'System', value: 'system' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid var(--border-default)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.02em',
            padding: '4px 12px',
            border: 'none',
            borderRight: opt.value !== 'system' ? '1px solid var(--border-default)' : 'none',
            background: value === opt.value ? 'var(--accent)' : 'var(--bg-inset)',
            color: value === opt.value ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'background 100ms ease, color 100ms ease',
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

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, handleClose])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) handleClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
      }}
    >
      <div
        style={{
          width: 'calc(100% - 48px)',
          maxWidth: '480px',
          maxHeight: 'calc(100vh - 80px)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '2px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: 'var(--text-primary)',
            }}
          >
            Settings
          </span>
          <button
            onClick={handleClose}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              border: '1px solid transparent',
              borderRadius: '2px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'background 100ms ease, color 100ms ease',
            }}
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
        <div
          style={{
            padding: '4px 16px 16px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          <SectionLabel>Editor</SectionLabel>

          <SettingRow label="Font Size">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min={12}
                max={24}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                style={{
                  width: '80px',
                  accentColor: 'var(--accent)',
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  minWidth: '28px',
                  textAlign: 'right',
                }}
              >
                {fontSize}px
              </span>
            </div>
          </SettingRow>

          <SettingRow label="Line Wrapping" description="Wrap long lines in the editor">
            <Toggle checked={lineWrapping} onChange={setLineWrapping} />
          </SettingRow>

          <SettingRow label="Line Numbers" description="Show line numbers in the gutter">
            <Toggle checked={lineNumbers} onChange={setLineNumbers} />
          </SettingRow>

          <SettingRow label="Vim Mode" description="Experimental vim keybindings">
            <Toggle checked={vimMode} onChange={setVimMode} />
          </SettingRow>

          <SectionLabel>Appearance</SectionLabel>

          <SettingRow label="Theme">
            <ThemeSegment value={theme} onChange={setTheme} />
          </SettingRow>

          <SectionLabel>Document</SectionLabel>

          <SettingRow label="Page Size" description="Overridden by #set page() in source">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PageSize)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                letterSpacing: '0.02em',
                padding: '4px 8px',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-default)',
                borderRadius: '2px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="Device Fonts" description="Use fonts installed on this device when the browser allows access">
            <Toggle checked={systemFontsEnabled} onChange={handleSystemFontsChange} />
          </SettingRow>

          <SettingRow
            label="Google Fonts"
            description={'Auto-import declared Google Font families, like font: "Inter"'}
          >
            <Toggle checked={googleFontsEnabled} onChange={handleGoogleFontsChange} />
          </SettingRow>

          <SectionLabel>Compiler</SectionLabel>

          <SettingRow label="Auto Compile" description="Compile automatically on changes">
            <Toggle checked={autoCompile} onChange={setAutoCompile} />
          </SettingRow>

          <SettingRow label="Compile Delay" description="Delay before auto-compile triggers (ms)">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={compileDelay}
                onChange={(e) => setCompileDelay(Number(e.target.value))}
                style={{
                  width: '80px',
                  accentColor: 'var(--accent)',
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  minWidth: '42px',
                  textAlign: 'right',
                }}
              >
                {compileDelay}ms
              </span>
            </div>
          </SettingRow>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
            }}
          >
            Changes saved automatically
          </span>
          <button
            onClick={handleClose}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              letterSpacing: '0.04em',
              padding: '5px 16px',
              border: '1px solid var(--border-default)',
              borderRadius: '2px',
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'background 100ms ease, color 100ms ease, border-color 100ms ease',
            }}
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
