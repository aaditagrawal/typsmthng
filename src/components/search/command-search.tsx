import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Download, File, MoonStar, Play, Save, Settings } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useProjectStore } from '@/stores/project-store'
import { useEditorStore } from '@/stores/editor-store'
import { useSettingsStore } from '@/stores/settings-store'
import { getProjectFileIndex } from '@/lib/file-index'
import { isImagePath } from '@/lib/file-classification'
import { useModalA11y } from '@/components/ui/context-menu'

const ROW_HEIGHT = 34
const ROW_OVERSCAN = 8
const VIRTUALIZE_THRESHOLD = 140
const RESULTS_LIST_ID = 'command-palette-results'

function resultOptionId(index: number) {
  return `command-palette-option-${index}`
}

type ActionResult = { type: 'action'; id: string; label: string; keywords: string; icon: typeof Play; run: () => void }
type SearchResult = ActionResult | { type: 'file'; path: string }

export function CommandSearch() {
  const open = useUIStore((s) => s.commandSearchOpen)
  const setOpen = useUIStore((s) => s.setCommandSearchOpen)
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(300)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId),
    [projects, currentProjectId],
  )

  const fileIndex = useMemo(() => getProjectFileIndex(currentProject), [currentProject])

  const actions = useMemo<ActionResult[]>(() => [
    {
      type: 'action', id: 'compile', label: 'Compile document', keywords: 'build render preview', icon: Play,
      run: () => {
        const { source } = useEditorStore.getState()
        const { currentFilePath } = useProjectStore.getState()
        void import('@/lib/compile-manager')
          .then(({ forceCompile }) => forceCompile(source, currentFilePath))
          .catch(() => window.alert('Could not compile the document. Please try again.'))
      },
    },
    {
      type: 'action', id: 'settings', label: 'Open settings', keywords: 'preferences options', icon: Settings,
      run: () => useSettingsStore.getState().setSettingsOpen(true),
    },
    {
      type: 'action', id: 'pdf', label: 'Download PDF', keywords: 'export document', icon: Download,
      run: () => {
        void import('@/lib/pdf-export')
          .then(({ exportCurrentProjectPdf }) => exportCurrentProjectPdf())
          .catch(() => window.alert('Could not load PDF export. Please try again.'))
      },
    },
    {
      type: 'action', id: 'save', label: 'Save project', keywords: 'write persist', icon: Save,
      run: () => {
        const projectStore = useProjectStore.getState()
        if (projectStore.currentFilePath) {
          projectStore.updateFileContent(projectStore.currentFilePath, useEditorStore.getState().source)
        }
        void projectStore.saveCurrentProject()
      },
    },
    {
      type: 'action', id: 'theme', label: 'Cycle theme', keywords: 'appearance light dark system', icon: MoonStar,
      run: () => {
        const settings = useSettingsStore.getState()
        settings.setTheme(settings.theme === 'system' ? 'light' : settings.theme === 'light' ? 'dark' : 'system')
      },
    },
  ], [])

  const filtered = useMemo<SearchResult[]>(() => {
    const lowerQuery = query.toLowerCase()
    const matchingActions = actions.filter((item) =>
      `${item.label} ${item.keywords}`.toLowerCase().includes(lowerQuery),
    )
    const matchingFiles = fileIndex.searchablePathEntries
      .filter((entry) => entry.lowerPath.includes(lowerQuery))
      .map<SearchResult>((entry) => ({ type: 'file', path: entry.path }))
    return [...matchingActions, ...matchingFiles]
  }, [actions, fileIndex, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setSelectedIndex(0)
    setScrollTop(0)
    useEditorStore.getState().editorView?.focus()
  }, [setOpen])

  useModalA11y(panelRef, open, close)

  const openFile = useCallback(
    (path: string) => {
      if (isImagePath(path)) {
        useUIStore.getState().setImagePreviewPath(path)
      } else {
        useProjectStore.getState().selectFile(path)
      }
      close()
    },
    [close],
  )

  const selectResult = useCallback((result: SearchResult) => {
    if (result.type === 'file') {
      openFile(result.path)
      return
    }
    close()
    result.run()
  }, [close, openFile])

  useEffect(() => {
    if (!open) return

    const frameId1 = requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      setScrollTop(0)
    })
    const frameId2 = requestAnimationFrame(() => inputRef.current?.focus())

    return () => {
      cancelAnimationFrame(frameId1)
      cancelAnimationFrame(frameId2)
    }
  }, [open])

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const clampedIndex = filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1)
    const currentTop = clampedIndex * ROW_HEIGHT
    const currentBottom = currentTop + ROW_HEIGHT

    if (currentTop < list.scrollTop) {
      list.scrollTop = currentTop
    } else if (currentBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = currentBottom - list.clientHeight
    }
  }, [selectedIndex, filtered.length])

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const updateViewport = () => setViewportHeight(list.clientHeight)
    updateViewport()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(list)
    return () => observer.disconnect()
  }, [open])

  const effectiveSelectedIndex = filtered.length === 0
    ? 0
    : Math.min(selectedIndex, filtered.length - 1)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((index) => Math.max(index - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const result = filtered[effectiveSelectedIndex]
        if (result) selectResult(result)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    },
    [filtered, effectiveSelectedIndex, selectResult, close],
  )

  const shouldVirtualize = filtered.length > VIRTUALIZE_THRESHOLD
  const totalHeight = filtered.length * ROW_HEIGHT
  const windowStart = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_OVERSCAN)
    : 0
  const windowEnd = shouldVirtualize
    ? Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN)
    : filtered.length
  const visibleRows = filtered.slice(windowStart, windowEnd)

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) close()
      }}
      className="fixed inset-0 z-1000 flex justify-center items-start pt-20 bg-black/60"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="w-(--panel-w) max-w-125 bg-(--bg-elevated) border border-(color:--border-strong) rounded-xs flex flex-col overflow-hidden max-h-(--panel-maxh)"
        style={{
          '--panel-w': 'calc(100% - 48px)',
          '--panel-maxh': 'calc(100vh - 160px)',
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="px-4 py-3 border-b border-b-(color:--border-default)">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={RESULTS_LIST_ID}
            aria-activedescendant={filtered.length > 0
              ? resultOptionId(effectiveSelectedIndex)
              : undefined}
            placeholder="SEARCH FILES AND COMMANDS..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            className="w-full bg-transparent border-none outline-none font-mono fs-14 tracking-(--ls) text-(--text-primary)"
            style={{ '--ls': '0.04em' }}
          />
        </div>

        <div
          id={RESULTS_LIST_ID}
          ref={listRef}
          role="listbox"
          aria-label="Command palette results"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="overflow-y-auto flex-1 relative"
        >
          {filtered.length === 0 ? (
            <div
              className="p-4 font-mono fs-12 text-(--text-tertiary) uppercase tracking-(--ls) text-center"
              style={{ '--ls': '0.04em' }}
            >
              No results found
            </div>
          ) : (
            <div
                className="relative h-(--list-h)"
                style={{ '--list-h': shouldVirtualize ? `${totalHeight}px` : 'auto' }}
              >
              {visibleRows.map((result, rowIndex) => {
                const index = windowStart + rowIndex
                const isSelected = index === effectiveSelectedIndex
                const Icon = result.type === 'action' ? result.icon : File
                return (
                  <div
                    id={resultOptionId(index)}
                    key={result.type === 'action' ? `action:${result.id}` : `file:${result.path}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectResult(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center gap-2.5 px-4 py-2 cursor-pointer border-l-2 border-l-(color:--row-bc) bg-(--row-bg) transition-colors duration-80 h-(--row-h) left-0 right-0 top-(--row-top) ${shouldVirtualize ? 'absolute' : 'relative'}`}
                    style={{
                      '--row-bc': isSelected ? 'var(--accent)' : 'transparent',
                      '--row-bg': isSelected ? 'var(--accent-muted)' : 'transparent',
                      '--row-h': `${ROW_HEIGHT}px`,
                      '--row-top': shouldVirtualize ? `${index * ROW_HEIGHT}px` : 'auto',
                    }}
                  >
                    <Icon
                      size={14}
                      className="shrink-0 text-(--icon-fg)"
                      style={{
                        '--icon-fg': isSelected ? 'var(--accent)' : 'var(--text-tertiary)',
                      }}
                    />
                    <span
                      className="font-mono fs-12 text-(--lbl-fg) tracking-(--ls) truncate"
                      style={{
                        '--lbl-fg': isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        '--ls': '0.02em',
                      }}
                    >
                      {result.type === 'action' ? result.label : result.path}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-t-(color:--border-default) flex items-center gap-4">
          <span className="palette-hint">
            <kbd className="opacity-70">&uarr;&darr;</kbd> NAVIGATE
          </span>
          <span className="palette-hint">
            <kbd className="opacity-70">ENTER</kbd> OPEN
          </span>
          <span className="palette-hint">
            <kbd className="opacity-70">ESC</kbd> CLOSE
          </span>
        </div>
      </div>
    </div>
  )
}
