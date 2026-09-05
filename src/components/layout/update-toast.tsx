import * as stylex from '@stylexjs/stylex'
import { useState, useEffect, useCallback, useRef } from 'react'
import { X, RefreshCw } from 'lucide-react'

type UpdateDetail = { update: () => void }

export function UpdateToast() {
  const [show, setShow] = useState(false)
  const updateRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UpdateDetail>).detail
      if (typeof detail?.update !== 'function') return
      updateRef.current = detail.update
      setShow(true)
    }
    window.addEventListener('sw-update-available', handler)
    return () => window.removeEventListener('sw-update-available', handler)
  }, [])

  const handleUpdate = useCallback(() => {
    updateRef.current?.()
    setShow(false)
  }, [])

  if (!show) return null

  return (
    <div
      role="status"
      {...stylex.props(styles.element1)}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-primary)',
        maxWidth: '360px',
      }}
    >
      <span {...stylex.props(styles.element2)}>New version available</span>
      <button
        onClick={handleUpdate}
        {...stylex.props(styles.element3)}
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <RefreshCw size={12} />
        Refresh
      </button>
      <button
        onClick={() => setShow(false)}
        {...stylex.props(styles.element4)}
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="Dismiss update"
      >
        <X size={14} />
      </button>
    </div>
  )
}

const styles = stylex.create({
  "element1": {
    "position": "fixed",
    "right": "calc(var(--spacing) * 4)",
    "bottom": "calc(var(--spacing) * 4)",
    "zIndex": 50,
    "display": "flex",
    "alignItems": "center",
    "gap": "calc(var(--spacing) * 3)",
    "borderRadius": "var(--radius-lg)",
    "paddingInline": "calc(var(--spacing) * 4)",
    "paddingBlock": "calc(var(--spacing) * 3)",
    "--tw-shadow": "0 10px 15px -3px var(--tw-shadow-color, #0000001a), 0 4px 6px -4px var(--tw-shadow-color, #0000001a)",
    "boxShadow": "var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)"
  },
  "element2": {
    "flex": "1",
    "fontSize": "var(--text-xs)",
    "lineHeight": "var(--tw-leading, var(--text-xs--line-height))"
  },
  "element3": {
    "display": "flex",
    "alignItems": "center",
    "gap": "calc(var(--spacing) * 1.5)",
    "borderRadius": ".25rem",
    "paddingInline": "calc(var(--spacing) * 2.5)",
    "paddingBlock": "calc(var(--spacing) * 1)",
    "fontSize": "var(--text-xs)",
    "lineHeight": "var(--tw-leading, var(--text-xs--line-height))",
    "--tw-font-weight": "var(--font-weight-medium)",
    "fontWeight": "var(--font-weight-medium)"
  },
  "element4": {
    "borderRadius": ".25rem",
    "padding": "calc(var(--spacing) * .5)"
  }
})
