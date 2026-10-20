import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { useProjectStore } from '@/stores/project-store'
import { useCompileStore } from '@/stores/compile-store'
import { getAiConfig } from '@/stores/ai-store'
import { registerAiInlineTrigger, unregisterAiInlineTrigger } from '@/lib/ai/inline-trigger'
import { streamCompletion, AiRequestError } from '@/lib/ai/provider'
import { buildSystemPrompt, buildEditPrompt, stripCodeFences } from '@/lib/ai/prompts'

const PANEL_WIDTH = 420
const PANEL_EST_HEIGHT = 260
const VIEWPORT_MARGIN = 8

type PanelStatus = 'input' | 'streaming' | 'done' | 'error'

interface Anchor {
  from: number
  to: number
  /** Selected text at open time ('' for insert-at-cursor). */
  text: string
  /** Doc length at open time, used to validate insertion points. */
  docLength: number
}

function clampPosition(left: number, top: number): { left: number; top: number } {
  return {
    left: Math.min(Math.max(VIEWPORT_MARGIN, left), Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)),
    top: Math.min(Math.max(VIEWPORT_MARGIN, top), Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_EST_HEIGHT - VIEWPORT_MARGIN)),
  }
}

export function AiInlinePanel() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<PanelStatus>('input')
  const [instruction, setInstruction] = useState('')
  const [output, setOutput] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [isInsertion, setIsInsertion] = useState(false)

  const viewRef = useRef<EditorView | null>(null)
  const anchorRef = useRef<Anchor | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<PanelStatus>('input')

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const closePanel = useCallback((focusEditor: boolean) => {
    abortRef.current?.abort()
    abortRef.current = null
    setOpen(false)
    setStatus('input')
    setInstruction('')
    setOutput('')
    setResult('')
    setError(null)
    const view = viewRef.current
    anchorRef.current = null
    if (focusEditor && view) view.focus()
  }, [])

  const openPanel = useCallback((view: EditorView) => {
    viewRef.current = view
    if (statusRef.current === 'streaming') {
      // A request is in flight; just refocus the panel instead of re-anchoring.
      inputRef.current?.focus()
      return
    }
    const sel = view.state.selection.main
    anchorRef.current = {
      from: sel.from,
      to: sel.to,
      text: view.state.doc.sliceString(sel.from, sel.to),
      docLength: view.state.doc.length,
    }
    setIsInsertion(sel.from === sel.to)
    const coords = view.coordsAtPos(sel.head)
    const fallback = view.dom.getBoundingClientRect()
    setPosition(clampPosition(
      coords ? coords.left : fallback.left + 24,
      coords ? coords.bottom + 8 : fallback.top + 48,
    ))
    setStatus('input')
    setOutput('')
    setResult('')
    setError(null)
    setOpen(true)
  }, [])

  // Expose the open handler to the Mod-i keybinding in lib/keybindings.ts.
  useEffect(() => {
    const handler = (view: EditorView) => {
      openPanel(view)
      return true
    }
    registerAiInlineTrigger(handler)
    return () => unregisterAiInlineTrigger(handler)
  }, [openPanel])

  // Focus the instruction input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the streamed preview scrolled to the latest text.
  useEffect(() => {
    const el = previewRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  // Close on editor scroll while idle so the panel does not drift from its anchor.
  useEffect(() => {
    if (!open || status !== 'input') return
    const view = viewRef.current
    if (!view) return
    const onScroll = () => closePanel(false)
    view.scrollDOM.addEventListener('scroll', onScroll)
    return () => view.scrollDOM.removeEventListener('scroll', onScroll)
  }, [open, status, closePanel])

  const submit = useCallback(() => {
    const view = viewRef.current
    const anchor = anchorRef.current
    const trimmed = instruction.trim()
    if (!view || !anchor || !trimmed || statusRef.current === 'streaming') return

    const doc = view.state.doc
    if (anchor.to > doc.length) {
      setStatus('error')
      setError('The document changed — close the panel and try again.')
      return
    }

    const project = useProjectStore.getState().getCurrentProject()
    const filePath = useProjectStore.getState().currentFilePath
    const diagnostics = useCompileStore.getState().diagnostics
      .filter((d) => !d.path || d.path === filePath)
      .map((d) => ({ message: d.message, range: d.range }))

    const userPrompt = buildEditPrompt({
      filePath,
      instruction: trimmed,
      selection: anchor.text,
      before: doc.sliceString(0, anchor.from),
      after: doc.sliceString(anchor.to),
      filePaths: project?.files.map((f) => f.path) ?? [],
      diagnostics,
    })

    const config = getAiConfig()
    if (!config.baseUrl.trim() || !config.model.trim()) {
      setStatus('error')
      setError('Configure the AI base URL and model in Settings first.')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setStatus('streaming')
    setOutput('')
    setResult('')
    setError(null)

    streamCompletion({
      config,
      system: buildSystemPrompt(),
      userPrompt,
      signal: controller.signal,
      onDelta: (text) => setOutput((prev) => prev + text),
    })
      .then((full) => {
        if (controller.signal.aborted) return
        abortRef.current = null
        const cleaned = stripCodeFences(full)
        if (cleaned.length === 0) {
          setStatus('error')
          setError('The model returned an empty result.')
          return
        }
        setResult(cleaned)
        setOutput(cleaned)
        setStatus('done')
      })
      .catch((err: unknown) => {
        abortRef.current = null
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User cancelled — back to the input state, keep the instruction.
          setStatus('input')
          setOutput('')
          return
        }
        setStatus('error')
        if (err instanceof AiRequestError) {
          setError(err.message)
        } else {
          setError(err instanceof Error ? err.message : 'Request failed.')
        }
      })
  }, [instruction])

  const accept = useCallback(() => {
    const view = viewRef.current
    const anchor = anchorRef.current
    if (!view || !anchor || statusRef.current !== 'done' || !result) return

    const doc = view.state.doc
    const rangeIntact =
      anchor.to <= doc.length
      && doc.sliceString(anchor.from, anchor.to) === anchor.text
      // For pure insertions there is no selection text to verify, so require
      // the document to be unchanged in length.
      && (anchor.text.length > 0 || doc.length === anchor.docLength)

    if (!rangeIntact) {
      setStatus('error')
      setError('The document changed while editing — the result was not applied.')
      return
    }

    view.dispatch({
      changes: { from: anchor.from, to: anchor.to, insert: result },
      selection: { anchor: anchor.from + result.length },
      scrollIntoView: true,
    })
    closePanel(true)
  }, [result, closePanel])

  const cancel = useCallback(() => {
    if (statusRef.current === 'streaming') {
      abortRef.current?.abort()
      abortRef.current = null
      return
    }
    closePanel(true)
  }, [closePanel])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if ((e.metaKey || e.ctrlKey) && statusRef.current === 'done') {
        accept()
        return
      }
      submit()
    }
  }, [accept, cancel, submit])

  if (!open) return null

  const busy = status === 'streaming'
  const preview = status === 'done' ? result : output

  return (
    <div
      role="dialog"
      aria-label="AI edit"
      onKeyDown={handleKeyDown}
      className="ai-panel"
      style={{
        '--panel-l': `${position.left}px`,
        '--panel-t': `${position.top}px`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="ai-label">AI Edit — {isInsertion ? 'Insert at cursor' : 'Replace selection'}</span>
        {busy && <span className="ai-label" style={{ '--lbl-fg': 'var(--accent)' }}>Streaming…</span>}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        aria-label="AI edit instruction"
        placeholder={isInsertion ? 'e.g. continue writing this section' : 'e.g. convert this to a table'}
        disabled={busy}
        className="font-mono fs-12 py-1.5 px-2 bg-(--bg-inset) border border-(color:--border-default) rounded-xs text-(--text-primary) outline-none w-full box-border opacity-(--op)"
        style={{ '--op': busy ? '0.6' : '1' }}
      />

      {preview.length > 0 && (
        <div
          ref={previewRef}
          className="font-mono fs-11 leading-(--lh) whitespace-pre-wrap wrap-break-word max-h-45 overflow-y-auto py-1.5 px-2 bg-(--bg-inset) border border-(color:--border-subtle) rounded-xs text-(--text-primary)"
          style={{ '--lh': '1.5' }}
        >
          {preview}
        </div>
      )}

      {status === 'error' && error && (
        <div
          className="font-mono fs-11 leading-(--lh) text-(--status-error) wrap-break-word"
          style={{ '--lh': '1.4' }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5 justify-end">
        {status === 'done' ? (
          <>
            <button type="button" onClick={() => closePanel(true)} className="ai-btn">
              Reject · Esc
            </button>
            <button
              type="button"
              onClick={accept}
              className="ai-btn"
              style={{
                '--ab-bg': 'var(--accent)',
                '--ab-fg': 'var(--accent-text)',
                '--ab-bc': 'var(--accent)',
              }}
            >
              Accept · ⌘↵
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={cancel} className="ai-btn">
              {busy ? 'Stop · Esc' : 'Cancel · Esc'}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || instruction.trim().length === 0}
              className="ai-btn"
              style={{
                '--ab-bg': busy || instruction.trim().length === 0 ? 'var(--bg-inset)' : 'var(--accent)',
                '--ab-fg': busy || instruction.trim().length === 0 ? 'var(--text-disabled)' : 'var(--accent-text)',
                '--ab-bc': busy || instruction.trim().length === 0 ? 'var(--border-default)' : 'var(--accent)',
                '--ab-cur': busy || instruction.trim().length === 0 ? 'default' : 'pointer',
              }}
            >
              {status === 'error' ? 'Retry · ↵' : 'Generate · ↵'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
