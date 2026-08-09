import { useState, useRef, useEffect } from 'react'
import { useProjectStore, type Project } from '@/stores/project-store'
import { useUIStore } from '@/stores/ui-store'
import { ContextMenu, type ContextMenuAction } from '@/components/ui/context-menu'
import { BookOpen, Check, Download, FileArchive, FileText, FileUp, FolderOpen, FolderPlus, FolderUp, Loader2, Monitor, Moon, Pencil, Plus, Store, Sun, Terminal, Trash2, Upload, X } from 'lucide-react'
import { runInitCommand } from '@/lib/template-init'
import {
  MIN_MARKETPLACE_QUERY_LENGTH,
  searchUniverseMarketplace,
  type UniverseMarketplacePackage,
} from '@/lib/universe-registry'
import {
  createBuiltInTemplateScaffold,
  getBuiltInTemplate,
  listBuiltInTemplates,
} from '@/lib/builtin-templates'
import type { LatexImportResult } from '@/lib/project-io'
import { isLatexPath } from '@/lib/file-classification'

async function loadProjectIo() {
  return import('@/lib/project-io')
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isHiddenInternalPath(path: string): boolean {
  return path.startsWith('/.typsmthng/')
}

function formatPackageTitle(name: string): string {
  return name.replace(/-/g, ' ').toUpperCase()
}

/* ── Shared inline link-button style ── */
const linkBtnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.04em',
  cursor: 'pointer',
  padding: 0,
}

function LinkBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
      style={linkBtnBase}
      {...rest}
    >
      {children}
    </button>
  )
}

function ThemeToggle() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  const cycle = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
  }

  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon
  const label = theme === 'system' ? 'Theme: system' : theme === 'light' ? 'Theme: light' : 'Theme: dark'

  return (
    <LinkBtn onClick={cycle} title={`${label} (click to cycle)`} aria-label={`${label} (click to cycle)`}>
      <Icon size={12} />
      {label}
    </LinkBtn>
  )
}

/* ── Project card ── */

function ProjectCard({
  project,
  selected,
  selectionMode,
  workspaceActions,
  onSelect,
  onDelete,
  onRename,
  onPreloadWorkspace,
}: {
  project: Project
  selected?: boolean
  selectionMode?: boolean
  workspaceActions?: ContextMenuAction[]
  onSelect: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onPreloadWorkspace?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const fileCount = project.files.filter((f) => !f.path.endsWith('/.folder') && !isHiddenInternalPath(f.path)).length

  const commitRename = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed)
    } else {
      setEditName(project.name)
    }
    setEditing(false)
  }

  const contextActions: ContextMenuAction[] = [
    {
      label: 'Open',
      icon: <FolderOpen size={12} />,
      onClick: onSelect,
    },
    {
      label: 'Rename',
      icon: <Pencil size={12} />,
      onClick: () => {
        setEditName(project.name)
        setEditing(true)
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 size={12} />,
      onClick: () => {
        if (window.confirm(`Delete "${project.name}"?`)) {
          onDelete()
        }
      },
      danger: true,
    },
    ...(workspaceActions?.length ? workspaceActions : []),
  ]

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        if (editing) return
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
      onClick={(e) => {
        if (editing || confirmDelete) return
        if ((e.target as HTMLElement).closest('[data-delete-btn]')) return
        onSelect()
      }}
      onFocus={() => onPreloadWorkspace?.()}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + 24 })
        }
      }}
      tabIndex={0}
      style={{
        background: 'var(--bg-surface)',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border-default)',
        borderRadius: '2px',
        padding: '14px 16px',
        cursor: editing || confirmDelete ? 'default' : 'pointer',
        transition: 'background 100ms ease, border-color 100ms ease, box-shadow 100ms ease',
        fontFamily: 'var(--font-mono)',
        position: 'relative',
        boxShadow: selected ? '0 10px 24px color-mix(in srgb, var(--accent) 14%, transparent)' : 'none',
      }}
      onMouseEnter={(e) => {
        onPreloadWorkspace?.()
        if (!editing && !confirmDelete) {
          e.currentTarget.style.background = 'var(--bg-hover)'
          e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border-strong)'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-surface)'
        e.currentTarget.style.borderColor = 'var(--border-default)'
        if (confirmDelete) setConfirmDelete(false)
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          {selectionMode && (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                borderRadius: '2px',
                border: selected ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
                background: selected ? 'var(--accent)' : 'transparent',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {selected && <Check size={11} />}
            </span>
          )}
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setEditName(project.name)
                  setEditing(false)
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent)',
                borderRadius: '2px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 700,
                padding: '2px 8px',
                outline: 'none',
                flex: 1,
                minWidth: 0,
              }}
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                if (selectionMode) return
                e.stopPropagation()
                setEditName(project.name)
                setEditing(true)
              }}
              style={{
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {project.name}
            </span>
          )}
        </div>
        <button
          data-delete-btn
          onClick={(e) => {
            e.stopPropagation()
            if (confirmDelete) {
              onDelete()
            } else {
              setConfirmDelete(true)
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            border: '1px solid transparent',
            borderRadius: '2px',
            background: 'transparent',
            color: confirmDelete ? 'var(--status-error)' : 'var(--text-tertiary)',
            cursor: 'pointer',
            transition: 'color 100ms ease',
            flexShrink: 0,
          }}
          title={confirmDelete ? 'Click again to confirm delete' : 'Delete project'}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {confirmDelete && (
        <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--status-error)', letterSpacing: '0.04em' }}>
          Click trash again to delete
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginTop: '10px',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.02em',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <FileText size={11} />
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
        <span>{formatDate(project.updatedAt)}</span>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextActions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

/* ── LaTeX import dropdown menu ── */

function LatexImportMenu({
  onTexFiles,
  onZip,
  onFolder,
  onClose,
}: {
  onTexFiles: () => void
  onZip: () => void
  onFolder: () => void
  onClose: () => void
}) {
  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '7px 12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.03em',
    cursor: 'pointer',
    textAlign: 'left',
  }

  const handleHover = (e: React.MouseEvent<HTMLButtonElement>, enter: boolean) => {
    e.currentTarget.style.background = enter ? 'var(--bg-hover)' : 'transparent'
    e.currentTarget.style.color = enter ? 'var(--text-primary)' : 'var(--text-secondary)'
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: '4px',
          zIndex: 50,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: '2px',
          padding: '4px 0',
          minWidth: '160px',
        }}
      >
        <button style={menuItemStyle} onMouseEnter={(e) => handleHover(e, true)} onMouseLeave={(e) => handleHover(e, false)} onClick={onTexFiles}>
          <FileUp size={12} /> .tex files
        </button>
        <div style={{ height: '1px', background: 'var(--border-default)', margin: '2px 0' }} />
        <button style={menuItemStyle} onMouseEnter={(e) => handleHover(e, true)} onMouseLeave={(e) => handleHover(e, false)} onClick={onZip}>
          <FileArchive size={12} /> .zip archive
        </button>
        <div style={{ height: '1px', background: 'var(--border-default)', margin: '2px 0' }} />
        <button style={menuItemStyle} onMouseEnter={(e) => handleHover(e, true)} onMouseLeave={(e) => handleHover(e, false)} onClick={onFolder}>
          <FolderUp size={12} /> Folder
        </button>
      </div>
    </>
  )
}

