import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Dialog accessibility helper: moves focus into the panel on open, traps Tab
 * within it, closes on Escape, and restores focus to the invoking element on
 * close. The panel element should have `tabIndex={-1}` so it can receive
 * initial focus, plus `role="dialog"`, `aria-modal="true"` and an aria-label.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared hook co-located with the shared overlay component
export function useModalA11y(
  panelRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    if (!panel.contains(document.activeElement)) {
      panel.focus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusables.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused && previouslyFocused.isConnected && previouslyFocused !== document.body) {
        previouslyFocused.focus()
      }
    }
  }, [panelRef, open])
}

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
  onCloseSubmenu,
}: {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
  onCloseSubmenu?: () => void
}) {
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number } | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() => ({
    left: Math.max(8, Math.min(x, window.innerWidth - 188)),
    top: Math.max(8, y),
  }))

  const estimatedWidth = 232

  // Clamp against the real rendered panel size so long menus near the bottom
  // of the screen reposition instead of getting cut off.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const width = rect.width || 220
    const height = rect.height
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y])

  // Focus the first enabled item on mount; restore focus when the menu closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const firstEnabled = itemRefs.current.find((element) => element && !element.disabled)
    firstEnabled?.focus()
    return () => {
      if (previouslyFocused && previouslyFocused.isConnected && previouslyFocused !== document.body) {
        previouslyFocused.focus()
      }
    }
  }, [])

  const moveFocus = (direction: 1 | -1) => {
    const items = itemRefs.current.filter(
      (element): element is HTMLButtonElement => Boolean(element && !element.disabled),
    )
    if (items.length === 0) return
    const activeIndex = items.findIndex((element) => element === document.activeElement)
    const nextIndex = activeIndex === -1
      ? (direction === 1 ? 0 : items.length - 1)
      : (activeIndex + direction + items.length) % items.length
    items[nextIndex].focus()
  }

  const openSubmenuFor = (index: number) => {
    const trigger = itemRefs.current[index]
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const preferredLeft = rect.right - 2
    const resolvedLeft = preferredLeft + estimatedWidth <= window.innerWidth - 8
      ? preferredLeft
      : rect.left - estimatedWidth + 2

    setOpenSubmenuIndex(index)
    setSubmenuPosition({
      x: resolvedLeft,
      y: Math.max(8, Math.min(rect.top - 6, window.innerHeight - 80)),
    })
  }

  const closeSubmenu = () => {
    setOpenSubmenuIndex(null)
    setSubmenuPosition(null)
  }

  return (
    <div
      onMouseLeave={closeSubmenu}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
      }}
      style={{ position: 'relative' }}
    >
      <div
        ref={panelRef}
        role="menu"
        className="fixed z-50 min-w-[220px]"
        style={{
          left: position.left,
          top: position.top,
          background: 'var(--bg-elevated)',
          border: 'none',
          borderRadius: '2px',
          fontFamily: 'var(--font-mono)',
          boxShadow: '0 10px 24px rgba(0, 0, 0, 0.22)',
          padding: '6px',
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            moveFocus(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            moveFocus(-1)
          } else if (event.key === 'ArrowRight') {
            const index = itemRefs.current.findIndex((element) => element === document.activeElement)
            const action = index >= 0 ? actions[index] : undefined
            if (action?.children?.length && !action.disabled) {
              event.preventDefault()
              event.stopPropagation()
              openSubmenuFor(index)
            }
          } else if (event.key === 'ArrowLeft' && onCloseSubmenu) {
            event.preventDefault()
            event.stopPropagation()
            onCloseSubmenu()
          }
        }}
      >
        {actions.map((action, index) => (
          <div key={`${action.label}-${index}`}>
            {index > 0 && (
              <div
                aria-hidden="true"
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
              role="menuitem"
              disabled={action.disabled}
              aria-disabled={action.disabled || undefined}
              aria-haspopup={action.children?.length ? 'menu' : undefined}
              aria-expanded={action.children?.length ? openSubmenuIndex === index : undefined}
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
                event.stopPropagation()
              }}
              onMouseEnter={(event) => {
                if (action.disabled) return
                if (action.children?.length) {
                  openSubmenuFor(index)
                } else {
                  closeSubmenu()
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
              onFocus={(event) => {
                if (action.disabled) return
                event.currentTarget.style.background = 'var(--bg-hover)'
                if (!action.danger) event.currentTarget.style.color = 'var(--text-primary)'
              }}
              onBlur={(event) => {
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
                  if (openSubmenuIndex === index) {
                    closeSubmenu()
                  } else {
                    openSubmenuFor(index)
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
          onCloseSubmenu={closeSubmenu}
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
