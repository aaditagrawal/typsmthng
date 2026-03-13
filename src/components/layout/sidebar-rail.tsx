import { Files, Search, Settings } from 'lucide-react'
import { useProjectStore } from '@/stores/project-store'

function RailIcon({ icon: Icon, label, disabled = true, active = false, onClick }: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  disabled?: boolean
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className="rail-button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '36px',
        height: '36px',
        border: 'none',
        borderRadius: '0',
        background: 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-mono)',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <Icon size={18} />
    </button>
  )
}

export function SidebarRail() {
  const sidebarOpen = useProjectStore((s) => s.sidebarOpen)
  const setSidebarOpen = useProjectStore((s) => s.setSidebarOpen)

  return (
    <aside
      className="flex flex-col items-center py-2 gap-1 shrink-0"
      style={{
        width: '40px',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-default)',
      }}
    >
      <RailIcon
        icon={Files}
        label="Files"
        disabled={false}
        active={sidebarOpen}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      />
      <RailIcon icon={Search} label="Search (coming soon)" />
      <div className="flex-1" />
      <RailIcon icon={Settings} label="Settings (coming soon)" />
    </aside>
  )
}