/* ── Main component ── */

export function ProjectPicker({
  onShowGuide,
  onPreloadWorkspace,
}: {
  onShowGuide: () => void
  onPreloadWorkspace?: () => void
}) {
  const projects = useProjectStore((s) => s.projects)
  const selectProject = useProjectStore((s) => s.selectProject)
  const createProject = useProjectStore((s) => s.createProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const renameProject = useProjectStore((s) => s.renameProject)
  const homeWorkspaces = useProjectStore((s) => s.homeWorkspaces)
  const projectWorkspaceAssignments = useProjectStore((s) => s.projectWorkspaceAssignments)
  const selectedHomeWorkspaceId = useProjectStore((s) => s.selectedHomeWorkspaceId)
  const createHomeWorkspace = useProjectStore((s) => s.createHomeWorkspace)
  const renameHomeWorkspace = useProjectStore((s) => s.renameHomeWorkspace)
  const deleteHomeWorkspace = useProjectStore((s) => s.deleteHomeWorkspace)
  const assignProjectsToHomeWorkspace = useProjectStore((s) => s.assignProjectsToHomeWorkspace)
  const setSelectedHomeWorkspace = useProjectStore((s) => s.setSelectedHomeWorkspace)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const [showNewInput, setShowNewInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [initCommand, setInitCommand] = useState('')
  const [initBusy, setInitBusy] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [initSuccess, setInitSuccess] = useState<string | null>(null)
  const [showTemplateInit, setShowTemplateInit] = useState(false)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [marketplaceQuery, setMarketplaceQuery] = useState('')
  const [marketplaceBusy, setMarketplaceBusy] = useState(false)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [marketplaceResults, setMarketplaceResults] = useState<UniverseMarketplacePackage[]>([])
  const newInputRef = useRef<HTMLInputElement>(null)
  const latexFileInputRef = useRef<HTMLInputElement>(null)
  const latexFolderInputRef = useRef<HTMLInputElement>(null)
  const latexZipInputRef = useRef<HTMLInputElement>(null)
  const [latexBusy, setLatexBusy] = useState(false)
  const [latexResult, setLatexResult] = useState<LatexImportResult | null>(null)
  const [latexError, setLatexError] = useState<string | null>(null)
  const [latexMenuOpen, setLatexMenuOpen] = useState(false)
  const importAllInputRef = useRef<HTMLInputElement>(null)
  const [importAllBusy, setImportAllBusy] = useState(false)
  const [importAllResult, setImportAllResult] = useState<string | null>(null)
  const [importAllError, setImportAllError] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null)
  const [workspaceQuickAddOpen, setWorkspaceQuickAddOpen] = useState(false)
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{ workspaceId: string; x: number; y: number } | null>(null)
  const marketplaceSearchToken = useRef(0)
  const builtInTemplates = listBuiltInTemplates()

  useEffect(() => {
    if (showNewInput) {
      newInputRef.current?.focus()
    }
  }, [showNewInput])

  useEffect(() => {
    if (!marketplaceOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMarketplaceOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [marketplaceOpen])

  useEffect(() => {
    if (!marketplaceOpen) return

    const query = marketplaceQuery.trim()
    if (query.length < MIN_MARKETPLACE_QUERY_LENGTH) {
      setMarketplaceBusy(false)
      setMarketplaceError(null)
      setMarketplaceResults([])
      return
    }

    const token = ++marketplaceSearchToken.current
    setMarketplaceBusy(true)
    setMarketplaceError(null)

    const timer = setTimeout(() => {
      void searchUniverseMarketplace(query)
        .then((results) => {
          if (token !== marketplaceSearchToken.current) return
          setMarketplaceResults(results)
          setMarketplaceBusy(false)
        })
        .catch((err) => {
          if (token !== marketplaceSearchToken.current) return
          setMarketplaceError(err instanceof Error ? err.message : 'Failed to fetch marketplace packages')
          setMarketplaceResults([])
          setMarketplaceBusy(false)
        })
    }, 160)

    return () => clearTimeout(timer)
  }, [marketplaceOpen, marketplaceQuery])

  useEffect(() => {
    setSelectedProjectIds((current) => current.filter((id) => projects.some((project) => project.id === id)))
  }, [projects])

  const quickInitCommands = [
    { label: 'IEEE Journal', command: 'typst init @preview/charged-ieee' },
    { label: 'IEEE Conference', command: 'typst init @preview/bamdone-ieeeconf' },
    { label: 'IEEE VGTC', command: 'typst init @preview/ieee-vgtc' },
    { label: 'Generic Research', command: 'typst init @preview/abiding-ifacconf' },
  ]

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setShowNewInput(false)
      setNewName('')
      return
    }
    onPreloadWorkspace?.()
    await createProject(trimmed)
    setShowNewInput(false)
    setNewName('')
  }

  const runInitWorkflow = async (
    command: string,
    options?: { clearCommandInput?: boolean; closeMarketplace?: boolean; successPrefix?: string },
  ) => {
    if (initBusy) return

    setInitBusy(true)
    setInitError(null)
    setInitSuccess(null)
    try {
      onPreloadWorkspace?.()
      const result = await runInitCommand(command)
      const successPrefix = options?.successPrefix ?? 'Created'
      setInitSuccess(`${successPrefix} "${result.projectName}" from ${result.resolvedSpec}`)
      if (options?.clearCommandInput) {
        setInitCommand('')
      }
      if (options?.closeMarketplace) {
        setMarketplaceOpen(false)
      }
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to initialize template project')
    } finally {
      setInitBusy(false)
    }
  }

  const handleInitFromCommand = async () => {
    const trimmed = initCommand.trim()
    if (!trimmed) return
    await runInitWorkflow(trimmed, { clearCommandInput: true })
  }

  const handleImportBuiltInTemplate = async (templateId: string) => {
    const template = getBuiltInTemplate(templateId)
    if (!template || initBusy) return

    setInitBusy(true)
    setInitError(null)
    setInitSuccess(null)
    try {
      onPreloadWorkspace?.()
      const scaffold = createBuiltInTemplateScaffold(templateId)
      await createProject(template.suggestedProjectName, scaffold)
      setInitSuccess(`Created "${template.suggestedProjectName}" from built-in starter`)
      setMarketplaceOpen(false)
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to import built-in starter')
    } finally {
      setInitBusy(false)
    }
  }

  const handleMarketplacePrefill = (item: UniverseMarketplacePackage) => {
    setInitCommand(item.initCommand)
    setInitError(null)
    setInitSuccess(`Prefilled command for @preview/${item.name}`)
    setMarketplaceOpen(false)
  }

  const handleMarketplaceImport = async (item: UniverseMarketplacePackage) => {
    if (!item.isTemplate) return
    await runInitWorkflow(item.initCommand, {
      closeMarketplace: true,
      successPrefix: 'Imported',
    })
  }

  const handleLatexFiles = async (files: FileList) => {
    if (files.length === 0 || latexBusy) return
    setLatexBusy(true)
    setLatexResult(null)
    setLatexError(null)
    setLatexMenuOpen(false)

    try {
      const { importLatexProject, importLatexZip } = await loadProjectIo()
      const firstFile = files[0]
      if (files.length === 1 && /\.zip$/i.test(firstFile.name)) {
        const result = await importLatexZip(firstFile)
        setLatexResult(result)
        return
      }

      const entries: Array<{ relativePath: string; file: File }> = []
      const hasRelativePaths = Array.from(files).some(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath,
      )

      for (const file of Array.from(files)) {
        const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        const path = hasRelativePaths && relPath ? relPath : file.name
        entries.push({ relativePath: path, file })
      }

      const hasTeX = entries.some((e) => isLatexPath(e.file.name))
      if (!hasTeX) {
        setLatexError('No .tex files found. Select files containing at least one .tex file.')
        return
      }

      const result = await importLatexProject(entries)
      setLatexResult(result)
    } catch (err) {
      setLatexError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLatexBusy(false)
    }
  }

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  const visibleProjects = selectedHomeWorkspaceId
    ? sorted.filter((project) => projectWorkspaceAssignments[project.id] === selectedHomeWorkspaceId)
    : sorted
  const activeWorkspace = homeWorkspaces.find((workspace) => workspace.id === selectedHomeWorkspaceId) ?? null
  const selectedCount = selectedProjectIds.length

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((current) => (
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    ))
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedProjectIds([])
    setWorkspaceSheetOpen(false)
    setWorkspaceQuickAddOpen(false)
    setWorkspaceActionError(null)
  }

  const handleWorkspaceAssignment = async (workspaceId: string | null) => {
    if (selectedProjectIds.length === 0) return
    setWorkspaceActionError(null)
    await assignProjectsToHomeWorkspace(selectedProjectIds, workspaceId)
    if (workspaceId) setSelectedHomeWorkspace(workspaceId)
    exitSelectionMode()
  }

  const handleCreateWorkspace = async () => {
    const trimmed = workspaceName.trim()
    if (!trimmed) {
      setWorkspaceActionError('Enter a workspace name.')
      return
    }

    setWorkspaceActionError(null)
    await createHomeWorkspace(trimmed, selectedProjectIds)
    setWorkspaceName('')
    setWorkspaceQuickAddOpen(false)
    exitSelectionMode()
  }

  const handleQuickCreateWorkspace = async () => {
    const trimmed = workspaceName.trim()
    if (!trimmed) {
      setWorkspaceActionError('Enter a workspace name.')
      return
    }

    setWorkspaceActionError(null)
    await createHomeWorkspace(trimmed)
    setWorkspaceName('')
    setWorkspaceQuickAddOpen(false)
  }

  const workspaceContextActions: ContextMenuAction[] = workspaceContextMenu
    ? [
        {
          label: 'Rename',
          icon: <Pencil size={12} />,
          onClick: () => {
            const workspace = homeWorkspaces.find((item) => item.id === workspaceContextMenu.workspaceId)
            if (!workspace) return
            const nextName = window.prompt('Rename workspace', workspace.name)?.trim()
            if (nextName && nextName !== workspace.name) {
              void renameHomeWorkspace(workspace.id, nextName)
            }
          },
        },
        {
          label: 'Delete',
          icon: <Trash2 size={12} />,
          onClick: () => {
            const workspace = homeWorkspaces.find((item) => item.id === workspaceContextMenu.workspaceId)
            if (!workspace) return
            const shouldDelete = window.confirm(`Delete workspace "${workspace.name}"? Projects will stay in All.`)
            if (shouldDelete) {
              void deleteHomeWorkspace(workspace.id)
            }
          },
          danger: true,
        },
      ]
    : []

  return (
    <div
      style={{
        background: 'var(--bg-app)',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 24px 36px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                background: 'var(--accent)',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '18px',
                lineHeight: 1,
                borderRadius: '2px',
                letterSpacing: '-0.02em',
              }}
            >
              T
            </span>
            <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)' }}>
              TYPSMTHNG
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <ThemeToggle />
            <LinkBtn onClick={onShowGuide}>
              <BookOpen size={12} />
              Guide
            </LinkBtn>
          </div>
        </div>

        <div
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)',
            border: '1px solid var(--border-default)',
            borderRadius: '2px',
            padding: '10px 12px',
            marginBottom: '20px',
            display: 'grid',
            gap: '8px',
            backdropFilter: 'blur(14px)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: '12px',
              alignItems: 'start',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.08em', marginBottom: '8px' }}>
                WORKSPACES
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setSelectedHomeWorkspace(null)}
                  style={{
                    border: selectedHomeWorkspaceId === null ? '1px solid var(--accent)' : '1px solid var(--border-default)',
                    background: selectedHomeWorkspaceId === null ? 'var(--accent)' : 'var(--bg-inset)',
                    color: selectedHomeWorkspaceId === null ? '#fff' : 'var(--text-secondary)',
                    borderRadius: '2px',
                    padding: '7px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  All
                </button>
                {homeWorkspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => setSelectedHomeWorkspace(workspace.id)}
                    onDoubleClick={() => {
                      const nextName = window.prompt('Rename workspace', workspace.name)?.trim()
                      if (nextName && nextName !== workspace.name) {
                        void renameHomeWorkspace(workspace.id, nextName)
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setWorkspaceContextMenu({
                        workspaceId: workspace.id,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }}
                    style={{
                      border: selectedHomeWorkspaceId === workspace.id ? '1px solid var(--accent)' : '1px solid var(--border-default)',
                      background: selectedHomeWorkspaceId === workspace.id ? 'var(--accent-muted)' : 'var(--bg-inset)',
                      color: selectedHomeWorkspaceId === workspace.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderRadius: '2px',
                      padding: '7px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title="Double-click to rename. Right-click to delete."
                  >
                    {workspace.name}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                justifyItems: 'end',
                alignContent: 'start',
                gap: '14px',
                minWidth: '140px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setWorkspaceQuickAddOpen((value) => !value)
                  setWorkspaceActionError(null)
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  borderRadius: '2px',
                  padding: '6px 10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Plus size={12} />
                Add Workspace
              </button>
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.04em',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
              >
                {activeWorkspace ? `${visibleProjects.length} in ${activeWorkspace.name}` : `${projects.length} total`}
              </div>
            </div>
          </div>

          {workspaceQuickAddOpen && (
            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: '2px',
                padding: '10px',
                display: 'grid',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Research, Client, Notes..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleQuickCreateWorkspace()
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: '220px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '2px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    padding: '8px 10px',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => { void handleQuickCreateWorkspace() }}
                  style={{
                    border: '1px solid var(--accent)',
                    background: 'var(--accent)',
                    color: '#fff',
                    borderRadius: '2px',
                    padding: '0 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Create
                </button>
              </div>
              {workspaceActionError && (
                <div style={{ fontSize: '10px', color: 'var(--status-error)' }}>{workspaceActionError}</div>
              )}
            </div>
          )}
        </div>

        {/* ── Hidden file inputs ── */}
        <input ref={latexFileInputRef} type="file" accept=".tex" multiple style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleLatexFiles(e.target.files); e.target.value = '' }}
        />
        <input ref={latexFolderInputRef} type="file" multiple style={{ display: 'none' }}
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleLatexFiles(e.target.files); e.target.value = '' }}
        />
        <input ref={latexZipInputRef} type="file" accept=".zip" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleLatexFiles(e.target.files); e.target.value = '' }}
        />
        <input ref={importAllInputRef} type="file" accept=".zip" style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setImportAllBusy(true)
            setImportAllResult(null)
            setImportAllError(null)
            void loadProjectIo()
              .then(({ importAllProjects }) => importAllProjects(file))
              .then((count) => {
                setImportAllResult(`Imported ${count} project${count === 1 ? '' : 's'}`)
                void loadProjects()
              })
              .catch((err) => {
                setImportAllError(err instanceof Error ? err.message : 'Import failed')
              })
              .finally(() => { setImportAllBusy(false) })
            e.target.value = ''
          }}
        />

        {/* ── Action row ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <LinkBtn
              data-testid="template-init-reveal-button"
              onClick={() => setShowTemplateInit((v) => !v)}
            >
              <Terminal size={12} />
              Templates
            </LinkBtn>
          </div>
          <div style={{ position: 'relative' }}>
            <LinkBtn
              onClick={() => setLatexMenuOpen((v) => !v)}
              disabled={latexBusy}
              style={{ ...linkBtnBase, opacity: latexBusy ? 0.6 : 1 }}
            >
              {latexBusy ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
              {latexBusy ? 'Converting...' : 'Import LaTeX'}
            </LinkBtn>
            {latexMenuOpen && !latexBusy && (
              <LatexImportMenu
                onTexFiles={() => { setLatexMenuOpen(false); latexFileInputRef.current?.click() }}
                onZip={() => { setLatexMenuOpen(false); latexZipInputRef.current?.click() }}
                onFolder={() => { setLatexMenuOpen(false); latexFolderInputRef.current?.click() }}
                onClose={() => setLatexMenuOpen(false)}
              />
            )}
          </div>
          <LinkBtn
            onClick={() => {
              if (selectionMode) {
                exitSelectionMode()
                return
              }
              setSelectionMode(true)
              setWorkspaceActionError(null)
            }}
          >
            {selectionMode ? <X size={12} /> : <Check size={12} />}
            {selectionMode ? 'Cancel Select' : 'Select'}
          </LinkBtn>
        </div>

        {selectionMode && (
          <div
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
              border: '1px solid var(--border-default)',
              borderRadius: '2px',
              padding: '12px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {selectedCount === 0 ? 'Choose documents to group.' : `${selectedCount} selected`}
            </div>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => {
                setWorkspaceSheetOpen(true)
                setWorkspaceActionError(null)
              }}
              style={{
                border: '1px solid var(--accent)',
                background: 'var(--accent)',
                color: '#fff',
                borderRadius: '2px',
                padding: '7px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                cursor: selectedCount === 0 ? 'default' : 'pointer',
                opacity: selectedCount === 0 ? 0.5 : 1,
              }}
            >
              Add to Workspace
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => { void handleWorkspaceAssignment(null) }}
                style={{
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  borderRadius: '2px',
                  padding: '7px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Remove from Workspace
              </button>
            )}
          </div>
        )}

        {/* ── Template init panel (collapsible) ── */}
        {showTemplateInit && (
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: '2px',
              padding: '14px 16px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <input
                value={marketplaceQuery}
                onFocus={() => setMarketplaceOpen(true)}
                onChange={(event) => { setMarketplaceQuery(event.target.value); setMarketplaceOpen(true) }}
                placeholder="Search templates (ieee, acm, thesis...)"
                disabled={initBusy}
                style={{
                  flex: 1,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '2px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '6px 8px',
                  outline: 'none',
                }}
              />
              <button
                data-testid="marketplace-open-button"
                type="button"
                onClick={() => setMarketplaceOpen(true)}
                disabled={initBusy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  height: '28px',
                  borderRadius: '2px',
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  padding: '0 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.04em',
                  cursor: initBusy ? 'default' : 'pointer',
                  opacity: initBusy ? 0.7 : 1,
                }}
              >
                <Store size={12} />
                Browse
              </button>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.03em', marginBottom: '6px' }}>
              Or run directly: typst init @preview/name[:version]
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                value={initCommand}
                onChange={(e) => setInitCommand(e.target.value)}
                placeholder="typst init @preview/aero-check:0.1.1"
                onKeyDown={(e) => { if (e.key === 'Enter') void handleInitFromCommand() }}
                disabled={initBusy}
                style={{
                  flex: 1,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '2px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '6px 8px',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => { void handleInitFromCommand() }}
                disabled={initBusy || !initCommand.trim()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  minWidth: '72px',
                  height: '30px',
                  borderRadius: '2px',
                  border: '1px solid var(--accent)',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  letterSpacing: '0.04em',
                  cursor: initBusy ? 'default' : 'pointer',
                  opacity: initBusy || !initCommand.trim() ? 0.6 : 1,
                }}
              >
                {initBusy ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
                {initBusy ? 'Init...' : 'Run'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
              {quickInitCommands.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setInitCommand(item.command)}
                  disabled={initBusy}
                  style={{
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-inset)',
                    color: 'var(--text-secondary)',
                    borderRadius: '2px',
                    padding: '3px 7px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    letterSpacing: '0.03em',
                    cursor: initBusy ? 'default' : 'pointer',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {initError && (
              <div style={{ marginTop: '8px', color: 'var(--status-error)', fontSize: '11px' }}>
                {initError}
              </div>
            )}
            {initSuccess && (
              <div style={{ marginTop: '8px', color: 'var(--status-success)', fontSize: '11px' }}>
                {initSuccess}
              </div>
            )}
          </div>
        )}

        {/* ── Inline feedback banners ── */}
        {latexError && (
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid color-mix(in srgb, var(--status-error) 50%, transparent)',
              borderRadius: '2px',
              padding: '10px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--status-error)' }}>{latexError}</div>
            <button
              type="button"
              onClick={() => setLatexError(null)}
              style={{ width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {latexResult && (
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid color-mix(in srgb, var(--status-success) 50%, transparent)',
              borderRadius: '2px',
              padding: '10px 14px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--status-success)' }}>
                  Created &ldquo;{latexResult.projectName}&rdquo; &mdash;{' '}
                  {latexResult.texFilesConverted} .tex {latexResult.texFilesConverted === 1 ? 'file' : 'files'} converted
                  {latexResult.fileCount > latexResult.texFilesConverted && (
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      {' '}+ {latexResult.fileCount - latexResult.texFilesConverted} other {latexResult.fileCount - latexResult.texFilesConverted === 1 ? 'file' : 'files'}
                    </span>
                  )}
                  {latexResult.metadata.documentclass && (
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: '6px' }}>
                      ({latexResult.metadata.documentclass})
                    </span>
                  )}
                </div>
                {latexResult.warnings.length > 0 && (
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: 1.5 }}>
                    {latexResult.warnings.length} {latexResult.warnings.length === 1 ? 'warning' : 'warnings'}:
                    {latexResult.warnings.slice(0, 5).map((w, i) => (
                      <div key={i} style={{ paddingLeft: '8px' }}>&bull; {w.message}</div>
                    ))}
                    {latexResult.warnings.length > 5 && (
                      <div style={{ paddingLeft: '8px' }}>&hellip; and {latexResult.warnings.length - 5} more</div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLatexResult(null)}
                style={{ width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start' }}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {importAllResult && (
          <div style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--status-success)', textAlign: 'center' }}>
            {importAllResult}
          </div>
        )}
        {importAllError && (
          <div style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--status-error)', textAlign: 'center' }}>
            {importAllError}
          </div>
        )}

        {/* ── Project grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '10px',
          }}
        >
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              selected={selectedProjectIds.includes(project.id)}
              selectionMode={selectionMode}
              workspaceActions={[
                {
                  label: 'Move To',
                  icon: <FolderPlus size={12} />,
                  onClick: () => {},
                  children: [
                    {
                      label: 'All',
                      icon: <FolderOpen size={12} />,
                      disabled: !projectWorkspaceAssignments[project.id],
                      onClick: () => {
                        void assignProjectsToHomeWorkspace([project.id], null)
                      },
                    },
                    ...homeWorkspaces.map((workspace) => ({
                      label: workspace.name,
                      icon: <FolderPlus size={12} />,
                      disabled: projectWorkspaceAssignments[project.id] === workspace.id,
                      onClick: () => {
                        void assignProjectsToHomeWorkspace([project.id], workspace.id)
                      },
                    })),
                  ],
                },
              ]}
              onSelect={() => {
                if (selectionMode) {
                  toggleProjectSelection(project.id)
                  return
                }
                onPreloadWorkspace?.()
                selectProject(project.id)
              }}
              onDelete={() => deleteProject(project.id)}
              onRename={(name) => renameProject(project.id, name)}
              onPreloadWorkspace={onPreloadWorkspace}
            />
          ))}

          {/* New project card */}
          {showNewInput ? (
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--accent)',
                borderRadius: '2px',
                padding: '14px 16px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.04em', marginBottom: '6px' }}>
                Project name
              </div>
              <input
                ref={newInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleCreate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') { setShowNewInput(false); setNewName('') }
                }}
                placeholder="My Document"
                style={{
                  width: '100%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '2px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  fontWeight: 700,
                  padding: '5px 8px',
                  outline: 'none',
                }}
              />
            </div>
          ) : (
            <div
              onClick={() => setShowNewInput(true)}
              style={{
                background: 'transparent',
                border: '1px dashed var(--border-default)',
                borderRadius: '2px',
                padding: '14px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                color: 'var(--text-tertiary)',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.03em',
                transition: 'color 100ms ease, border-color 100ms ease',
                minHeight: '80px',
              }}
              onMouseEnter={(e) => {
                onPreloadWorkspace?.()
                e.currentTarget.style.color = 'var(--accent)'
                e.currentTarget.style.borderColor = 'var(--accent)'
              }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-default)' }}
            >
              <Plus size={14} />
              New Project
            </div>
          )}
        </div>

        {/* ── Footer: export / import ── */}
        <div
          style={{
            marginTop: '28px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            justifyContent: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          {projects.length > 0 && (
            <LinkBtn onClick={() => { void loadProjectIo().then(({ exportAllProjects }) => exportAllProjects()) }}>
              <Download size={12} />
              Export all
            </LinkBtn>
          )}
          <LinkBtn
            onClick={() => importAllInputRef.current?.click()}
            disabled={importAllBusy}
            style={{ ...linkBtnBase, opacity: importAllBusy ? 0.6 : 1 }}
          >
            {importAllBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {importAllBusy ? 'Importing...' : 'Import all'}
          </LinkBtn>
        </div>
      </div>

      {workspaceSheetOpen && (
        <div
          onClick={(event) => {
            if (event.target === event.currentTarget) setWorkspaceSheetOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.32)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              background: 'color-mix(in srgb, var(--bg-surface) 94%, transparent)',
              border: '1px solid var(--border-strong)',
              borderRadius: '2px',
              padding: '16px',
              backdropFilter: 'blur(18px)',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)',
              display: 'grid',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 700 }}>Assign Workspace</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  Group selected documents on the homepage.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceSheetOpen(false)}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '2px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} />
              </button>
            </div>

            {homeWorkspaces.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {homeWorkspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => { void handleWorkspaceAssignment(workspace.id) }}
                    style={{
                      border: '1px solid var(--border-default)',
                      background: 'var(--bg-inset)',
                      color: 'var(--text-primary)',
                      borderRadius: '2px',
                      padding: '8px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {workspace.name}
                  </button>
                ))}
              </div>
            )}

            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: '2px',
                padding: '12px',
                display: 'grid',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderPlus size={14} color="var(--text-secondary)" />
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>New workspace</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Research, Client, Notes..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleCreateWorkspace()
                    }
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '2px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    padding: '8px 10px',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => { void handleCreateWorkspace() }}
                  style={{
                    border: '1px solid var(--accent)',
                    background: 'var(--accent)',
                    color: '#fff',
                    borderRadius: '2px',
                    padding: '0 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Create
                </button>
              </div>
              {workspaceActionError && (
                <div style={{ fontSize: '10px', color: 'var(--status-error)' }}>{workspaceActionError}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {workspaceContextMenu && (
        <ContextMenu
          x={workspaceContextMenu.x}
          y={workspaceContextMenu.y}
          actions={workspaceContextActions}
          onClose={() => setWorkspaceContextMenu(null)}
        />
      )}

      {/* ── Marketplace modal ── */}
      {marketplaceOpen && (
        <div
          onClick={(event) => { if (event.target === event.currentTarget) setMarketplaceOpen(false) }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.6)',
            padding: '24px',
          }}
        >
          <div
            data-testid="marketplace-modal"
            style={{
              width: '100%',
              maxWidth: '720px',
              maxHeight: 'calc(100vh - 48px)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '2px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '12px 14px',
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', letterSpacing: '0.06em', color: 'var(--text-primary)', fontWeight: 700 }}>
                  Template Marketplace
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  Typst Universe packages and built-in starters
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMarketplaceOpen(false)}
                style={{
                  width: '28px', height: '28px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', borderRadius: '2px', background: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-default)', display: 'grid', gap: '6px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.03em' }}>
                Search packages (min {MIN_MARKETPLACE_QUERY_LENGTH} characters)
              </div>
              <input
                data-testid="marketplace-search-input"
                value={marketplaceQuery}
                onChange={(event) => setMarketplaceQuery(event.target.value)}
                placeholder="ieee, acm, thesis, conference..."
                style={{
                  width: '100%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '2px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '7px 8px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ overflowY: 'auto', padding: '12px 14px', display: 'grid', gap: '14px' }}>
              {/* Built-in section */}
              <div>
                <div style={{ fontSize: '10px', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                  BUILT-IN
                </div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  {builtInTemplates.map((template) => (
                    <div
                      key={template.id}
                      style={{
                        border: '1px solid var(--border-default)',
                        borderRadius: '2px',
                        background: 'var(--bg-inset)',
                        padding: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '11px', letterSpacing: '0.03em', color: 'var(--text-primary)', fontWeight: 700 }}>
                          {template.label}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                          {template.description}
                        </div>
                      </div>
                      <button
                        data-testid={`marketplace-import-${template.id}`}
                        type="button"
                        onClick={() => { void handleImportBuiltInTemplate(template.id) }}
                        disabled={initBusy}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                          border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff',
                          borderRadius: '2px', height: '26px', padding: '0 8px',
                          fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.04em',
                          cursor: initBusy ? 'default' : 'pointer', opacity: initBusy ? 0.7 : 1, flexShrink: 0,
                        }}
                      >
                        <Download size={11} />
                        Import
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Universe section */}
              <div>
                <div style={{ fontSize: '10px', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                  TYPST UNIVERSE
                </div>

                {marketplaceQuery.trim().length < MIN_MARKETPLACE_QUERY_LENGTH && (
                  <div style={{ border: '1px dashed var(--border-default)', borderRadius: '2px', padding: '10px', color: 'var(--text-tertiary)', fontSize: '11px' }}>
                    Type at least {MIN_MARKETPLACE_QUERY_LENGTH} characters to search.
                  </div>
                )}

                {marketplaceBusy && (
                  <div style={{ border: '1px solid var(--border-default)', borderRadius: '2px', padding: '10px', color: 'var(--text-secondary)', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={12} className="animate-spin" />
                    Searching...
                  </div>
                )}

                {!marketplaceBusy && marketplaceError && (
                  <div style={{ border: '1px solid color-mix(in srgb, var(--status-error) 60%, transparent)', borderRadius: '2px', padding: '10px', color: 'var(--status-error)', fontSize: '11px' }}>
                    {marketplaceError}
                  </div>
                )}

                {!marketplaceBusy && !marketplaceError && marketplaceQuery.trim().length >= MIN_MARKETPLACE_QUERY_LENGTH && marketplaceResults.length === 0 && (
                  <div style={{ border: '1px dashed var(--border-default)', borderRadius: '2px', padding: '10px', color: 'var(--text-tertiary)', fontSize: '11px' }}>
                    No packages matched your query.
                  </div>
                )}

                {!marketplaceBusy && marketplaceResults.length > 0 && (
                  <div style={{ display: 'grid', gap: '6px' }}>
                    {marketplaceResults.map((item) => (
                      <div
                        key={`${item.name}:${item.latestVersion}`}
                        style={{
                          border: '1px solid var(--border-default)',
                          borderRadius: '2px',
                          background: 'var(--bg-inset)',
                          padding: '10px',
                          display: 'grid',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                          <div>
                            <span style={{ fontSize: '11px', color: 'var(--text-primary)', letterSpacing: '0.03em', fontWeight: 700 }}>
                              {formatPackageTitle(item.name)}
                            </span>
                            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
                              @preview/{item.name}:{item.latestVersion}
                            </span>
                          </div>
                          {item.isTemplate ? (
                            <span style={{ fontSize: '10px', padding: '1px 5px', border: '1px solid color-mix(in srgb, var(--status-success) 50%, transparent)', color: 'var(--status-success)', borderRadius: '2px', letterSpacing: '0.03em' }}>
                              Template
                            </span>
                          ) : (
                            <span style={{ fontSize: '10px', padding: '1px 5px', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)', borderRadius: '2px', letterSpacing: '0.03em' }}>
                              Package
                            </span>
                          )}
                        </div>

                        {item.isTemplate ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => { void handleMarketplaceImport(item) }}
                              disabled={initBusy}
                              style={{
                                border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff',
                                borderRadius: '2px', height: '25px', padding: '0 8px',
                                fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.04em',
                                cursor: initBusy ? 'default' : 'pointer', opacity: initBusy ? 0.7 : 1,
                              }}
                            >
                              Import
                            </button>
                            <button
                              data-testid={`marketplace-prefill-${item.name}`}
                              type="button"
                              onClick={() => handleMarketplacePrefill(item)}
                              disabled={initBusy}
                              style={{
                                border: '1px solid var(--border-strong)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                                borderRadius: '2px', height: '25px', padding: '0 8px',
                                fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.04em',
                                cursor: initBusy ? 'default' : 'pointer', opacity: initBusy ? 0.7 : 1,
                              }}
                            >
                              Prefill
                            </button>
                          </div>
                        ) : (
                          <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                            {item.disabledReason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
