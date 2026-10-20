import { useState, useRef, useEffect, useMemo } from 'react'
import { useProjectStore, type Project } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUIStore } from '@/stores/ui-store'
import { ContextMenu, useModalA11y, type ContextMenuAction } from '@/components/ui/context-menu'
import { BookOpen, Check, Download, FileArchive, FileText, FileUp, FolderOpen, FolderPlus, FolderUp, Loader2, Monitor, Moon, MoreHorizontal, Pencil, Plus, Store, Sun, Terminal, Trash2, Upload, X } from 'lucide-react'
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

function LinkBtn({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`link-btn ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}

function ThemeToggle() {
  const theme = useUIStore((s) => s.theme)

  const cycle = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    useSettingsStore.getState().setTheme(next)
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
          return
        }
        if (e.key === 'Enter' || e.key === ' ') {
          if (editing || confirmDelete) return
          if ((e.target as HTMLElement).closest('button, input')) return
          e.preventDefault()
          onSelect()
        }
      }}
      role="button"
      aria-label={selectionMode ? `${selected ? 'Deselect' : 'Select'} project ${project.name}` : `Open project ${project.name}`}
      tabIndex={0}
      className="project-card"
      data-hoverable={!editing && !confirmDelete}
      style={{
        '--card-bc': selected ? 'var(--accent)' : 'var(--border-default)',
        '--card-hover-bc': selected ? 'var(--accent)' : 'var(--border-strong)',
        '--card-cursor': editing || confirmDelete ? 'default' : 'pointer',
        '--card-shadow': selected ? 'var(--shadow-accent)' : 'none',
      } as React.CSSProperties}
      onMouseEnter={() => { onPreloadWorkspace?.() }}
      onMouseLeave={() => { if (confirmDelete) setConfirmDelete(false) }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {selectionMode && (
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center size-4.5 rounded-xs border border-(color:--cb-bc) bg-(--cb-bg) text-(--accent-text) shrink-0"
              style={{
                '--cb-bc': selected ? 'var(--accent)' : 'var(--border-strong)',
                '--cb-bg': selected ? 'var(--accent)' : 'transparent',
              } as React.CSSProperties}
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
              className="bg-(--bg-elevated) border border-(color:--accent) rounded-xs text-(--text-primary) font-mono fs-13 font-bold py-0.5 px-2 outline-none flex-1 min-w-0"
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                if (selectionMode) return
                e.stopPropagation()
                setEditName(project.name)
                setEditing(true)
              }}
              className="text-(--text-primary) fs-13 font-bold tracking-(--ls) overflow-hidden text-ellipsis whitespace-nowrap flex-1"
              style={{ '--ls': '0.01em' } as React.CSSProperties}
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
          className="inline-flex items-center justify-center size-6 border border-(color:transparent) rounded-xs bg-transparent text-(--del-fg) cursor-pointer transition-colors duration-100 shrink-0"
          style={{ '--del-fg': confirmDelete ? 'var(--status-error)' : 'var(--text-tertiary)' } as React.CSSProperties}
          title={confirmDelete ? 'Click again to confirm delete' : 'Delete project'}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {confirmDelete && (
        <div className="mt-1.5 fs-10 text-(--status-error) tracking-(--ls)" style={{ '--ls': '0.04em' } as React.CSSProperties}>
          Click trash again to delete
        </div>
      )}

      <div
        className="flex items-center gap-2.5 mt-2.5 fs-11 text-(--text-tertiary) tracking-(--ls)"
        style={{ '--ls': '0.02em' } as React.CSSProperties}
      >
        <span className="inline-flex items-center gap-1">
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
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 mt-1 z-50 bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs py-1 min-w-40">
        <button className="dropdown-item" onClick={onTexFiles}>
          <FileUp size={12} /> .tex files
        </button>
        <div className="h-px bg-(--border-default) my-0.5" />
        <button className="dropdown-item" onClick={onZip}>
          <FileArchive size={12} /> .zip archive
        </button>
        <div className="h-px bg-(--border-default) my-0.5" />
        <button className="dropdown-item" onClick={onFolder}>
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
  const marketplaceRequest = useMemo(() => ({
    query: marketplaceQuery.trim(),
    open: marketplaceOpen,
  }), [marketplaceQuery, marketplaceOpen])
  const [marketplaceResponse, setMarketplaceResponse] = useState<{
    request: typeof marketplaceRequest | null
    results: UniverseMarketplacePackage[]
    error: string | null
  }>({ request: null, results: [], error: null })
  const marketplaceSearchable = marketplaceRequest.query.length >= MIN_MARKETPLACE_QUERY_LENGTH
  const marketplaceBusy = marketplaceSearchable && marketplaceResponse.request !== marketplaceRequest
  const marketplaceError = marketplaceSearchable && !marketplaceBusy ? marketplaceResponse.error : null
  const marketplaceResults = marketplaceSearchable && !marketplaceBusy ? marketplaceResponse.results : []
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
  const [selectedProjectIdsState, setSelectedProjectIds] = useState<string[]>([])
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null)
  const [workspaceQuickAddOpen, setWorkspaceQuickAddOpen] = useState(false)
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{ workspaceId: string; x: number; y: number } | null>(null)
  const workspaceSheetRef = useRef<HTMLDivElement>(null)
  const marketplaceModalRef = useRef<HTMLDivElement>(null)
  const builtInTemplates = listBuiltInTemplates()

  useEffect(() => {
    if (showNewInput) {
      newInputRef.current?.focus()
    }
  }, [showNewInput])

  useModalA11y(workspaceSheetRef, workspaceSheetOpen, () => setWorkspaceSheetOpen(false))
  useModalA11y(marketplaceModalRef, marketplaceOpen, () => setMarketplaceOpen(false))

  useEffect(() => {
    const { query, open } = marketplaceRequest
    if (!open || query.length < MIN_MARKETPLACE_QUERY_LENGTH) return

    let cancelled = false
    const timer = setTimeout(() => {
      void searchUniverseMarketplace(query)
        .then((results) => {
          if (cancelled) return
          setMarketplaceResponse({ request: marketplaceRequest, results, error: null })
        })
        .catch((err) => {
          if (cancelled) return
          setMarketplaceResponse({
            request: marketplaceRequest,
            results: [],
            error: err instanceof Error ? err.message : 'Failed to fetch marketplace packages',
          })
        })
    }, 160)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [marketplaceRequest])

  const selectedProjectIds = selectedProjectIdsState.filter((id) => projects.some((project) => project.id === id))

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

  const handleLatexFiles = async (fileList: FileList) => {
    // Snapshot before any await: resetting the input's value (done right after
    // this handler is invoked) empties the live FileList it passed us.
    const files = Array.from(fileList)
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
      const hasRelativePaths = files.some(
        (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath,
      )

      for (const file of files) {
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
    // assignProjectsToHomeWorkspace also selects the target workspace in one
    // home-meta write when workspaceId is set.
    await assignProjectsToHomeWorkspace(selectedProjectIds, workspaceId)
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
    <div className="bg-(--bg-app) w-full h-full overflow-auto font-mono">
      <div className="max-w-190 mx-auto pt-12 px-6 pb-9">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center size-8 bg-(--accent) text-(--accent-text) font-mono font-bold fs-18 leading-none rounded-xs tracking-(--ls)" style={{ '--ls': '-0.02em' } as React.CSSProperties}>
              T
            </span>
            <span className="fs-17 font-bold tracking-(--ls) text-(--text-primary)" style={{ '--ls': '0.08em' } as React.CSSProperties}>
              TYPSMTHNG
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap justify-end">
            <ThemeToggle />
            <LinkBtn onClick={onShowGuide}>
              <BookOpen size={12} />
              Guide
            </LinkBtn>
          </div>
        </div>

        <div
          className="home-panel py-2.5 px-3 mb-5 grid gap-2"
          style={{ '--panel-tint': '88%', '--panel-blur': '14px' } as React.CSSProperties}
        >
          <div className="workspace-bar">
            <div className="min-w-0">
              <div className="fs-10 text-(--text-tertiary) tracking-(--ls) mb-2" style={{ '--ls': '0.08em' } as React.CSSProperties}>
                WORKSPACES
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSelectedHomeWorkspace(null)}
                  className="border border-(color:--ws-bc) bg-(--ws-bg) text-(--ws-fg) rounded-xs py-1.75 px-3 font-mono fs-11 cursor-pointer whitespace-nowrap"
                  style={{
                    '--ws-bc': selectedHomeWorkspaceId === null ? 'var(--accent)' : 'var(--border-default)',
                    '--ws-bg': selectedHomeWorkspaceId === null ? 'var(--accent)' : 'var(--bg-inset)',
                    '--ws-fg': selectedHomeWorkspaceId === null ? 'var(--accent-text)' : 'var(--text-secondary)',
                  } as React.CSSProperties}
                >
                  All
                </button>
                {homeWorkspaces.map((workspace) => (
                  <div key={workspace.id} className="inline-flex items-stretch">
                    <button
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
                      className="border border-(color:--ws-bc) bg-(--ws-bg) text-(--ws-fg) rounded-l-xs rounded-r-none py-1.75 px-3 font-mono fs-11 cursor-pointer whitespace-nowrap"
                      style={{
                        '--ws-bc': selectedHomeWorkspaceId === workspace.id ? 'var(--accent)' : 'var(--border-default)',
                        '--ws-bg': selectedHomeWorkspaceId === workspace.id ? 'var(--accent-muted)' : 'var(--bg-inset)',
                        '--ws-fg': selectedHomeWorkspaceId === workspace.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      } as React.CSSProperties}
                      title="Double-click to rename. Right-click to delete."
                    >
                      {workspace.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Workspace options for ${workspace.name}`}
                      title={`Options for ${workspace.name}`}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        setWorkspaceContextMenu({
                          workspaceId: workspace.id,
                          x: rect.left,
                          y: rect.bottom + 4,
                        })
                      }}
                      className="border border-(color:--ws-bc) border-l-0 bg-(--ws-bg) text-(--text-tertiary) rounded-r-xs rounded-l-none px-1.25 inline-flex items-center cursor-pointer"
                      style={{
                        '--ws-bc': selectedHomeWorkspaceId === workspace.id ? 'var(--accent)' : 'var(--border-default)',
                        '--ws-bg': selectedHomeWorkspaceId === workspace.id ? 'var(--accent-muted)' : 'var(--bg-inset)',
                      } as React.CSSProperties}
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid justify-items-end content-start gap-3.5 min-w-35">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceQuickAddOpen((value) => !value)
                  setWorkspaceActionError(null)
                }}
                className="inline-flex items-center gap-1.5 border border-(color:--border-default) bg-(--bg-inset) text-(--text-secondary) rounded-xs py-1.5 px-2.5 font-mono fs-10 tracking-(--ls) cursor-pointer whitespace-nowrap"
                style={{ '--ls': '0.04em' } as React.CSSProperties}
              >
                <Plus size={12} />
                Add Workspace
              </button>
              <div
                className="fs-10 text-(--text-tertiary) tracking-(--ls) text-right whitespace-nowrap"
                style={{ '--ls': '0.04em' } as React.CSSProperties}
              >
                {activeWorkspace ? `${visibleProjects.length} in ${activeWorkspace.name}` : `${projects.length} total`}
              </div>
            </div>
          </div>

          {workspaceQuickAddOpen && (
            <div className="border border-(color:--border-default) rounded-xs p-2.5 grid gap-2">
              <div className="flex gap-2 flex-wrap">
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  aria-label="Workspace name"
                  placeholder="Research, Client, Notes..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleQuickCreateWorkspace()
                    }
                  }}
                  className="flex-1 min-w-55 bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs text-(--text-primary) font-mono fs-12 py-2 px-2.5 outline-none"
                />
                <button
                  type="button"
                  onClick={() => { void handleQuickCreateWorkspace() }}
                  className="border border-(color:--accent) bg-(--accent) text-(--accent-text) rounded-xs px-3 font-mono fs-11 cursor-pointer"
                >
                  Create
                </button>
              </div>
              {workspaceActionError && (
                <div className="fs-10 text-(--status-error)">{workspaceActionError}</div>
              )}
            </div>
          )}
        </div>

        {/* ── Hidden file inputs ── */}
        <input ref={latexFileInputRef} type="file" accept=".tex" multiple className="hidden"
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleLatexFiles(e.target.files); e.target.value = '' }}
        />
        <input ref={latexFolderInputRef} type="file" multiple className="hidden"
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleLatexFiles(e.target.files); e.target.value = '' }}
        />
        <input ref={latexZipInputRef} type="file" accept=".zip" className="hidden"
          onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleLatexFiles(e.target.files); e.target.value = '' }}
        />
        <input ref={importAllInputRef} type="file" accept=".zip" className="hidden"
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
        <div className="flex items-center gap-4 mb-5 flex-wrap">
          <div className="relative">
            <LinkBtn
              data-testid="template-init-reveal-button"
              onClick={() => setShowTemplateInit((v) => !v)}
            >
              <Terminal size={12} />
              Templates
            </LinkBtn>
          </div>
          <div className="relative">
            <LinkBtn
              onClick={() => setLatexMenuOpen((v) => !v)}
              disabled={latexBusy}
              className="opacity-(--op)"
              style={{ '--op': latexBusy ? '0.6' : '1' } as React.CSSProperties}
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
            className="home-panel py-3 px-3.5 mb-4 flex items-center gap-2.5 flex-wrap"
            style={{ '--panel-tint': '90%', '--panel-blur': '16px' } as React.CSSProperties}
          >
            <div className="fs-11 text-(--text-secondary)">
              {selectedCount === 0 ? 'Choose documents to group.' : `${selectedCount} selected`}
            </div>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => {
                setWorkspaceSheetOpen(true)
                setWorkspaceActionError(null)
              }}
              className="border border-(color:--accent) bg-(--accent) text-(--accent-text) rounded-xs py-1.75 px-3 font-mono fs-11 cursor-(--cur) opacity-(--op)"
              style={{
                '--cur': selectedCount === 0 ? 'default' : 'pointer',
                '--op': selectedCount === 0 ? '0.5' : '1',
              } as React.CSSProperties}
            >
              Add to Workspace
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => { void handleWorkspaceAssignment(null) }}
                className="border border-(color:--border-default) bg-(--bg-inset) text-(--text-secondary) rounded-xs py-1.75 px-3 font-mono fs-11 cursor-pointer"
              >
                Remove from Workspace
              </button>
            )}
          </div>
        )}

        {/* ── Template init panel (collapsible) ── */}
        {showTemplateInit && (
          <div className="bg-(--bg-surface) border border-(color:--border-default) rounded-xs py-3.5 px-4 mb-5">
            <div className="flex gap-2 items-center mb-2.5">
              <input
                value={marketplaceQuery}
                onFocus={() => setMarketplaceOpen(true)}
                onChange={(event) => { setMarketplaceQuery(event.target.value); setMarketplaceOpen(true) }}
                aria-label="Search templates"
                placeholder="Search templates (ieee, acm, thesis...)"
                disabled={initBusy}
                className="flex-1 bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs text-(--text-primary) font-mono fs-12 py-1.5 px-2 outline-none"
              />
              <button
                data-testid="marketplace-open-button"
                type="button"
                onClick={() => setMarketplaceOpen(true)}
                disabled={initBusy}
                className="inline-flex items-center justify-center gap-1.25 h-7 rounded-xs border border-(color:--border-strong) bg-(--bg-elevated) text-(--text-primary) px-2 font-mono fs-10 tracking-(--ls) cursor-(--cur) opacity-(--op)"
                style={{
                  '--ls': '0.04em',
                  '--cur': initBusy ? 'default' : 'pointer',
                  '--op': initBusy ? '0.7' : '1',
                } as React.CSSProperties}
              >
                <Store size={12} />
                Browse
              </button>
            </div>

            <div className="fs-10 text-(--text-tertiary) tracking-(--ls) mb-1.5" style={{ '--ls': '0.03em' } as React.CSSProperties}>
              Or run directly: typst init @preview/name[:version]
            </div>
            <div className="flex gap-2 items-center">
              <input
                value={initCommand}
                onChange={(e) => setInitCommand(e.target.value)}
                aria-label="Template init command"
                placeholder="typst init @preview/aero-check:0.1.1"
                onKeyDown={(e) => { if (e.key === 'Enter') void handleInitFromCommand() }}
                disabled={initBusy}
                className="flex-1 bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs text-(--text-primary) font-mono fs-12 py-1.5 px-2 outline-none"
              />
              <button
                type="button"
                onClick={() => { void handleInitFromCommand() }}
                disabled={initBusy || !initCommand.trim()}
                className="inline-flex items-center justify-center gap-1.25 min-w-18 h-7.5 rounded-xs border border-(color:--accent) bg-(--accent) text-(--accent-text) font-mono fs-11 tracking-(--ls) cursor-(--cur) opacity-(--op)"
                style={{
                  '--ls': '0.04em',
                  '--cur': initBusy ? 'default' : 'pointer',
                  '--op': initBusy || !initCommand.trim() ? '0.6' : '1',
                } as React.CSSProperties}
              >
                {initBusy ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
                {initBusy ? 'Init...' : 'Run'}
              </button>
            </div>

            <div className="flex gap-1.5 flex-wrap mt-2">
              {quickInitCommands.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setInitCommand(item.command)}
                  disabled={initBusy}
                  className="border border-(color:--border-default) bg-(--bg-inset) text-(--text-secondary) rounded-xs py-0.75 px-1.75 font-mono fs-10 tracking-(--ls) cursor-(--cur)"
                  style={{
                    '--ls': '0.03em',
                    '--cur': initBusy ? 'default' : 'pointer',
                  } as React.CSSProperties}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {initError && (
              <div className="mt-2 text-(--status-error) fs-11">
                {initError}
              </div>
            )}
            {initSuccess && (
              <div className="mt-2 text-(--status-success) fs-11">
                {initSuccess}
              </div>
            )}
          </div>
        )}

        {/* ── Inline feedback banners ── */}
        {latexError && (
          <div className="banner-error">
            <div className="fs-11 text-(--status-error)">{latexError}</div>
            <button
              type="button"
              onClick={() => setLatexError(null)}
              aria-label="Dismiss import error"
              className="size-5 inline-flex items-center justify-center border-none bg-transparent text-(--text-tertiary) cursor-pointer shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {latexResult && (
          <div className="banner-success">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="fs-11 text-(--status-success)">
                  Created &ldquo;{latexResult.projectName}&rdquo; &mdash;{' '}
                  {latexResult.texFilesConverted} .tex {latexResult.texFilesConverted === 1 ? 'file' : 'files'} converted
                  {latexResult.fileCount > latexResult.texFilesConverted && (
                    <span className="text-(--text-tertiary)">
                      {' '}+ {latexResult.fileCount - latexResult.texFilesConverted} other {latexResult.fileCount - latexResult.texFilesConverted === 1 ? 'file' : 'files'}
                    </span>
                  )}
                  {latexResult.metadata.documentclass && (
                    <span className="text-(--text-tertiary) ml-1.5">
                      ({latexResult.metadata.documentclass})
                    </span>
                  )}
                </div>
                {latexResult.warnings.length > 0 && (
                  <div className="fs-10 text-(--text-tertiary) mt-1 leading-(--lh)" style={{ '--lh': '1.5' } as React.CSSProperties}>
                    {latexResult.warnings.length} {latexResult.warnings.length === 1 ? 'warning' : 'warnings'}:
                    {latexResult.warnings.slice(0, 5).map((w, i) => (
                      <div key={i} className="pl-2">&bull; {w.message}</div>
                    ))}
                    {latexResult.warnings.length > 5 && (
                      <div className="pl-2">&hellip; and {latexResult.warnings.length - 5} more</div>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLatexResult(null)}
                aria-label="Dismiss import result"
                className="size-5 inline-flex items-center justify-center border-none bg-transparent text-(--text-tertiary) cursor-pointer shrink-0 self-start"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {importAllResult && (
          <div className="mb-3 fs-11 text-(--status-success) text-center">
            {importAllResult}
          </div>
        )}
        {importAllError && (
          <div className="mb-3 fs-11 text-(--status-error) text-center">
            {importAllError}
          </div>
        )}

        {/* ── Project grid ── */}
        <div className="project-grid">
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
            <div className="bg-(--bg-surface) border border-(color:--accent) rounded-xs py-3.5 px-4 font-mono">
              <div className="fs-10 text-(--text-tertiary) tracking-(--ls) mb-1.5" style={{ '--ls': '0.04em' } as React.CSSProperties}>
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
                className="w-full bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs text-(--text-primary) font-mono fs-13 font-bold py-1.25 px-2 outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewInput(true)}
              onFocus={() => onPreloadWorkspace?.()}
              className="new-project-btn"
              onMouseEnter={() => { onPreloadWorkspace?.() }}
            >
              <Plus size={14} />
              New Project
            </button>
          )}
        </div>

        {/* ── Footer: export / import ── */}
        <div className="mt-7 pt-4 border-t border-t-(color:--border-default) flex justify-center gap-4 flex-wrap">
          {projects.length > 0 && (
            <LinkBtn onClick={() => { void loadProjectIo().then(({ exportAllProjects }) => exportAllProjects()) }}>
              <Download size={12} />
              Export all
            </LinkBtn>
          )}
          <LinkBtn
            onClick={() => importAllInputRef.current?.click()}
            disabled={importAllBusy}
            className="opacity-(--op)"
            style={{ '--op': importAllBusy ? '0.6' : '1' } as React.CSSProperties}
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
          className="sheet-overlay"
        >
          <div
            ref={workspaceSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Assign workspace"
            tabIndex={-1}
            className="workspace-sheet"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="fs-12 text-(--text-primary) font-bold">Assign Workspace</div>
                <div className="fs-10 text-(--text-tertiary) mt-0.5">
                  Group selected documents on the homepage.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceSheetOpen(false)}
                aria-label="Close workspace sheet"
                className="size-7 rounded-xs border border-(color:--border-default) bg-(--bg-inset) text-(--text-secondary) cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {homeWorkspaces.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {homeWorkspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => { void handleWorkspaceAssignment(workspace.id) }}
                    className="border border-(color:--border-default) bg-(--bg-inset) text-(--text-primary) rounded-xs py-2 px-3 font-mono fs-11 cursor-pointer"
                  >
                    {workspace.name}
                  </button>
                ))}
              </div>
            )}

            <div className="border border-(color:--border-default) rounded-xs p-3 grid gap-2">
              <div className="flex items-center gap-2">
                <FolderPlus size={14} color="var(--text-secondary)" />
                <div className="fs-11 text-(--text-secondary)">New workspace</div>
              </div>
              <div className="flex gap-2">
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  aria-label="Workspace name"
                  placeholder="Research, Client, Notes..."
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleCreateWorkspace()
                    }
                  }}
                  className="flex-1 bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs text-(--text-primary) font-mono fs-12 py-2 px-2.5 outline-none"
                />
                <button
                  type="button"
                  onClick={() => { void handleCreateWorkspace() }}
                  className="border border-(color:--accent) bg-(--accent) text-(--accent-text) rounded-xs px-3 font-mono fs-11 cursor-pointer"
                >
                  Create
                </button>
              </div>
              {workspaceActionError && (
                <div className="fs-10 text-(--status-error)">{workspaceActionError}</div>
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
          className="modal-overlay"
        >
          <div
            data-testid="marketplace-modal"
            ref={marketplaceModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Template marketplace"
            tabIndex={-1}
            className="marketplace-modal"
          >
            <div className="flex items-center justify-between gap-2.5 py-3 px-3.5 border-b border-b-(color:--border-default)">
              <div>
                <div className="fs-12 tracking-(--ls) text-(--text-primary) font-bold" style={{ '--ls': '0.06em' } as React.CSSProperties}>
                  Template Marketplace
                </div>
                <div className="fs-10 text-(--text-tertiary) mt-0.5">
                  Typst Universe packages and built-in starters
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMarketplaceOpen(false)}
                aria-label="Close marketplace"
                className="size-7 inline-flex items-center justify-center border-none rounded-xs bg-transparent text-(--text-secondary) cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="py-3 px-3.5 border-b border-b-(color:--border-default) grid gap-1.5">
              <div className="fs-10 text-(--text-tertiary) tracking-(--ls)" style={{ '--ls': '0.03em' } as React.CSSProperties}>
                Search packages (min {MIN_MARKETPLACE_QUERY_LENGTH} characters)
              </div>
              <input
                data-testid="marketplace-search-input"
                value={marketplaceQuery}
                onChange={(event) => setMarketplaceQuery(event.target.value)}
                aria-label="Search Typst Universe packages"
                placeholder="ieee, acm, thesis, conference..."
                className="w-full bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs text-(--text-primary) font-mono fs-12 py-1.75 px-2 outline-none"
              />
              {initError && (
                <div
                  data-testid="marketplace-init-error"
                  className="text-(--status-error) fs-11 leading-(--lh)"
                  style={{ '--lh': '1.4' } as React.CSSProperties}
                >
                  {initError}
                </div>
              )}
            </div>

            <div className="overflow-y-auto py-3 px-3.5 grid gap-3.5">
              {/* Built-in section */}
              <div>
                <div className="fs-10 tracking-(--ls) text-(--text-tertiary) mb-1.5" style={{ '--ls': '0.06em' } as React.CSSProperties}>
                  BUILT-IN
                </div>
                <div className="grid gap-1.5">
                  {builtInTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="border border-(color:--border-default) rounded-xs bg-(--bg-inset) p-2.5 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="fs-11 tracking-(--ls) text-(--text-primary) font-bold" style={{ '--ls': '0.03em' } as React.CSSProperties}>
                          {template.label}
                        </div>
                        <div className="fs-10 text-(--text-secondary) mt-0.5 leading-(--lh)" style={{ '--lh': '1.4' } as React.CSSProperties}>
                          {template.description}
                        </div>
                      </div>
                      <button
                        data-testid={`marketplace-import-${template.id}`}
                        type="button"
                        onClick={() => { void handleImportBuiltInTemplate(template.id) }}
                        disabled={initBusy}
                        className="inline-flex items-center justify-center gap-1.25 border border-(color:--accent) bg-(--accent) text-(--accent-text) rounded-xs h-6.5 px-2 font-mono fs-10 tracking-(--ls) cursor-(--cur) opacity-(--op) shrink-0"
                        style={{
                          '--ls': '0.04em',
                          '--cur': initBusy ? 'default' : 'pointer',
                          '--op': initBusy ? '0.7' : '1',
                        } as React.CSSProperties}
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
                <div className="fs-10 tracking-(--ls) text-(--text-tertiary) mb-1.5" style={{ '--ls': '0.06em' } as React.CSSProperties}>
                  TYPST UNIVERSE
                </div>

                {marketplaceQuery.trim().length < MIN_MARKETPLACE_QUERY_LENGTH && (
                  <div className="dashed-note">
                    Type at least {MIN_MARKETPLACE_QUERY_LENGTH} characters to search.
                  </div>
                )}

                {marketplaceBusy && (
                  <div className="border border-(color:--border-default) rounded-xs p-2.5 text-(--text-secondary) fs-11 inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    Searching...
                  </div>
                )}

                {!marketplaceBusy && marketplaceError && (
                  <div className="marketplace-error-box">
                    {marketplaceError}
                  </div>
                )}

                {!marketplaceBusy && !marketplaceError && marketplaceQuery.trim().length >= MIN_MARKETPLACE_QUERY_LENGTH && marketplaceResults.length === 0 && (
                  <div className="dashed-note">
                    No packages matched your query.
                  </div>
                )}

                {!marketplaceBusy && marketplaceResults.length > 0 && (
                  <div className="grid gap-1.5">
                    {marketplaceResults.map((item) => (
                      <div
                        key={`${item.name}:${item.latestVersion}`}
                        className="border border-(color:--border-default) rounded-xs bg-(--bg-inset) p-2.5 grid gap-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <span className="fs-11 text-(--text-primary) tracking-(--ls) font-bold" style={{ '--ls': '0.03em' } as React.CSSProperties}>
                              {formatPackageTitle(item.name)}
                            </span>
                            <span className="fs-10 text-(--text-tertiary) ml-2">
                              @preview/{item.name}:{item.latestVersion}
                            </span>
                          </div>
                          {item.isTemplate ? (
                            <span className="badge-template">
                              Template
                            </span>
                          ) : (
                            <span className="badge-package">
                              Package
                            </span>
                          )}
                        </div>

                        {item.isTemplate ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              data-testid={`marketplace-import-${item.name}`}
                              type="button"
                              onClick={() => { void handleMarketplaceImport(item) }}
                              disabled={initBusy}
                              className="border border-(color:--accent) bg-(--accent) text-(--accent-text) rounded-xs h-6.25 px-2 font-mono fs-10 tracking-(--ls) cursor-(--cur) opacity-(--op)"
                              style={{
                                '--ls': '0.04em',
                                '--cur': initBusy ? 'default' : 'pointer',
                                '--op': initBusy ? '0.7' : '1',
                              } as React.CSSProperties}
                            >
                              Import
                            </button>
                            <button
                              data-testid={`marketplace-prefill-${item.name}`}
                              type="button"
                              onClick={() => handleMarketplacePrefill(item)}
                              disabled={initBusy}
                              className="border border-(color:--border-strong) bg-(--bg-elevated) text-(--text-primary) rounded-xs h-6.25 px-2 font-mono fs-10 tracking-(--ls) cursor-(--cur) opacity-(--op)"
                              style={{
                                '--ls': '0.04em',
                                '--cur': initBusy ? 'default' : 'pointer',
                                '--op': initBusy ? '0.7' : '1',
                              } as React.CSSProperties}
                            >
                              Prefill
                            </button>
                          </div>
                        ) : (
                          <div className="text-(--text-tertiary) fs-10">
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
