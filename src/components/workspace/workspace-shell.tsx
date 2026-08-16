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

  return (
    <ErrorBoundary fallbackMessage="The application encountered an unexpected error.">
      <div className="flex flex-col h-full w-full" style={{ background: 'var(--bg-app)' }}>
        <SafariBanner />
        <Toolbar />
        <div className="workspace-main flex flex-1 min-h-0 relative">
          {/* Keep mounted so expand/search/rename state survives hide/show. */}
          <div
            className="workspace-sidebar shrink-0 overflow-hidden"
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
            className="workspace-panels flex-1"
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
