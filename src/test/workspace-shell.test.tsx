import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '@/stores/project-store'

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className, orientation }: {
    children: ReactNode
    className?: string
    orientation: string
  }) => <div className={className} data-testid="panel-group" data-orientation={orientation}>{children}</div>,
  Panel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Separator: () => <div data-testid="separator" />,
}))

vi.mock('@/components/layout/toolbar', () => ({ Toolbar: () => <div>toolbar</div> }))
vi.mock('@/components/layout/status-bar', () => ({ StatusBar: () => <div>status</div> }))
vi.mock('@/components/layout/safari-banner', () => ({ SafariBanner: () => null }))
vi.mock('@/components/editor/typst-editor', () => ({ TypstEditor: () => <div>editor</div> }))
vi.mock('@/components/preview/preview-panel', () => ({ PreviewPanel: () => <div>preview</div> }))
vi.mock('@/components/sidebar/file-tree', () => ({ FileTree: () => <div>files</div> }))
vi.mock('@/components/settings/settings-modal', () => ({ SettingsModal: () => null }))
vi.mock('@/components/search/command-search', () => ({ CommandSearch: () => null }))
vi.mock('@/components/preview/image-preview-modal', () => ({ ImagePreviewModal: () => null }))

import WorkspaceShell from '@/components/workspace/workspace-shell'

describe('WorkspaceShell responsive layout', () => {
  let narrow = false
  const listeners = new Set<() => void>()

  beforeEach(() => {
    narrow = false
    listeners.clear()
    useProjectStore.setState({ sidebarOpen: true })
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      get matches() { return query === '(max-width: 767px)' ? narrow : false },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as () => void)
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as () => void)
      },
      dispatchEvent: vi.fn(),
    }))
  })

  it('uses a horizontal split and fixed sidebar on wider screens', () => {
    const { container } = render(<WorkspaceShell />)

    expect(screen.getByTestId('panel-group')).toHaveAttribute('data-orientation', 'horizontal')
    expect(container.querySelector<HTMLElement>('.workspace-sidebar')).toHaveStyle({ width: '240px' })
  })

  it('switches to a vertical split and overlay-sized sidebar on narrow screens', () => {
    narrow = true
    const { container } = render(<WorkspaceShell />)

    expect(screen.getByTestId('panel-group')).toHaveAttribute('data-orientation', 'vertical')
    expect(container.querySelector<HTMLElement>('.workspace-sidebar')).toHaveStyle({
      width: 'min(85vw, 320px)',
    })

    act(() => {
      narrow = false
      listeners.forEach((listener) => listener())
    })
    expect(screen.getByTestId('panel-group')).toHaveAttribute('data-orientation', 'horizontal')
  })

  it('closes the overlay sidebar via the scrim and after picking a file on narrow screens', () => {
    narrow = true
    useProjectStore.setState({ sidebarOpen: true, currentFilePath: null })
    render(<WorkspaceShell />)

    fireEvent.click(screen.getByTestId('workspace-scrim'))
    expect(useProjectStore.getState().sidebarOpen).toBe(false)
    expect(screen.queryByTestId('workspace-scrim')).not.toBeInTheDocument()

    act(() => { useProjectStore.setState({ sidebarOpen: true }) })
    act(() => { useProjectStore.setState({ currentFilePath: '/main.typ' }) })
    expect(useProjectStore.getState().sidebarOpen).toBe(false)
  })

  it('keeps the sidebar open when a file is picked on wide screens', () => {
    useProjectStore.setState({ sidebarOpen: true, currentFilePath: null })
    render(<WorkspaceShell />)

    expect(screen.queryByTestId('workspace-scrim')).not.toBeInTheDocument()
    act(() => { useProjectStore.setState({ currentFilePath: '/main.typ' }) })
    expect(useProjectStore.getState().sidebarOpen).toBe(true)
  })
})
