import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandSearch } from '@/components/search/command-search'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUIStore } from '@/stores/ui-store'

const { forceCompile, exportCurrentProjectPdf } = vi.hoisted(() => ({
  forceCompile: vi.fn(),
  exportCurrentProjectPdf: vi.fn(),
}))

vi.mock('@/lib/compile-manager', () => ({ forceCompile }))
vi.mock('@/lib/pdf-export', () => ({ exportCurrentProjectPdf }))

describe('CommandSearch actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ commandSearchOpen: true, theme: 'dark', resolvedTheme: 'dark' })
    useSettingsStore.setState({ settingsOpen: false, theme: 'dark' })
    useEditorStore.setState({ source: 'live editor text' })
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      currentFilePath: 'main.typ',
      updateFileContent: vi.fn(),
      saveCurrentProject: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('shows searchable commands and runs the keyboard-selected compile action', async () => {
    render(<CommandSearch />)

    expect(screen.getByText('Compile document')).toBeInTheDocument()
    expect(screen.getByText('Open settings')).toBeInTheDocument()
    expect(screen.getByText('Download PDF')).toBeInTheDocument()
    expect(screen.getByText('Save project')).toBeInTheDocument()
    expect(screen.getByText('Cycle theme')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('SEARCH FILES AND COMMANDS...')
    fireEvent.change(input, { target: { value: 'build' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(forceCompile).toHaveBeenCalledWith('live editor text', 'main.typ'))
    expect(useUIStore.getState().commandSearchOpen).toBe(false)
  })

  it('flushes the editor buffer before saving and closes the palette', () => {
    render(<CommandSearch />)
    const update = useProjectStore.getState().updateFileContent as ReturnType<typeof vi.fn>
    const save = useProjectStore.getState().saveCurrentProject as ReturnType<typeof vi.fn>

    fireEvent.click(screen.getByText('Save project'))

    expect(update).toHaveBeenCalledWith('main.typ', 'live editor text')
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0])
    expect(useUIStore.getState().commandSearchOpen).toBe(false)
  })

  it('keeps settings exclusive, cycles theme, and delegates PDF export', async () => {
    const { rerender } = render(<CommandSearch />)
    fireEvent.click(screen.getByText('Open settings'))
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().commandSearchOpen).toBe(false)

    act(() => {
      useSettingsStore.setState({ settingsOpen: false, theme: 'dark' })
      useUIStore.setState({ commandSearchOpen: true })
    })
    rerender(<CommandSearch />)
    fireEvent.click(screen.getByText('Cycle theme'))
    expect(useSettingsStore.getState().theme).toBe('system')

    act(() => useUIStore.setState({ commandSearchOpen: true }))
    rerender(<CommandSearch />)
    fireEvent.click(screen.getByText('Download PDF'))
    await waitFor(() => expect(exportCurrentProjectPdf).toHaveBeenCalledOnce())
    expect(useUIStore.getState().commandSearchOpen).toBe(false)
  })
})
