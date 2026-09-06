import * as stylex from '@stylexjs/stylex'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toolbar } from '@/components/layout/toolbar'
import { StatusBar } from '@/components/layout/status-bar'
import { SafariBanner } from '@/components/layout/safari-banner'
import { useEffect, useState } from 'react'
import { TypstEditor } from '@/components/editor/typst-editor'
import { PreviewPanel } from '@/components/preview/preview-panel'
import { FileTree } from '@/components/sidebar/file-tree'
import { SettingsModal } from '@/components/settings/settings-modal'
import { CommandSearch } from '@/components/search/command-search'
import { ImagePreviewModal } from '@/components/preview/image-preview-modal'
import { ErrorBoundary } from '@/components/layout/error-boundary'
import { useProjectStore } from '@/stores/project-store'

export default function WorkspaceShell() {
  const sidebarOpen = useProjectStore((s) => s.sidebarOpen)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // On the narrow breakpoint the sidebar overlays the editor, so close it
  // once a file is picked instead of leaving it covering the workspace.
  useEffect(() => {
    if (!narrow) return
    return useProjectStore.subscribe((state, prevState) => {
      if (state.currentFilePath !== prevState.currentFilePath && state.sidebarOpen) {
        state.setSidebarOpen(false)
      }
    })
  }, [narrow])

  return (
    <ErrorBoundary fallbackMessage="The application encountered an unexpected error.">
      <div {...stylex.props(styles.element1)} style={{ background: 'var(--bg-app)' }}>
        <SafariBanner />
        <Toolbar />
        <div className={["workspace-main", stylex.props(styles.element2).className].join(' ')}>
          {narrow && sidebarOpen && (
            <div
              className="workspace-scrim"
              data-testid="workspace-scrim"
              aria-hidden="true"
              onClick={() => useProjectStore.getState().setSidebarOpen(false)}
            />
          )}
          {/* Keep mounted so expand/search/rename state survives hide/show. */}
          <div
            className={["workspace-sidebar", stylex.props(styles.element3).className].join(' ')}
            hidden={!sidebarOpen}
            inert={!sidebarOpen ? true : undefined}
            style={{
              width: sidebarOpen ? (narrow ? 'min(85vw, 320px)' : '240px') : 0,
              borderRight: sidebarOpen ? '1px solid var(--border-default)' : 'none',
              background: 'var(--bg-surface)',
            }}
          >
            <FileTree />
          </div>
          <Group
            key={narrow ? 'vertical' : 'horizontal'}
            orientation={narrow ? 'vertical' : 'horizontal'}
            className={["workspace-panels", stylex.props(styles.element4).className].join(' ')}
          >
            <Panel defaultSize={50} minSize={25}>
              <ErrorBoundary fallbackMessage="Editor crashed.">
                <TypstEditor />
              </ErrorBoundary>
            </Panel>
            <Separator />
            <Panel defaultSize={50} minSize={25}>
              <ErrorBoundary fallbackMessage="Preview crashed.">
                <PreviewPanel />
              </ErrorBoundary>
            </Panel>
          </Group>
        </div>
        <StatusBar />
        <SettingsModal />
        <CommandSearch />
        <ImagePreviewModal />
      </div>
    </ErrorBoundary>
  )
}

const styles = stylex.create({
  "element1": {
    "display": "flex",
    "height": "100%",
    "width": "100%",
    "flexDirection": "column"
  },
  "element2": {
    "position": "relative",
    "display": "flex",
    "minHeight": "calc(var(--spacing) * 0)",
    "flex": "1"
  },
  "element3": {
    "flexShrink": 0,
    "overflow": "hidden"
  },
  "element4": {
    "flex": "1"
  }
})
