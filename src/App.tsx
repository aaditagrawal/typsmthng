import * as stylex from '@stylexjs/stylex'
import { useEffect, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUIStore } from '@/stores/ui-store'
import { useEditorStore } from '@/stores/editor-store'
import { preloadWorkspaceShell } from '@/components/workspace/preload'
import { UpdateToast } from '@/components/layout/update-toast'

const HomeShell = lazy(() => import('@/components/home/home-shell'))
const WorkspaceShell = lazy(() => import('@/components/workspace/workspace-shell'))

function FullscreenLoading({ label }: { label: string }) {
  return (
    <div
      {...stylex.props(styles.element1)}
      style={{ background: 'var(--bg-app)' }}
    >
      <div {...stylex.props(styles.element2)} style={{ color: 'var(--text-tertiary)' }}>
        <Loader2 size={20} {...stylex.props(styles.element3)} />
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        // The editor keymap binds Mod-j too and marks the event consumed;
        // this fallback only fires when focus is outside CodeMirror. The
        // cycle logic is inlined (not imported from keybindings.ts) so the
        // eager App chunk stays free of CodeMirror/compiler modules.
        if (e.defaultPrevented) return
        e.preventDefault()
        const { theme, setTheme } = useSettingsStore.getState()
        const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
        setTheme(next)
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

  let content: React.ReactNode
  if (loading) {
    content = <FullscreenLoading label="Loading..." />
  } else if (!hasSelectedProject) {
    content = (
      <Suspense fallback={<FullscreenLoading label="Loading home..." />}>
        <HomeShell onPreloadWorkspace={() => { void preloadWorkspaceShell() }} />
      </Suspense>
    )
  } else {
    content = (
      <Suspense fallback={<FullscreenLoading label="Loading workspace..." />}>
        <WorkspaceShell />
      </Suspense>
    )
  }

  return (
    <>
      {content}
      {/* Keep the listener mounted while moving between home and workspace. */}
      <UpdateToast />
    </>
  )
}

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } })
const styles = stylex.create({
  "element1": {
    "display": "flex",
    "height": "100%",
    "width": "100%",
    "alignItems": "center",
    "justifyContent": "center"
  },
  "element2": {
    "display": "flex",
    "flexDirection": "column",
    "alignItems": "center",
    "gap": "calc(var(--spacing) * 3)"
  },
  "element3": {
    "animationName": spin,
    "animationDuration": "1s",
    "animationTimingFunction": "linear",
    "animationIterationCount": "infinite"
  }
})
