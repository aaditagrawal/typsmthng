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
  const pendingProjectSyncRef = useRef<{ projectId: string; path: string; source: string } | null>(null)
  const themeReconfigureFrameRef = useRef<number | null>(null)
  const suppressDocChangeEffectsRef = useRef(false)
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  const setCursorPosition = useUIStore((s) => s.setCursorPosition)
  const currentFilePath = useProjectStore((s) => s.currentFilePath)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const vimMode = useSettingsStore((s) => s.vimMode)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const lineWrapping = useSettingsStore((s) => s.lineWrapping)
  const showLineNumbers = useSettingsStore((s) => s.lineNumbers)

  const flushPendingProjectSync = useCallback(() => {
    if (projectSyncTimerRef.current) {
      clearTimeout(projectSyncTimerRef.current)
      projectSyncTimerRef.current = null
    }

    const pending = pendingProjectSyncRef.current
    if (!pending) return

    pendingProjectSyncRef.current = null
    // Target the project id captured at edit time so a later project switch
    // cannot apply this buffer to the wrong document.
    useProjectStore.getState().updateProjectFileContent(
      pending.projectId,
      pending.path,
      pending.source,
    )
  }, [])

  const scheduleProjectSync = useCallback((path: string, source: string, projectId: string) => {
    pendingProjectSyncRef.current = { projectId, path, source }
    if (projectSyncTimerRef.current) {
      clearTimeout(projectSyncTimerRef.current)
    }

    projectSyncTimerRef.current = setTimeout(() => {
      projectSyncTimerRef.current = null
      const pending = pendingProjectSyncRef.current
      if (!pending) return
      pendingProjectSyncRef.current = null
      useProjectStore.getState().updateProjectFileContent(
        pending.projectId,
        pending.path,
        pending.source,
      )
    }, PROJECT_SYNC_DELAY_MS)
  }, [])

  // Initialize editor once
  useEffect(() => {
    if (!editorRef.current) return

    ensureCompilerReady()

    // Get initial content from project store
    const project = useProjectStore.getState().getCurrentProject()
    const filePath = useProjectStore.getState().currentFilePath
    const file = project?.files.find((f) => f.path === filePath)
    const initialDoc = file?.content || SAMPLE_DOCUMENT
    const settings = useSettingsStore.getState()

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
    flushPendingProjectSync()

    const view = viewRef.current
    if (!view || !currentFilePath || !currentProjectId) return

    const project = useProjectStore.getState().getCurrentProject()
    const file = project?.files.find((f) => f.path === currentFilePath)
    if (!file) return

    const currentContent = view.state.doc.toString()
    if (currentContent === file.content) return

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
  }, [currentFilePath, currentProjectId, flushPendingProjectSync])

  // Sync compile diagnostics into editor as underline decorations
  const diagnostics = useCompileStore((s) => s.diagnostics)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Only show diagnostics for the currently open file
    const filePath = useProjectStore.getState().currentFilePath
    const relevant = diagnostics.filter((d) => !d.path || d.path === filePath)

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
