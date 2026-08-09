import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { File } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useProjectStore } from '@/stores/project-store'
import { getProjectFileIndex } from '@/lib/file-index'
import { isImagePath } from '@/lib/file-classification'

const ROW_HEIGHT = 34
const ROW_OVERSCAN = 8
const VIRTUALIZE_THRESHOLD = 140

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
  const listRef = useRef<HTMLDivElement>(null)

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId),
    [projects, currentProjectId],
  )

  const fileIndex = useMemo(() => getProjectFileIndex(currentProject), [currentProject])

  const filtered = useMemo(() => {
    if (!query) return fileIndex.searchablePaths
    const lowerQuery = query.toLowerCase()
    return fileIndex.searchablePathEntries
      .filter((entry) => entry.lowerPath.includes(lowerQuery))
      .map((entry) => entry.path)
  }, [fileIndex, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setSelectedIndex(0)
    setScrollTop(0)
  }, [setOpen])

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
        const path = filtered[effectiveSelectedIndex]
        if (path) openFile(path)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    },
    [filtered, effectiveSelectedIndex, openFile, close],
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '80px',
        background: 'rgba(0, 0, 0, 0.6)',
      }}
    >
      <div
        style={{
          width: 'calc(100% - 48px)',
          maxWidth: '500px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: '2px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 160px)',
        }}
        onKeyDown={handleKeyDown}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="SEARCH FILES..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '14px',
              letterSpacing: '0.04em',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <div
          ref={listRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          style={{
            overflowY: 'auto',
            flex: 1,
            position: 'relative',
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '16px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                textAlign: 'center',
              }}
            >
              No files found
            </div>
          ) : (
            <div style={{ height: shouldVirtualize ? `${totalHeight}px` : 'auto', position: 'relative' }}>
              {visibleRows.map((path, rowIndex) => {
                const index = windowStart + rowIndex
                const isSelected = index === effectiveSelectedIndex
                return (
                  <div
                    key={path}
                    onClick={() => openFile(path)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                      background: isSelected ? 'var(--accent-muted)' : 'transparent',
                      transition: 'background 80ms ease',
                      height: `${ROW_HEIGHT}px`,
                      position: shouldVirtualize ? 'absolute' : 'relative',
                      left: 0,
                      right: 0,
                      top: shouldVirtualize ? `${index * ROW_HEIGHT}px` : undefined,
                    }}
                  >
                    <File
                      size={14}
                      style={{
                        flexShrink: 0,
                        color: isSelected ? 'var(--accent)' : 'var(--text-tertiary)',
                      }}
                    />
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        letterSpacing: '0.02em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {path}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.02em',
            }}
          >
            <kbd style={{ opacity: 0.7 }}>&uarr;&darr;</kbd> NAVIGATE
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.02em',
            }}
          >
            <kbd style={{ opacity: 0.7 }}>ENTER</kbd> OPEN
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.02em',
            }}
          >
            <kbd style={{ opacity: 0.7 }}>ESC</kbd> CLOSE
          </span>
        </div>
      </div>
    </div>
  )
}
