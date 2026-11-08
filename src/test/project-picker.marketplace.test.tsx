import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UniverseMarketplacePackage } from '@/lib/universe-registry'

vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    keys: vi.fn(async () => Array.from(store.keys())),
  }
})

const searchUniverseMarketplaceMock = vi.hoisted(() =>
  vi.fn<(query: string) => Promise<UniverseMarketplacePackage[]>>(async () => []),
)

vi.mock('@/lib/universe-registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/universe-registry')>('@/lib/universe-registry')
  return {
    ...actual,
    searchUniverseMarketplace: searchUniverseMarketplaceMock,
    MIN_MARKETPLACE_QUERY_LENGTH: 2,
  }
})

vi.mock('@/lib/template-init', () => ({
  runInitCommand: vi.fn(async () => ({
    projectName: 'mock',
    resolvedSpec: '@preview/mock:0.0.1',
  })),
}))

import { ProjectPicker } from '@/components/home/project-picker'
import { useProjectStore } from '@/stores/project-store'

describe('ProjectPicker marketplace', () => {
  beforeEach(() => {
    searchUniverseMarketplaceMock.mockReset()
    searchUniverseMarketplaceMock.mockResolvedValue([])

    useProjectStore.setState({
      projects: [{
        id: 'existing',
        name: 'Existing',
        files: [{
          path: '/main.typ',
          content: '= Existing',
          isBinary: false,
          lastModified: Date.now(),
        }],
        mainFile: '/main.typ',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
      currentProjectId: null,
      currentFilePath: null,
      sidebarOpen: false,
      loading: false,
      hasSelectedProject: false,
    })
  })

  it('keeps card rename, delete confirmation, and context menu mutually exclusive', () => {
    render(<ProjectPicker onShowGuide={() => {}} />)
    const card = screen.getByRole('button', { name: 'Open project Existing' })
    fireEvent.click(screen.getByTitle('Delete project'))
    expect(screen.getByText('Click trash again to delete')).toBeInTheDocument()

    fireEvent.contextMenu(card)
    expect(screen.queryByText('Click trash again to delete')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Rename'))
    const input = screen.getByDisplayValue('Existing')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Draft' } })
    fireEvent.keyDown(input, { key: 'ContextMenu' })
    expect(screen.getByDisplayValue('Draft')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByText('Existing')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Draft')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Delete project'))
    fireEvent.mouseLeave(card)
    expect(screen.queryByText('Click trash again to delete')).not.toBeInTheDocument()
    expect(useProjectStore.getState().projects).toHaveLength(1)
  })

  it('opens marketplace modal and imports built-in starter', async () => {
    render(<ProjectPicker onShowGuide={() => {}} />)

    fireEvent.click(screen.getByTestId('template-init-reveal-button'))
    fireEvent.click(screen.getByTestId('marketplace-open-button'))
    expect(screen.getByTestId('marketplace-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('marketplace-import-research-starter'))

    await waitFor(() => {
      const created = useProjectStore.getState().projects.find((project) => project.name === 'Research Starter')
      expect(created).toBeDefined()
      expect(created?.mainFile).toBe('/main.typ')
    })
  })

  it('prefills init command from a universe marketplace result', async () => {
    searchUniverseMarketplaceMock.mockResolvedValue([{
      name: 'aero-check',
      latestVersion: '0.1.1',
      latestResolvedSpec: '@preview/aero-check:0.1.1',
      initCommand: 'typst init @preview/aero-check:0.1.1',
      isTemplate: true,
      templateEntrypoint: 'main.typ',
    }])

    render(<ProjectPicker onShowGuide={() => {}} />)

    fireEvent.click(screen.getByTestId('template-init-reveal-button'))
    fireEvent.click(screen.getByTestId('marketplace-open-button'))
    fireEvent.change(screen.getByTestId('marketplace-search-input'), { target: { value: 'ae' } })

    await waitFor(() => {
      expect(searchUniverseMarketplaceMock).toHaveBeenCalledWith('ae')
    })

    fireEvent.click(await screen.findByTestId('marketplace-prefill-aero-check'))

    const commandInput = screen.getByPlaceholderText('typst init @preview/aero-check:0.1.1') as HTMLInputElement
    expect(commandInput.value).toBe('typst init @preview/aero-check:0.1.1')
  })

  it('ignores a pending search after the query becomes too short', async () => {
    let resolveSearch!: (results: UniverseMarketplacePackage[]) => void
    searchUniverseMarketplaceMock.mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve }))
    render(<ProjectPicker onShowGuide={() => {}} />)
    fireEvent.click(screen.getByTestId('template-init-reveal-button'))
    fireEvent.click(screen.getByTestId('marketplace-open-button'))
    fireEvent.change(screen.getByTestId('marketplace-search-input'), { target: { value: 'ae' } })
    await waitFor(() => expect(searchUniverseMarketplaceMock).toHaveBeenCalledWith('ae'))

    fireEvent.change(screen.getByTestId('marketplace-search-input'), { target: { value: '' } })
    await act(async () => resolveSearch([{
      name: 'stale-template',
      latestVersion: '1.0.0',
      latestResolvedSpec: '@preview/stale-template:1.0.0',
      initCommand: 'typst init @preview/stale-template:1.0.0',
      isTemplate: true,
    }]))

    expect(screen.queryByTestId('marketplace-import-stale-template')).not.toBeInTheDocument()
    expect(screen.getByText('Type at least 2 characters to search.')).toBeInTheDocument()
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument()
  })

  it('deduplicates template submissions before React rerenders and permits retry after failure', async () => {
    const { runInitCommand } = await import('@/lib/template-init')
    vi.mocked(runInitCommand).mockClear()
    let rejectInit!: (error: Error) => void
    vi.mocked(runInitCommand).mockImplementationOnce(() => new Promise((_, reject) => { rejectInit = reject }))
    render(<ProjectPicker onShowGuide={() => {}} />)
    fireEvent.click(screen.getByTestId('template-init-reveal-button'))
    const input = screen.getByLabelText('Template init command')
    fireEvent.change(input, { target: { value: 'typst init @preview/mock' } })
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(runInitCommand).toHaveBeenCalledTimes(1)
    await act(async () => rejectInit(new Error('try again')))
    expect(screen.getByText('try again')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByText('Created "mock" from @preview/mock:0.0.1')).toBeInTheDocument())
    expect(runInitCommand).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('try again')).not.toBeInTheDocument()
  })

  it('surfaces init failures inside the marketplace modal', async () => {
    const { runInitCommand } = await import('@/lib/template-init')
    vi.mocked(runInitCommand).mockRejectedValueOnce(new Error('network down'))

    searchUniverseMarketplaceMock.mockResolvedValue([{
      name: 'aero-check',
      latestVersion: '0.1.1',
      latestResolvedSpec: '@preview/aero-check:0.1.1',
      initCommand: 'typst init @preview/aero-check:0.1.1',
      isTemplate: true,
      templateEntrypoint: 'main.typ',
    }])

    render(<ProjectPicker onShowGuide={() => {}} />)

    fireEvent.click(screen.getByTestId('template-init-reveal-button'))
    fireEvent.click(screen.getByTestId('marketplace-open-button'))
    fireEvent.change(screen.getByTestId('marketplace-search-input'), { target: { value: 'ae' } })
    fireEvent.click(await screen.findByTestId('marketplace-import-aero-check'))

    expect(await screen.findByTestId('marketplace-init-error')).toHaveTextContent('network down')
    expect(screen.getByTestId('marketplace-modal')).toBeInTheDocument()
  })
})
