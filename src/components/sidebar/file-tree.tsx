import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, type ProjectFile } from '@/stores/project-store'
import { useUIStore } from '@/stores/ui-store'
import { ContextMenu, type ContextMenuAction } from '@/components/ui/context-menu'
import { shouldTreatUploadAsText, isLatexPath } from '@/lib/file-classification'
import { convertUploadedLatexFile } from '@/lib/project-io'
import { getProjectFileIndex, isHiddenInternalPath } from '@/lib/file-index'
import {
  File,
  Upload,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  Copy,
  Plus,
  Search,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  FolderUp,
  Check,
} from 'lucide-react'
import { useEditorStore } from '@/stores/editor-store'

// ── Indent guides ──

const INDENT_BASE = 12   // base paddingLeft
const INDENT_STEP = 16   // px per depth level
const BORDER_LEFT = 3    // border-left width on rows

function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${BORDER_LEFT + INDENT_BASE + i * INDENT_STEP + 6}px`,
            top: 0,
            bottom: 0,
            width: '1px',
            background: 'var(--indent-guide)',
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  )
}

// ── Tree data structure ──

interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children?: TreeNode[]
}

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = []
  const folderMap = new Map<string, TreeNode>()

  function ensureFolder(folderPath: string): TreeNode {
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!
    const parts = folderPath.split('/').filter(Boolean)
    const name = parts[parts.length - 1]
    const node: TreeNode = { name, path: folderPath, isFolder: true, children: [] }
    folderMap.set(folderPath, node)

    if (parts.length === 1) {
      root.push(node)
    } else {
      const parentPath = '/' + parts.slice(0, -1).join('/')
      const parent = ensureFolder(parentPath)
      parent.children!.push(node)
    }
    return node
  }

  for (const file of files) {
    if (isHiddenInternalPath(file.path)) {
      continue
    }

    // Skip .folder placeholders from display
    const fileName = file.path.split('/').pop() ?? ''
    if (fileName === '.folder') {
      // But still ensure the folder exists in the tree
      const folderPath = file.path.substring(0, file.path.lastIndexOf('/'))
      if (folderPath && folderPath !== '/') {
        ensureFolder(folderPath)
      }
      continue
    }

    const parts = file.path.split('/').filter(Boolean)
    if (parts.length === 1) {
      // Root-level file
      root.push({ name: parts[0], path: file.path, isFolder: false })
    } else {
      // File inside folder(s)
      const folderPath = '/' + parts.slice(0, -1).join('/')
      const parent = ensureFolder(folderPath)
      parent.children!.push({
        name: parts[parts.length - 1],
        path: file.path,
        isFolder: false,
      })
    }
  }

  // Sort recursively: folders first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
  }
  sortNodes(root)

  return root
}

// ── Project dropdown ──

function ProjectDropdown({
  onClose,
  onRename,
}: {
  onClose: () => void
  onRename: () => void
}) {
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)

  const handleSelectProject = (id: string) => {
    useProjectStore.getState().selectProject(id)
    onClose()
  }

  const handleNewProject = async () => {
    const name = prompt('Project name:')
    if (name?.trim()) {
      try {
        await useProjectStore.getState().createProject(name.trim())
      } catch (err) {
        console.error('Failed to create project:', err)
        alert('Failed to create project. Please try again.')
        return
      }
    }
    onClose()
  }

  const handleDelete = () => {
    if (projects.length <= 1) return
    const current = projects.find((p) => p.id === currentProjectId)
    if (current && confirm(`Delete project "${current.name}"? This cannot be undone.`)) {
      useProjectStore.getState().deleteProject(current.id)
    }
    onClose()
  }

  const menuStyle = {
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  }

  const itemHover = (e: React.MouseEvent<HTMLButtonElement>, enter: boolean, danger = false) => {
    e.currentTarget.style.background = enter ? 'var(--bg-hover)' : 'transparent'
    if (!danger) {
      e.currentTarget.style.color = enter ? 'var(--text-primary)' : 'var(--text-secondary)'
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute left-0 right-0 z-50 py-1"
        style={{
          top: '40px',
          background: 'var(--bg-elevated)',
          border: '2px solid var(--border-strong)',
          borderRadius: '2px',
          fontFamily: 'var(--font-mono)',
          maxHeight: '300px',
          overflowY: 'auto',
        }}
      >
        {/* Project list */}
        {projects.map((p) => (
          <button
            key={p.id}
            className="flex items-center gap-2 w-full px-3 py-1.5"
            style={{
              ...menuStyle,
              color: p.id === currentProjectId ? 'var(--accent)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            onClick={() => handleSelectProject(p.id)}
          >
            {p.id === currentProjectId && <Check size={11} className="shrink-0" />}
            {p.id !== currentProjectId && <span style={{ width: '11px' }} className="shrink-0" />}
            <span className="truncate" style={{ textTransform: 'none' }}>{p.name}</span>
          </button>
        ))}

        <div style={{ height: '1px', background: 'var(--border-default)', margin: '2px 0' }} />

        {/* Rename */}
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5"
          style={{ ...menuStyle, color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => itemHover(e, true)}
          onMouseLeave={(e) => itemHover(e, false)}
          onClick={() => {
            onRename()
            onClose()
          }}
        >
          <Pencil size={11} />
          RENAME
        </button>

        {/* New project */}
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5"
          style={{ ...menuStyle, color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => itemHover(e, true)}
          onMouseLeave={(e) => itemHover(e, false)}
          onClick={handleNewProject}
        >
          <Plus size={11} />
          NEW PROJECT
        </button>

        <div style={{ height: '1px', background: 'var(--border-default)', margin: '2px 0' }} />

        {/* Delete */}
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5"
          style={{
            ...menuStyle,
            color: projects.length <= 1 ? 'var(--text-tertiary)' : 'var(--status-error)',
            cursor: projects.length <= 1 ? 'not-allowed' : 'pointer',
            opacity: projects.length <= 1 ? 0.5 : 1,
          }}
          disabled={projects.length <= 1}
          onMouseEnter={(e) => {
            if (projects.length > 1) itemHover(e, true, true)
          }}
          onMouseLeave={(e) => {
            if (projects.length > 1) itemHover(e, false, true)
          }}
          onClick={handleDelete}
        >
          <Trash2 size={11} />
          DELETE
        </button>
      </div>
    </>
  )
}

// ── Inline name input ──

function InlineNameInput({
  initialValue,
  onSubmit,
  onCancel,
  depth,
  isFolder,
}: {
  initialValue: string
  onSubmit: (name: string) => void
  onCancel: () => void
  depth: number
  isFolder: boolean
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Select filename without extension for files
    if (inputRef.current) {
      inputRef.current.focus()
      if (!isFolder) {
        const dotIndex = initialValue.lastIndexOf('.')
        if (dotIndex > 0) {
          inputRef.current.setSelectionRange(0, dotIndex)
        } else {
          inputRef.current.select()
        }
      } else {
        inputRef.current.select()
      }
    }
  }, [initialValue, isFolder])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== initialValue) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <div
      className="flex items-center"
      style={{
        position: 'relative',
        height: '32px',
        paddingLeft: `${INDENT_BASE + depth * INDENT_STEP + (isFolder ? 0 : INDENT_STEP)}px`,
        paddingRight: '12px',
        gap: '8px',
      }}
    >
      <IndentGuides depth={depth} />
      {isFolder
        ? <FolderOpen size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
        : <File size={14} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
      }
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="bg-transparent outline-none w-full"
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          padding: '2px 4px',
          border: '1px solid var(--accent)',
          borderRadius: '2px',
          background: 'var(--bg-inset)',
        }}
      />
    </div>
  )
}

// ── Folder item ──

function FolderItem({
  node,
  depth,
  isOpen,
  onToggle,
  expandedSet,
  onToggleFolder,
  currentFilePath,
  onCreateInFolder,
}: {
  node: TreeNode
  depth: number
  isOpen: boolean
  onToggle: () => void
  expandedSet: Set<string>
  onToggleFolder: (path: string) => void
  currentFilePath: string | null
  onCreateInFolder: (folderPath: string, type: 'file' | 'folder') => void
}) {
  const { deleteFolder, renameFolder } = useProjectStore(
    useShallow((s) => ({ deleteFolder: s.deleteFolder, renameFolder: s.renameFolder }))
  )
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleRename = (newName: string) => {
    if (/[/\\\0]/.test(newName)) {
      alert('Name cannot contain /, \\, or null characters.')
      return
    }
    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'))
    const newPath = parentPath ? `${parentPath}/${newName}` : `/${newName}`
    renameFolder(node.path, newPath)
    setRenaming(false)
  }

  if (renaming) {
    return (
      <InlineNameInput
        initialValue={node.name}
        onSubmit={handleRename}
        onCancel={() => setRenaming(false)}
        depth={depth}
        isFolder={true}
      />
    )
  }

  const contextActions: ContextMenuAction[] = [
    {
      label: 'NEW FILE',
      icon: <FilePlus size={12} />,
      onClick: () => onCreateInFolder(node.path, 'file'),
    },
    {
      label: 'NEW FOLDER',
      icon: <FolderPlus size={12} />,
      onClick: () => onCreateInFolder(node.path, 'folder'),
    },
    {
      label: 'RENAME',
      icon: <Pencil size={12} />,
      onClick: () => setRenaming(true),
    },
    {
      label: 'DELETE',
      icon: <Trash2 size={12} />,
      onClick: () => {
        if (confirm(`Delete folder "${node.name}" and all its contents?`)) {
          deleteFolder(node.path)
        }
      },
      danger: true,
    },
  ]

  return (
    <div style={{ contentVisibility: 'auto', containIntrinsicSize: '32px' }}>
      <button
        className="flex items-center w-full text-left"
        style={{
          position: 'relative',
          height: '32px',
          paddingLeft: `${INDENT_BASE + depth * INDENT_STEP}px`,
          paddingRight: '12px',
          gap: '6px',
          background: 'transparent',
          color: 'var(--text-secondary)',
          borderLeft: `${BORDER_LEFT}px solid transparent`,
          borderRadius: '0',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          transition: 'background 80ms ease, color 80ms ease',
        }}
        onClick={onToggle}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
          }
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
        <IndentGuides depth={depth} />
        <ChevronRight
          size={12}
          className="shrink-0"
          style={{
            color: 'var(--text-tertiary)',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
          }}
        />
        {isOpen
          ? <FolderOpen size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
          : <Folder size={14} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
        }
        <span className="truncate" style={{ textTransform: 'none' }}>{node.name}</span>
      </button>

      {isOpen && node.children && (
        <div>
          {node.children.map((child) =>
            child.isFolder ? (
              <FolderItem
                key={child.path}
                node={child}
                depth={depth + 1}
                isOpen={expandedSet.has(child.path)}
                onToggle={() => onToggleFolder(child.path)}
                expandedSet={expandedSet}
                onToggleFolder={onToggleFolder}
                currentFilePath={currentFilePath}
                onCreateInFolder={onCreateInFolder}
              />
            ) : (
              <FileItem
                key={child.path}
                path={child.path}
                name={child.name}
                isActive={currentFilePath === child.path}
                depth={depth + 1}
              />
            )
          )}
        </div>
      )}

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

const isImageFile = (name: string) => /\.(png|jpe?g|jfif|gif|svg|webp|avif|heif|heic|bmp|tiff?|ico)$/i.test(name)

function buildDuplicatePath(existingPaths: Iterable<string>, path: string): string {
  const taken = new Set(existingPaths)
  const slashIndex = path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex) : ''
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
  const dotIndex = fileName.lastIndexOf('.')
  const hasExtension = dotIndex > 0
  const baseName = hasExtension ? fileName.slice(0, dotIndex) : fileName
  const extension = hasExtension ? fileName.slice(dotIndex) : ''

  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? ' copy' : ` copy ${attempt + 1}`
    const candidateName = `${baseName}${suffix}${extension}`
    const candidatePath = directory ? `${directory}/${candidateName}` : `/${candidateName}`
    if (!taken.has(candidatePath)) {
      return candidatePath
    }
    attempt += 1
  }
}

// ── File item ──

function FileItem({
  path,
  name,
  isActive,
  depth,
}: {
  path: string
  name: string
  isActive: boolean
  depth: number
}) {
  const editorSource = useEditorStore((s) => s.source)
  const { selectFile, createFile, addBinaryFile, deleteFile, renameFile, currentProject, currentFilePath } = useProjectStore(
    useShallow((s) => ({
      selectFile: s.selectFile,
      createFile: s.createFile,
      addBinaryFile: s.addBinaryFile,
      deleteFile: s.deleteFile,
      renameFile: s.renameFile,
      currentProject: s.getCurrentProject(),
      currentFilePath: s.currentFilePath,
    }))
  )
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleRename = (newName: string) => {
    if (/[/\\\0]/.test(newName)) {
      alert('Name cannot contain /, \\, or null characters.')
      return
    }
    const dir = path.substring(0, path.lastIndexOf('/'))
    renameFile(path, `${dir}/${newName}`)
    setRenaming(false)
  }

  const handleDuplicate = async () => {
    const file = currentProject?.files.find((entry) => entry.path === path)
    if (!file || !currentProject) return

    const duplicatePath = buildDuplicatePath(
      currentProject.files.map((entry) => entry.path),
      path,
    )

    if (file.isBinary) {
      if (!file.binaryData) {
        window.alert('This file is not available to duplicate right now.')
        return
      }
      await addBinaryFile(duplicatePath, new Uint8Array(file.binaryData))
      return
    }

    const content = currentFilePath === path ? editorSource : file.content
    await createFile(duplicatePath, content)
  }

  if (renaming) {
    return (
      <InlineNameInput
        initialValue={name}
        onSubmit={handleRename}
        onCancel={() => setRenaming(false)}
        depth={depth}
        isFolder={false}
      />
    )
  }

  const contextActions: ContextMenuAction[] = [
    {
      label: 'DUPLICATE',
      icon: <Copy size={12} />,
      onClick: () => {
        void handleDuplicate()
      },
    },
    {
      label: 'RENAME',
      icon: <Pencil size={12} />,
      onClick: () => setRenaming(true),
    },
    {
      label: 'DELETE',
      icon: <Trash2 size={12} />,
      onClick: () => {
        if (confirm(`Delete "${name}"?`)) {
          deleteFile(path)
        }
      },
      danger: true,
    },
  ]

  return (
    <div className="relative" style={{ contentVisibility: 'auto', containIntrinsicSize: '32px' }}>
      <button
        className="flex items-center w-full text-left"
        style={{
          position: 'relative',
          height: '32px',
          paddingLeft: `${INDENT_BASE + depth * INDENT_STEP + INDENT_STEP}px`,
          paddingRight: '12px',
          gap: '8px',
          background: isActive ? 'var(--accent-muted)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          borderLeft: isActive ? `${BORDER_LEFT}px solid var(--accent)` : `${BORDER_LEFT}px solid transparent`,
          borderRadius: '0',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          transition: 'background 80ms ease, color 80ms ease',
        }}
        onClick={() => {
          if (isImageFile(name)) {
            useUIStore.getState().setImagePreviewPath(path)
          } else {
            selectFile(path)
          }
        }}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
          }
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'var(--bg-hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }
        }}
      >
        <IndentGuides depth={depth} />
        <File size={14} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
        <span className="truncate">{name}</span>
      </button>

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

// ── New item creation row ──

function NewItemInput({
  type,
  depth,
  onSubmit,
  onCancel,
}: {
  parentPath: string
  type: 'file' | 'folder'
  depth: number
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <div
      className="flex items-center"
      style={{
        position: 'relative',
        height: '32px',
        paddingLeft: `${INDENT_BASE + depth * INDENT_STEP + (type === 'file' ? INDENT_STEP : 0)}px`,
        paddingRight: '12px',
        gap: '8px',
      }}
    >
      <IndentGuides depth={depth} />
      {type === 'folder'
        ? <FolderPlus size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
        : <FilePlus size={14} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
      }
      <input
        ref={inputRef}
        value={value}
        placeholder={type === 'folder' ? 'folder name' : 'file name'}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="bg-transparent outline-none w-full"
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          padding: '2px 4px',
          border: '1px solid var(--accent)',
          borderRadius: '2px',
          background: 'var(--bg-inset)',
        }}
      />
    </div>
  )
}

// ── Drop menu for new file/folder ──

function NewDropdown({
  onNewFile,
  onNewFolder,
  onClose,
  anchorRect,
}: {
  onNewFile: () => void
  onNewFolder: () => void
  onClose: () => void
  anchorRect: { left: number; bottom: number } | null
}) {
  if (!anchorRect) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 py-1 min-w-[140px]"
        style={{
          left: anchorRect.left,
          top: anchorRect.bottom + 4,
          background: 'var(--bg-elevated)',
          border: '2px solid var(--border-strong)',
          borderRadius: '2px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5"
          style={{
            color: 'var(--text-secondary)',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
          onClick={() => {
            onNewFile()
            onClose()
          }}
        >
          <FilePlus size={12} /> NEW FILE
        </button>
        <div style={{ height: '1px', background: 'var(--border-default)', margin: '2px 0' }} />
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5"
          style={{
            color: 'var(--text-secondary)',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
          onClick={() => {
            onNewFolder()
            onClose()
          }}
        >
          <FolderPlus size={12} /> NEW FOLDER
        </button>
      </div>
    </>
  )
}

// ── Helper: recursively read directory entries from drag-and-drop ──

interface FileEntry {
  relativePath: string
  file: globalThis.File
}

async function readEntryRecursive(
  entry: FileSystemEntry,
  basePath: string,
): Promise<FileEntry[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    return new Promise((resolve) => {
      fileEntry.file(
        (file) => {
          resolve([{ relativePath: `${basePath}/${file.name}`, file }])
        },
        (err) => {
          console.warn(`Failed to read file ${entry.name}:`, err)
          resolve([])
        },
      )
    })
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    // Chromium returns directory entries in batches; keep calling until empty.
    return new Promise((resolve) => {
      const results: FileEntry[] = []
      const readBatch = () => {
        reader.readEntries(
          async (entries) => {
            if (entries.length === 0) {
              resolve(results)
              return
            }
            for (const child of entries) {
              const childResults = await readEntryRecursive(child, `${basePath}/${entry.name}`)
              results.push(...childResults)
            }
            readBatch()
          },
          (err) => {
            console.warn(`Failed to read directory ${entry.name}:`, err)
            resolve(results)
          },
        )
      }
      readBatch()
    })
  }
  return []
}

// ── Main FileTree component ──

export function FileTree() {
  const {
    projects,
    createFile,
    createFolder,
    createFilesBatch,
    addBinaryFilesBatch,
    currentProjectId,
    currentFilePath,
  } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      createFile: s.createFile,
      createFolder: s.createFolder,
      createFilesBatch: s.createFilesBatch,
      addBinaryFilesBatch: s.addBinaryFilesBatch,
      currentProjectId: s.currentProjectId,
      currentFilePath: s.currentFilePath,
    }))
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [initialExpansionDone, setInitialExpansionDone] = useState(false)
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const [renamingProject, setRenamingProject] = useState(false)
  const [projectNameValue, setProjectNameValue] = useState('')
  const projectNameInputRef = useRef<HTMLInputElement>(null)
  const [dropdownRect, setDropdownRect] = useState<{ left: number; bottom: number } | null>(null)
  const [newItem, setNewItem] = useState<{
    parentPath: string
    type: 'file' | 'folder'
    depth: number
  } | null>(null)

  const currentProject = projects.find((p) => p.id === currentProjectId)
  const fileIndex = useMemo(() => getProjectFileIndex(currentProject), [currentProject])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingProject && projectNameInputRef.current) {
      projectNameInputRef.current.focus()
      projectNameInputRef.current.select()
    }
  }, [renamingProject])

  const handleProjectRenameStart = useCallback(() => {
    setProjectNameValue(currentProject?.name ?? '')
    setRenamingProject(true)
  }, [currentProject?.name])

  const handleProjectRenameSubmit = useCallback(() => {
    const trimmed = projectNameValue.trim()
    if (trimmed && currentProjectId && trimmed !== currentProject?.name) {
      useProjectStore.getState().renameProject(currentProjectId, trimmed)
    }
    setRenamingProject(false)
  }, [projectNameValue, currentProjectId, currentProject?.name])

  // Build tree from files
  const tree = useMemo(() => {
    if (!currentProject) return []
    return buildTree(fileIndex.treeFiles)
  }, [currentProject, fileIndex.treeFiles])

  // Expand all folders by default on first load
  // We use a ref to track whether initial expansion has already happened
  // to avoid calling setState directly in the effect after first render
  const initialExpansionRef = useRef(false)
  useEffect(() => {
    if (!initialExpansionRef.current && !initialExpansionDone && tree.length > 0) {
      initialExpansionRef.current = true
      const allFolders = new Set<string>()
      function collectFolders(nodes: TreeNode[]) {
        for (const node of nodes) {
          if (node.isFolder) {
            allFolders.add(node.path)
            if (node.children) collectFolders(node.children)
          }
        }
      }
      collectFolders(tree)
      // Use requestAnimationFrame to avoid setState in effect synchronously
      requestAnimationFrame(() => {
        setExpandedFolders(allFolders)
        setInitialExpansionDone(true)
      })
    }
  }, [tree, initialExpansionDone])

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Filter tree for search
  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree
    const query = searchQuery.toLowerCase()

    function filterNodes(nodes: TreeNode[]): TreeNode[] {
      const result: TreeNode[] = []
      for (const node of nodes) {
        if (node.isFolder) {
          const filteredChildren = filterNodes(node.children ?? [])
          if (filteredChildren.length > 0) {
            result.push({ ...node, children: filteredChildren })
          }
        } else {
          if (node.name.toLowerCase().includes(query)) {
            result.push(node)
          }
        }
      }
      return result
    }

    return filterNodes(tree)
  }, [tree, searchQuery])

  // Handle creating new items inline
  const handleCreateInFolder = useCallback((folderPath: string, type: 'file' | 'folder') => {
    // Make sure the folder is expanded
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.add(folderPath)
      return next
    })
    // Calculate depth from path
    const depth = folderPath.split('/').filter(Boolean).length
    setNewItem({ parentPath: folderPath, type, depth })
  }, [])

  const handleNewItemSubmit = useCallback(async (name: string) => {
    if (!newItem) return
    const parentPath = newItem.parentPath
    if (newItem.type === 'file') {
      const filePath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
      await createFile(filePath)
    } else {
      const folderPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
      await createFolder(folderPath)
      // Auto-expand the new folder
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        next.add(folderPath)
        return next
      })
    }
    setNewItem(null)
  }, [newItem, createFile, createFolder])

  const handleRootNewFile = useCallback(() => {
    setNewItem({ parentPath: '/', type: 'file', depth: 0 })
  }, [])

  const handleRootNewFolder = useCallback(() => {
    setNewItem({ parentPath: '/', type: 'folder', depth: 0 })
  }, [])

  const ingestFiles = useCallback(async (entries: Array<{ path: string; file: File }>) => {
    const textEntries: Array<{ path: string; content: string }> = []
    const binaryEntries: Array<{ path: string; data: Uint8Array }> = []
    const latexWarnings: string[] = []

    for (const entry of entries) {
      if (shouldTreatUploadAsText(entry.file)) {
        const text = await entry.file.text()
        if (isLatexPath(entry.file.name)) {
          const result = await convertUploadedLatexFile(text, entry.file.name)
          const typPath = entry.path.replace(/\.tex$/i, '.typ')
          textEntries.push({ path: typPath, content: result.content })
          for (const warning of result.warnings) {
            latexWarnings.push(warning.message)
          }
        } else {
          textEntries.push({ path: entry.path, content: text })
        }
      } else {
        const buffer = await entry.file.arrayBuffer()
        binaryEntries.push({ path: entry.path, data: new Uint8Array(buffer) })
      }
    }

    if (textEntries.length > 0) {
      await createFilesBatch(textEntries)
    }
    if (binaryEntries.length > 0) {
      await addBinaryFilesBatch(binaryEntries)
    }
    if (latexWarnings.length > 0) {
      console.warn('LaTeX conversion warnings during file ingest:', latexWarnings)
    }
  }, [createFilesBatch, addBinaryFilesBatch])

  // Upload handlers
  const handleUploadFiles = useCallback(async (files: FileList, basePath = '') => {
    const entries: Array<{ path: string; file: File }> = []
    for (const file of Array.from(files)) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      let path: string
      if (relativePath && basePath === '') {
        path = `/${relativePath}`
      } else if (basePath) {
        path = `${basePath}/${file.name}`
      } else {
        path = `/${file.name}`
      }
      entries.push({ path, file })
    }
    await ingestFiles(entries)
  }, [ingestFiles])

  // Drag and drop with folder detection
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.style.outline = '2px dashed var(--accent)'
    e.currentTarget.style.outlineOffset = '-2px'
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.outline = ''
  }

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.style.outline = ''

    try {
      // Try webkitGetAsEntry for folder support
      const items = e.dataTransfer.items
      if (items && items.length > 0) {
        const entries: FileEntry[] = []
        let hasEntries = false

        for (let i = 0; i < items.length; i++) {
          const entry = items[i].webkitGetAsEntry?.()
          if (entry) {
            hasEntries = true
            const results = await readEntryRecursive(entry, '')
            entries.push(...results)
          }
        }

        if (hasEntries && entries.length > 0) {
          await ingestFiles(
            entries.map(({ relativePath, file }) => ({
              path: relativePath.startsWith('/') ? relativePath : `/${relativePath}`,
              file,
            })),
          )
          return
        }
      }

      // Fallback: plain file upload
      if (e.dataTransfer.files.length > 0) {
        await handleUploadFiles(e.dataTransfer.files)
      }
    } catch (err) {
      console.error('File drop failed:', err)
    }
  }, [handleUploadFiles, ingestFiles])

  // Render tree nodes recursively
  function renderNodes(nodes: TreeNode[], depth: number) {
    const result: React.ReactNode[] = []
    for (const node of nodes) {
      if (node.isFolder) {
        result.push(
          <FolderItem
            key={node.path}
            node={node}
            depth={depth}
            isOpen={expandedFolders.has(node.path)}
            onToggle={() => toggleFolder(node.path)}
            expandedSet={expandedFolders}
            onToggleFolder={toggleFolder}
            currentFilePath={currentFilePath}
            onCreateInFolder={handleCreateInFolder}
          />
        )
        // Render new item input inside the open folder if needed
        if (
          newItem &&
          newItem.parentPath === node.path &&
          expandedFolders.has(node.path)
        ) {
          result.push(
            <NewItemInput
              key={`new-${node.path}`}
              parentPath={newItem.parentPath}
              type={newItem.type}
              depth={newItem.depth}
              onSubmit={handleNewItemSubmit}
              onCancel={() => setNewItem(null)}
            />
          )
        }
      } else {
        result.push(
          <FileItem
            key={node.path}
            path={node.path}
            name={node.name}
            isActive={currentFilePath === node.path}
            depth={depth}
          />
        )
      }
    }
    return result
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: 'var(--bg-surface)' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Project header */}
      <div className="relative shrink-0" style={{ borderBottom: '1px solid var(--border-default)' }}>
        {renamingProject ? (
          <div
            className="flex items-center"
            style={{
              height: '40px',
              padding: '0 12px',
            }}
          >
            <input
              ref={projectNameInputRef}
              value={projectNameValue}
              onChange={(e) => setProjectNameValue(e.target.value)}
              onBlur={handleProjectRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleProjectRenameSubmit()
                if (e.key === 'Escape') setRenamingProject(false)
              }}
              className="bg-transparent outline-none w-full"
              style={{
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 500,
                padding: '2px 4px',
                border: '1px solid var(--accent)',
                borderRadius: '2px',
                background: 'var(--bg-inset)',
              }}
            />
          </div>
        ) : (
          <button
            className="flex items-center justify-between w-full"
            style={{
              height: '40px',
              padding: '0 12px',
              background: projectDropdownOpen ? 'var(--bg-hover)' : 'transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
            onClick={() => setProjectDropdownOpen((v) => !v)}
            onMouseEnter={(e) => {
              if (!projectDropdownOpen) e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              if (!projectDropdownOpen) e.currentTarget.style.background = 'transparent'
            }}
          >
            <span className="truncate">
              {currentProject?.name ?? 'Project'}
            </span>
            <ChevronDown
              size={13}
              style={{
                color: 'var(--text-tertiary)',
                flexShrink: 0,
                transform: projectDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 120ms ease',
              }}
            />
          </button>
        )}

        {projectDropdownOpen && (
          <ProjectDropdown
            onClose={() => setProjectDropdownOpen(false)}
            onRename={handleProjectRenameStart}
          />
        )}
      </div>

      {/* Files tab indicator */}
      <div
        className="shrink-0"
        style={{
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <div
          style={{
            padding: '0 12px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-primary)',
            borderBottom: '2px solid var(--accent)',
          }}
        >
          FILES
        </div>
      </div>

      {/* Search + actions row */}
      <div
        className="shrink-0 flex items-center gap-1"
        style={{
          padding: '8px 8px 8px 8px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="flex items-center gap-1.5 flex-1"
          style={{
            height: '28px',
            padding: '0 8px',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-default)',
            borderRadius: '2px',
          }}
        >
          <Search size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="SEARCH FILES..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none w-full"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-primary)',
              padding: 0,
            }}
          />
        </div>
        <button
          className="toolbar-button"
          style={{ width: '28px', height: '28px' }}
          onClick={() => fileInputRef.current?.click()}
          title="Upload file"
          disabled={!currentProjectId}
        >
          <Upload size={13} />
        </button>
        <button
          className="toolbar-button"
          style={{ width: '28px', height: '28px' }}
          onClick={() => folderInputRef.current?.click()}
          title="Upload folder"
          disabled={!currentProjectId}
        >
          <FolderUp size={13} />
        </button>
        <button
          ref={newButtonRef}
          className="toolbar-button"
          style={{ width: '28px', height: '28px' }}
          onClick={() => {
            if (dropdownRect) {
              setDropdownRect(null)
            } else {
              const rect = newButtonRef.current?.getBoundingClientRect()
              if (rect) setDropdownRect({ left: rect.left, bottom: rect.bottom })
            }
          }}
          title="New file or folder"
          disabled={!currentProjectId}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* New dropdown */}
      {dropdownRect && (
        <NewDropdown
          anchorRect={dropdownRect}
          onNewFile={() => {
            handleRootNewFile()
          }}
          onNewFolder={() => {
            handleRootNewFolder()
          }}
          onClose={() => setDropdownRect(null)}
        />
      )}

      {/* File tree */}
      <div className="flex-1 overflow-auto" style={{ paddingTop: '4px', paddingBottom: '4px' }}>
        {renderNodes(filteredTree, 0)}

        {/* New item at root level */}
        {newItem && newItem.parentPath === '/' && (
          <NewItemInput
            parentPath="/"
            type={newItem.type}
            depth={0}
            onSubmit={handleNewItemSubmit}
            onCancel={() => setNewItem(null)}
          />
        )}

        {filteredTree.length === 0 && searchQuery && (
          <div
            style={{
              padding: '12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              textTransform: 'uppercase',
            }}
          >
            NO FILES MATCH "{searchQuery}"
          </div>
        )}

        {filteredTree.length === 0 && !searchQuery && (
          <div
            style={{
              padding: '24px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              textTransform: 'uppercase',
              lineHeight: '1.6',
            }}
          >
            DROP FILES HERE
            <br />
            OR USE + TO CREATE
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleUploadFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => {
          if (e.target.files) handleUploadFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
