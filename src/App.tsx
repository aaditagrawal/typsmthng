import { useEffect, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUIStore } from '@/stores/ui-store'
import { useEditorStore } from '@/stores/editor-store'
import { preloadWorkspaceShell } from '@/components/workspace/preload'

const HomeShell = lazy(() => import('@/components/home/home-shell'))
const WorkspaceShell = lazy(() => import('@/components/workspace/workspace-shell'))

function FullscreenLoading({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center h-full w-full"
      style={{ background: 'var(--bg-app)' }}
    >
      <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
        <Loader2 size={20} className="animate-spin" />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

export default function App() {
  const loading = useProjectStore((s) => s.loading)
  const hasSelectedProject = useProjectStore((s) => s.hasSelectedProject)
  const loadProjects = useProjectStore((s) => s.loadProjects)

  useEffect(() => {
    loadProjects()
    useSettingsStore.getState().loadSettings()
  }, [loadProjects])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        const projectStore = useProjectStore.getState()
        const currentPath = projectStore.currentFilePath
        // Single save path (keymap no longer also handles Mod-s). Keep this
        // synchronous — a dynamic import here can lose saves on quick tab close.
        if (currentPath) {
          projectStore.updateFileContent(currentPath, useEditorStore.getState().source)
        }
        void projectStore.saveCurrentProject()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // CommandSearch only mounts in the workspace; toggling on home
        // would leak an open palette into the next project selection.
        if (!useProjectStore.getState().hasSelectedProject) return
        e.preventDefault()
        const { commandSearchOpen, setCommandSearchOpen } = useUIStore.getState()
        const nextOpen = !commandSearchOpen
        if (nextOpen) useSettingsStore.getState().setSettingsOpen(false)
        setCommandSearchOpen(nextOpen)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (loading) {
    return <FullscreenLoading label="Loading..." />
  }

  if (!hasSelectedProject) {
    return (
      <Suspense fallback={<FullscreenLoading label="Loading home..." />}>
        <HomeShell onPreloadWorkspace={() => { void preloadWorkspaceShell() }} />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<FullscreenLoading label="Loading workspace..." />}>
      <WorkspaceShell />
    </Suspense>
  )
}
