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
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-primary)',
        maxWidth: '360px',
      }}
    >
      <span className="text-xs flex-1">New version available</span>
      <button
        onClick={handleUpdate}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <RefreshCw size={12} />
        Refresh
      </button>
      <button
        onClick={() => setShow(false)}
        className="p-0.5 rounded"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="Dismiss update"
      >
        <X size={14} />
      </button>
    </div>
  )
}
