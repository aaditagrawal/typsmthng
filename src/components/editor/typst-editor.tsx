import { useEffect, useRef, useCallback } from 'react'
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap } from '@codemirror/view'
import { EditorState, Compartment, Transaction } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { typst } from 'codemirror-lang-typst'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { useUIStore } from '@/stores/ui-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import { SAMPLE_DOCUMENT } from '@/lib/sample-document'
import { createEditorTheme } from './theme'
import { requestCompile, forceCompile, ensureCompilerReady } from '@/lib/compile-manager'
import { typstKeymap } from '@/lib/keybindings'
import { sourceHighlightField } from '@/lib/editor-highlight'
import { diagnosticField, setDiagnostics } from '@/lib/editor-diagnostics'
import { useCompileStore } from '@/stores/compile-store'

// Compartments for live reconfiguration
const themeCompartment = new Compartment()
const vimCompartment = new Compartment()
const lineNumbersCompartment = new Compartment()
const lineWrappingCompartment = new Compartment()
const fontSizeCompartment = new Compartment()
const PROJECT_SYNC_DELAY_MS = 800
let vimWriteCommandRegistered = false

function fontSizeExtension(fontSize: number) {
  return EditorView.theme({
    '&': { fontSize: `${fontSize}px` },
  })
}

// Per-file cursor/scroll state, keyed by `${projectId}\n${path}` so equal
// paths in different projects never collide. Module-level so positions
// survive editor remounts (e.g. leaving the workspace and coming back).
interface SavedViewState {
  anchor: number
  head: number
  scrollTop: number
}
const savedViewStates = new Map<string, SavedViewState>()

function viewStateKey(projectId: string, path: string): string {
  return `${projectId}\n${path}`
}

/** Copy CodeMirror's authoritative buffer into the project before persistence. */
function saveLiveEditorBuffer(view: EditorView | null) {
  if (!view) return
  const projectStore = useProjectStore.getState()
  const path = projectStore.currentFilePath
  if (path) {
    projectStore.updateFileContent(path, view.state.doc.toString())
  }
  void projectStore.saveCurrentProject()
}

