import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'

function isSafari(): boolean {
  const ua = navigator.userAgent
  return /^((?!chrome|android).)*safari/i.test(ua)
}

async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist()
  }
  return false
}

export function SafariBanner() {
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false
    if (!isSafari()) return false
    return !localStorage.getItem('safari-banner-dismissed')
  })

  useEffect(() => {
    if (show) requestPersistentStorage()
  }, [show])

  if (!show) return null

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0"
      style={{
        background: '#FFF3ED',
        color: '#932B00',
        borderBottom: '1px solid #FFE3D1',
      }}
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="flex-1">
        Safari may clear stored data after 7 days of inactivity. Download your work regularly to avoid data loss.
      </span>
      <button
        onClick={() => {
          setShow(false)
          localStorage.setItem('safari-banner-dismissed', '1')
        }}
        className="shrink-0 p-0.5 rounded hover:bg-[#FFE3D1] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
