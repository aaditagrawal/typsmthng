import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toolbar } from '@/components/layout/toolbar'
import { StatusBar } from '@/components/layout/status-bar'
import { SafariBanner } from '@/components/layout/safari-banner'
import { UpdateToast } from '@/components/layout/update-toast'
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

  return (
    <ErrorBoundary fallbackMessage="The application encountered an unexpected error.">
      <div className="flex flex-col h-full w-full" style={{ background: 'var(--bg-app)' }}>
        <SafariBanner />
        <Toolbar />
        <div className="flex flex-1 min-h-0">
          {/* Keep mounted so expand/search/rename state survives hide/show. */}
          <div
            className="shrink-0 overflow-hidden"
            hidden={!sidebarOpen}
            inert={!sidebarOpen ? true : undefined}
            style={{
              width: sidebarOpen ? '240px' : 0,
              borderRight: sidebarOpen ? '1px solid var(--border-default)' : 'none',
              background: 'var(--bg-surface)',
            }}
          >
            <FileTree />
          </div>
          <Group orientation="horizontal" className="flex-1">
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
        <UpdateToast />
        <SettingsModal />
        <CommandSearch />
        <ImagePreviewModal />
      </div>
    </ErrorBoundary>
  )
}
