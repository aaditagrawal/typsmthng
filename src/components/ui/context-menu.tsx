import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export interface ContextMenuAction {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  children?: ContextMenuAction[]
}

function ContextMenuPanel({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}) {
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number } | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const left = Math.max(8, Math.min(x, window.innerWidth - 188))
  const top = Math.max(8, Math.min(y, window.innerHeight - (actions.length * 32 + 16)))
  const estimatedWidth = 232

  return (
    <div
      onMouseLeave={() => {
        setOpenSubmenuIndex(null)
        setSubmenuPosition(null)
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{ position: 'relative' }}
    >
      <div
        className="fixed z-50 min-w-[220px]"
        style={{
          left,
          top,
          background: 'var(--bg-elevated)',
          border: 'none',
          borderRadius: '2px',
          fontFamily: 'var(--font-mono)',
          boxShadow: '0 10px 24px rgba(0, 0, 0, 0.22)',
          padding: '6px',
        }}
      >
        {actions.map((action, index) => (
          <div key={`${action.label}-${index}`}>
            {index > 0 && (
              <div
                style={{
                  height: '1px',
                  background: 'color-mix(in srgb, var(--text-tertiary) 30%, transparent)',
                  margin: '4px 0 4px 12px',
                }}
              />
            )}
            <button
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              type="button"
              disabled={action.disabled}
              className="flex items-center gap-3 w-full px-4 py-2"
              style={{
                color: action.disabled
                  ? 'var(--text-tertiary)'
                  : action.danger
                    ? 'var(--status-error)'
                    : 'var(--text-secondary)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: action.disabled ? 'not-allowed' : 'pointer',
                opacity: action.disabled ? 0.5 : 1,
                textAlign: 'left',
                background: openSubmenuIndex === index ? 'var(--bg-hover)' : 'transparent',
              }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onMouseEnter={(event) => {
                if (action.disabled) return
                if (action.children?.length) {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const preferredLeft = rect.right - 2
                  const resolvedLeft = preferredLeft + estimatedWidth <= window.innerWidth - 8
                    ? preferredLeft
                    : rect.left - estimatedWidth + 2

                  setOpenSubmenuIndex(index)
                  setSubmenuPosition({
                    x: resolvedLeft,
                    y: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 80)),
                  })
                } else {
                  setOpenSubmenuIndex(null)
                  setSubmenuPosition(null)
                }
                event.currentTarget.style.background = 'var(--bg-hover)'
                if (!action.danger) event.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(event) => {
                if (openSubmenuIndex !== index) {
                  event.currentTarget.style.background = 'transparent'
                }
                if (!action.disabled && !action.danger) {
                  event.currentTarget.style.color = 'var(--text-secondary)'
                }
              }}
              onClick={() => {
                if (action.disabled) return
                if (action.children?.length) {
                  const nextOpen = openSubmenuIndex === index ? null : index
                  setOpenSubmenuIndex(nextOpen)
                  if (nextOpen === null) {
                    setSubmenuPosition(null)
                  } else {
                    const trigger = itemRefs.current[index]
                    if (trigger) {
                      const rect = trigger.getBoundingClientRect()
                      const preferredLeft = rect.right - 2
                      const resolvedLeft = preferredLeft + estimatedWidth <= window.innerWidth - 8
                        ? preferredLeft
                        : rect.left - estimatedWidth + 2

                      setSubmenuPosition({
                        x: resolvedLeft,
                        y: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 80)),
                      })
                    }
                  }
                  return
                }
                action.onClick()
                onClose()
              }}
            >
              <span
                style={{
                  width: '16px',
                  minWidth: '16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {action.icon ?? null}
              </span>
              <span style={{ flex: 1 }}>{action.label}</span>
              {action.children?.length ? <ChevronRight size={12} /> : null}
            </button>
          </div>
        ))}
      </div>

      {openSubmenuIndex !== null && actions[openSubmenuIndex]?.children?.length && submenuPosition && (
        <ContextMenuPanel
          x={submenuPosition.x}
          y={submenuPosition.y}
          actions={actions[openSubmenuIndex].children!}
          onClose={onClose}
        />
      )}
    </div>
  )
}

export function ContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    const handleWindowChange = () => onClose()

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [onClose])

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      />
      <ContextMenuPanel x={x} y={y} actions={actions} onClose={onClose} />
    </>
  )
}
