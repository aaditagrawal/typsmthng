import { useEffect, useRef, useCallback } from 'react'
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { typst } from 'codemirror-lang-typst'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { vim } from '@replit/codemirror-vim'
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
const PROJECT_SYNC_DELAY_MS = 800

export function TypstEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const projectSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProjectSyncRef = useRef<{ path: string; source: string } | null>(null)
  const themeReconfigureFrameRef = useRef<number | null>(null)
  const suppressDocChangeEffectsRef = useRef(false)
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  const setCursorPosition = useUIStore((s) => s.setCursorPosition)
  const currentFilePath = useProjectStore((s) => s.currentFilePath)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const vimMode = useSettingsStore((s) => s.vimMode)

  const flushPendingProjectSync = useCallback(() => {
    if (projectSyncTimerRef.current) {
      clearTimeout(projectSyncTimerRef.current)
      projectSyncTimerRef.current = null
    }

    const pending = pendingProjectSyncRef.current
    if (!pending) return

    pendingProjectSyncRef.current = null
    useProjectStore.getState().updateFileContent(pending.path, pending.source)
  }, [])

  const scheduleProjectSync = useCallback((path: string, source: string) => {
    pendingProjectSyncRef.current = { path, source }
    if (projectSyncTimerRef.current) {
      clearTimeout(projectSyncTimerRef.current)
    }

    projectSyncTimerRef.current = setTimeout(() => {
      projectSyncTimerRef.current = null
      const pending = pendingProjectSyncRef.current
      if (!pending) return
      pendingProjectSyncRef.current = null
      useProjectStore.getState().updateFileContent(pending.path, pending.source)
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

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
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
        vimCompartment.of(useSettingsStore.getState().vimMode ? vim() : []),
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
            const path = useProjectStore.getState().currentFilePath
            if (path) {
              scheduleProjectSync(path, source)
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

  // React to vim mode changes — reconfigure CodeMirror
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: vimCompartment.reconfigure(vimMode ? vim() : []),
    })
  }, [vimMode])

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

    // Replace entire document content
    suppressDocChangeEffectsRef.current = true
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: file.content,
      },
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

  // Flush pending project sync if the tab/window is hidden.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        flushPendingProjectSync()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [flushPendingProjectSync])

  return (
    <div
      ref={editorRef}
      className="h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-surface)' }}
    />
  )
}