export function TypstEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const projectSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProjectSyncRef = useRef<{
    projectId: string
    path: string
    source: string
    // Stored content of the file when this pending run began, used to
    // re-identify the document if its path is renamed before the flush.
    baseContent: string | null
  } | null>(null)
  const themeReconfigureFrameRef = useRef<number | null>(null)
  const suppressDocChangeEffectsRef = useRef(false)
  const displayedFileRef = useRef<{ projectId: string; path: string } | null>(null)
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  const setCursorPosition = useUIStore((s) => s.setCursorPosition)
  const currentFilePath = useProjectStore((s) => s.currentFilePath)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const vimMode = useSettingsStore((s) => s.vimMode)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const lineWrapping = useSettingsStore((s) => s.lineWrapping)
  const showLineNumbers = useSettingsStore((s) => s.lineNumbers)

  const deliverPendingProjectSync = useCallback(() => {
    const pending = pendingProjectSyncRef.current
    if (!pending) return
    pendingProjectSyncRef.current = null

    // Target the project id captured at edit time so a later project switch
    // cannot apply this buffer to the wrong document.
    const projectStore = useProjectStore.getState()
    const project = projectStore.projects.find((p) => p.id === pending.projectId)
    if (project && !project.files.some((f) => f.path === pending.path)) {
      // The captured path vanished mid-sync — typically the file (or an
      // ancestor folder) was renamed. If the now-current file still holds
      // the content this buffer grew from, it is the same document under a
      // new path; write there instead of silently dropping the edits.
      const currentPath = projectStore.currentFilePath
      const currentFile =
        currentPath && projectStore.currentProjectId === pending.projectId
          ? project.files.find((f) => f.path === currentPath && !f.isBinary)
          : undefined
      if (
        currentFile &&
        pending.baseContent !== null &&
        currentFile.content === pending.baseContent &&
        currentFile.content !== pending.source
      ) {
        projectStore.updateProjectFileContent(pending.projectId, currentFile.path, pending.source)
      }
      return
    }

    projectStore.updateProjectFileContent(
      pending.projectId,
      pending.path,
      pending.source,
    )
  }, [])

  const flushPendingProjectSync = useCallback(() => {
    if (projectSyncTimerRef.current) {
      clearTimeout(projectSyncTimerRef.current)
      projectSyncTimerRef.current = null
    }
    deliverPendingProjectSync()
  }, [deliverPendingProjectSync])

  const scheduleProjectSync = useCallback((path: string, source: string, projectId: string) => {
    const previous = pendingProjectSyncRef.current
    let baseContent: string | null
    if (previous && previous.projectId === projectId && previous.path === path) {
      baseContent = previous.baseContent
    } else {
      const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
      const file = project?.files.find((f) => f.path === path && !f.isBinary)
      baseContent = file ? file.content : null
    }
    pendingProjectSyncRef.current = { projectId, path, source, baseContent }
    if (projectSyncTimerRef.current) {
      clearTimeout(projectSyncTimerRef.current)
    }

    projectSyncTimerRef.current = setTimeout(() => {
      projectSyncTimerRef.current = null
      deliverPendingProjectSync()
    }, PROJECT_SYNC_DELAY_MS)
  }, [deliverPendingProjectSync])

  // Initialize editor once
  useEffect(() => {
    if (!editorRef.current) return

    ensureCompilerReady()

    // Get initial content from project store
    const project = useProjectStore.getState().getCurrentProject()
    const filePath = useProjectStore.getState().currentFilePath
    const file = project?.files.find((f) => f.path === filePath)
    // An existing-but-empty file must open empty, not show the sample doc.
    const initialDoc = file ? file.content : SAMPLE_DOCUMENT
    const settings = useSettingsStore.getState()
    displayedFileRef.current = project && filePath ? { projectId: project.id, path: filePath } : null

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbersCompartment.of(settings.lineNumbers ? lineNumbers() : []),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        lineWrappingCompartment.of(settings.lineWrapping ? EditorView.lineWrapping : []),
        fontSizeCompartment.of(fontSizeExtension(settings.fontSize)),
        typst(),
        indentationMarkers({
          hideFirstIndent: false,
          colors: {
            light: 'rgba(0, 0, 0, 0.1)',
            dark: 'rgba(255, 255, 255, 0.1)',
            activeLight: 'rgba(0, 0, 0, 0.18)',
            activeDark: 'rgba(255, 255, 255, 0.18)',
          },
          thickness: 1,
        }),
        // Vim is loaded on demand so workspace boot skips ~193KB when disabled.
        vimCompartment.of([]),
        themeCompartment.of(createEditorTheme(useUIStore.getState().resolvedTheme)),
        sourceHighlightField,
        diagnosticField,
        keymap.of([
          indentWithTab,
          ...typstKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const pos = update.view.state.selection.main.head
            const line = update.view.state.doc.lineAt(pos)
            useUIStore.getState().setCursorPosition(line.number, pos - line.from + 1)
          }
          if (update.docChanged) {
            const source = update.state.doc.toString()

            // Programmatic document swaps (file navigation) should not mark dirty
            // or enqueue extra compile/sync work.
            if (suppressDocChangeEffectsRef.current) {
              suppressDocChangeEffectsRef.current = false
              useEditorStore.setState({ source, isDirty: false, saveStatus: 'saved' })
              return
            }

            // Update editor store
            useEditorStore.getState().setSource(source)
            // Sync back to project store
            const { currentFilePath: path, currentProjectId: projectId } = useProjectStore.getState()
            if (path && projectId) {
              scheduleProjectSync(path, source, projectId)
            }
            requestCompile(source, path)
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: editorRef.current })
    viewRef.current = view
    useEditorStore.getState().setEditorView(view)

    // Restore the last cursor/scroll position for the initial file, if any.
    const displayed = displayedFileRef.current
    const savedState = displayed
      ? savedViewStates.get(viewStateKey(displayed.projectId, displayed.path))
      : undefined
    if (savedState) {
      const docLength = view.state.doc.length
      view.dispatch({
        selection: {
          anchor: Math.min(savedState.anchor, docLength),
          head: Math.min(savedState.head, docLength),
        },
      })
      view.scrollDOM.scrollTop = savedState.scrollTop
    }

    // Set initial cursor position
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    setCursorPosition(line.number, pos - line.from + 1)

    // Set initial source and trigger compile
    const src = view.state.doc.toString()
    useEditorStore.setState({ source: src, isDirty: false, saveStatus: 'saved' })
    forceCompile(src, filePath)

    if (settings.vimMode) {
      void import('@replit/codemirror-vim').then(({ Vim, vim }) => {
        if (viewRef.current !== view || !useSettingsStore.getState().vimMode) return
        if (!vimWriteCommandRegistered) {
          Vim.defineEx('write', 'w', () => {
            saveLiveEditorBuffer(useEditorStore.getState().editorView)
          })
          vimWriteCommandRegistered = true
        }
        view.dispatch({ effects: vimCompartment.reconfigure(vim()) })
      })
    }

    return () => {
      if (themeReconfigureFrameRef.current !== null) {
        cancelAnimationFrame(themeReconfigureFrameRef.current)
        themeReconfigureFrameRef.current = null
      }
      flushPendingProjectSync()
      const departing = displayedFileRef.current
      if (viewRef.current && departing) {
        savedViewStates.set(viewStateKey(departing.projectId, departing.path), {
          anchor: viewRef.current.state.selection.main.anchor,
          head: viewRef.current.state.selection.main.head,
          scrollTop: viewRef.current.scrollDOM.scrollTop,
        })
      }
      viewRef.current?.destroy()
      viewRef.current = null
      useEditorStore.getState().setEditorView(null)
    }
  }, [flushPendingProjectSync, scheduleProjectSync, setCursorPosition])

  // React to theme changes — reconfigure CodeMirror
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (themeReconfigureFrameRef.current !== null) {
      cancelAnimationFrame(themeReconfigureFrameRef.current)
    }

    themeReconfigureFrameRef.current = requestAnimationFrame(() => {
      themeReconfigureFrameRef.current = null
      if (viewRef.current !== view) return
      view.dispatch({
        effects: themeCompartment.reconfigure(createEditorTheme(resolvedTheme)),
      })
    })

    return () => {
      if (themeReconfigureFrameRef.current !== null) {
        cancelAnimationFrame(themeReconfigureFrameRef.current)
        themeReconfigureFrameRef.current = null
      }
    }
  }, [resolvedTheme])

  // React to vim mode changes — load the vim chunk only when enabled.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (!vimMode) {
      view.dispatch({ effects: vimCompartment.reconfigure([]) })
      return
    }

    let cancelled = false
    void import('@replit/codemirror-vim').then(({ Vim, vim }) => {
      if (cancelled || viewRef.current !== view || !useSettingsStore.getState().vimMode) return
      if (!vimWriteCommandRegistered) {
        Vim.defineEx('write', 'w', () => {
          saveLiveEditorBuffer(useEditorStore.getState().editorView)
        })
        vimWriteCommandRegistered = true
      }
      view.dispatch({ effects: vimCompartment.reconfigure(vim()) })
    })
    return () => {
      cancelled = true
    }
  }, [vimMode])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: lineNumbersCompartment.reconfigure(showLineNumbers ? lineNumbers() : []),
    })
  }, [showLineNumbers])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: lineWrappingCompartment.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
    })
  }, [lineWrapping])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(fontSizeExtension(fontSize)),
    })
  }, [fontSize])

  // React to file/project changes — swap document content
  useEffect(() => {
    // Persist pending edits from the previous file before changing documents.
    // deliverPendingProjectSync redirects the write to the current path when
    // the captured one was renamed away, so this cannot drop typed content.
    flushPendingProjectSync()

    const view = viewRef.current
    if (!view || !currentFilePath || !currentProjectId) return

    const displayed = displayedFileRef.current
    const displayedKey = displayed ? viewStateKey(displayed.projectId, displayed.path) : null
    const nextKey = viewStateKey(currentProjectId, currentFilePath)
    const switchingFile = displayedKey !== nextKey

    // Remember cursor/scroll for the file we are leaving.
    if (displayedKey && switchingFile) {
      savedViewStates.set(displayedKey, {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      })
    }

    const project = useProjectStore.getState().getCurrentProject()
    const file = project?.files.find((f) => f.path === currentFilePath)
    if (!file) return

    displayedFileRef.current = { projectId: currentProjectId, path: currentFilePath }

    const currentContent = view.state.doc.toString()
    if (currentContent !== file.content) {
      // Replace entire document content without polluting undo history.
      suppressDocChangeEffectsRef.current = true
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: file.content,
        },
        annotations: [Transaction.addToHistory.of(false)],
      })

      forceCompile(file.content, currentFilePath)
    }

    // Restore this file's last cursor/scroll position, clamped to the doc.
    if (switchingFile) {
      const saved = savedViewStates.get(nextKey)
      if (saved) {
        const docLength = view.state.doc.length
        view.dispatch({
          selection: {
            anchor: Math.min(saved.anchor, docLength),
            head: Math.min(saved.head, docLength),
          },
        })
        view.scrollDOM.scrollTop = saved.scrollTop
      }
    }
  }, [currentFilePath, currentProjectId, flushPendingProjectSync])

  // Sync compile diagnostics into editor as underline decorations
  const diagnostics = useCompileStore((s) => s.diagnostics)
  const lastDiagnosticsEmptyRef = useRef(true)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Only show diagnostics for the currently open file
    const filePath = useProjectStore.getState().currentFilePath
    const relevant = diagnostics.filter((d) => !d.path || d.path === filePath)

    // Skip the transaction when there is nothing to clear — clean compiles
    // would otherwise dispatch on every keystroke's compile cycle.
    if (relevant.length === 0 && lastDiagnosticsEmptyRef.current) return
    lastDiagnosticsEmptyRef.current = relevant.length === 0

    view.dispatch({
      effects: setDiagnostics.of(relevant),
    })
  }, [diagnostics])

  // Persist CodeMirror's current buffer immediately when the page is leaving.
  useEffect(() => {
    const saveBeforeLeaving = () => {
      flushPendingProjectSync()
      saveLiveEditorBuffer(viewRef.current)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        saveBeforeLeaving()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', saveBeforeLeaving)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', saveBeforeLeaving)
    }
  }, [flushPendingProjectSync])

  return (
    <div
      ref={editorRef}
      className="h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-surface)' }}
    />
  )
}
