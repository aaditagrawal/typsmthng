import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
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
  const [storageStatus, setStorageStatus] = useState<'idle' | 'granted' | 'denied'>('idle')

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    localStorage.setItem('safari-banner-dismissed', '1')
  }

  const handleAllowStorage = () => {
    void requestPersistentStorage()
      .then((granted) => {
        if (granted) {
          setStorageStatus('granted')
          localStorage.setItem('safari-banner-dismissed', '1')
          setTimeout(() => setShow(false), 2000)
        } else {
          setStorageStatus('denied')
        }
      })
      .catch(() => setStorageStatus('denied'))
  }

  const message = storageStatus === 'granted'
    ? 'Storage protected. Safari will keep your data.'
    : storageStatus === 'denied'
      ? 'Request denied — download backups regularly to avoid data loss.'
      : 'Safari may clear stored data after 7 days of inactivity. Download your work regularly to avoid data loss.'

  return (
    <div
      {...stylex.props(styles.element1)}
      style={{
        background: '#FFF3ED',
        color: '#932B00',
        borderBottom: '1px solid #FFE3D1',
      }}
    >
      <AlertTriangle size={14} {...stylex.props(styles.element2)} />
      <span {...stylex.props(styles.element3)}>{message}</span>
      {storageStatus === 'idle' && (
        <button
          type="button"
          onClick={handleAllowStorage}
          {...stylex.props(styles.element4)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            border: '1px solid #FFD0B5',
          }}
        >
          Allow storage
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        {...stylex.props(styles.element5)}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

const styles = stylex.create({
  "element1": {
    "display": "flex",
    "flexShrink": 0,
    "alignItems": "center",
    "gap": "calc(var(--spacing) * 2)",
    "paddingInline": "calc(var(--spacing) * 3)",
    "paddingBlock": "calc(var(--spacing) * 1.5)",
    "fontSize": "var(--text-xs)",
    "lineHeight": "var(--tw-leading, var(--text-xs--line-height))"
  },
  "element2": {
    "flexShrink": 0
  },
  "element3": {
    "flex": "1"
  },
  "element4": {
    "flexShrink": 0,
    "borderRadius": ".25rem",
    "paddingInline": "calc(var(--spacing) * 2)",
    "paddingBlock": "calc(var(--spacing) * .5)",
    "transitionProperty": "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to",
    "transitionTimingFunction": "var(--tw-ease, var(--default-transition-timing-function))",
    "transitionDuration": "var(--tw-duration, var(--default-transition-duration))",
    "backgroundColor": {
      "default": null,
      "@media (hover: hover)": {
        ":hover": "#ffe3d1"
      }
    }
  },
  "element5": {
    "flexShrink": 0,
    "borderRadius": ".25rem",
    "padding": "calc(var(--spacing) * .5)",
    "transitionProperty": "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to",
    "transitionTimingFunction": "var(--tw-ease, var(--default-transition-timing-function))",
    "transitionDuration": "var(--tw-duration, var(--default-transition-duration))",
    "backgroundColor": {
      "default": null,
      "@media (hover: hover)": {
        ":hover": "#ffe3d1"
      }
    }
  }
})
