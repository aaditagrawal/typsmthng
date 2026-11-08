import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

const importLatexProjectMock = vi.hoisted(() => vi.fn(async (entries: Array<{ relativePath: string; file: File }>) => ({
  projectName: `converted-${entries.length}`,
  fileCount: 1,
  texFilesConverted: 1,
  warnings: [],
  metadata: {},
})))
const importAllProjectsMock = vi.hoisted(() => vi.fn<(file: File) => Promise<number>>())

vi.mock('@/lib/project-io', async () => {
  const actual = await vi.importActual<typeof import('@/lib/project-io')>('@/lib/project-io')
  return {
    ...actual,
    importLatexProject: importLatexProjectMock,
    importAllProjects: importAllProjectsMock,
  }
})

import { ProjectPicker } from '@/components/home/project-picker'
import { useProjectStore } from '@/stores/project-store'

describe('ProjectPicker LaTeX file input', () => {
  beforeEach(() => {
    importLatexProjectMock.mockClear()
    importAllProjectsMock.mockReset()
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      currentFilePath: null,
    })
  })

  it('deduplicates LaTeX imports before React rerenders', async () => {
    const result = { projectName: 'One import', fileCount: 1, texFilesConverted: 1, warnings: [], metadata: {} }
    let resolveImport!: (value: typeof result) => void
    importLatexProjectMock.mockImplementationOnce(() => new Promise((resolve) => { resolveImport = resolve }))
    const { container } = render(<ProjectPicker onShowGuide={() => {}} />)
    const input = container.querySelector('input[accept=".tex"]')!
    const files = [new File(['hello'], 'doc.tex')]
    act(() => {
      fireEvent.change(input, { target: { files } })
      fireEvent.change(input, { target: { files } })
    })
    await waitFor(() => expect(importLatexProjectMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Converting...' })).toBeDisabled()
    await act(async () => resolveImport(result))
    expect(screen.getByText(/One import/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss import result' }))
    expect(screen.queryByText(/One import/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import LaTeX' })).toBeEnabled()
  })

  it('deduplicates workspace imports and replaces an error with retry success', async () => {
    let rejectImport!: (error: Error) => void
    importAllProjectsMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectImport = reject }))
    importAllProjectsMock.mockResolvedValueOnce(2)
    const { container } = render(<ProjectPicker onShowGuide={() => {}} />)
    const input = [...container.querySelectorAll('input[accept=".zip"]')].at(-1)!
    const files = [new File(['zip'], 'workspace.zip')]
    act(() => {
      fireEvent.change(input, { target: { files } })
      fireEvent.change(input, { target: { files } })
    })
    await waitFor(() => expect(importAllProjectsMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Importing...' })).toBeDisabled()
    await act(async () => rejectImport(new Error('bad archive')))
    expect(screen.getByText('bad archive')).toBeInTheDocument()
    fireEvent.change(input, { target: { files } })
    expect(await screen.findByText('Imported 2 projects')).toBeInTheDocument()
    expect(screen.queryByText('bad archive')).not.toBeInTheDocument()
    expect(importAllProjectsMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Import all' })).toBeEnabled()
  })

  it('survives the input value reset emptying the live FileList mid-import', async () => {
    const { container } = render(<ProjectPicker onShowGuide={() => {}} />)
    const input = [...container.querySelectorAll('input[type="file"]')]
      .find((el) => el.getAttribute('accept') === '.tex') as HTMLInputElement
    expect(input).toBeTruthy()

    const file = new File(['\\section{Hi}'], 'doc.tex', { type: 'text/x-tex' })
    // Chromium empties the SAME live FileList object when input.value is reset,
    // which the onChange handler does synchronously after invoking the async
    // import. Emulate that with a FileList whose entries vanish after the
    // current synchronous call stack completes.
    let cleared = false
    const liveFileList = {
      get length() { return cleared ? 0 : 1 },
      item(i: number) { return cleared || i !== 0 ? null : file },
      [Symbol.iterator]: function* () { if (!cleared) yield file },
      0: file,
    } as unknown as FileList
    Object.defineProperty(input, 'files', { configurable: true, get: () => liveFileList })
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: () => { cleared = true },
    })

    input.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => expect(importLatexProjectMock).toHaveBeenCalledTimes(1))
    const entries = importLatexProjectMock.mock.calls[0][0]
    expect(entries).toHaveLength(1)
    expect(entries[0].relativePath).toBe('doc.tex')
  })
})
