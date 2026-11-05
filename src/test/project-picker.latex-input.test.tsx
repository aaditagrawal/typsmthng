import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

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

vi.mock('@/lib/project-io', async () => {
  const actual = await vi.importActual<typeof import('@/lib/project-io')>('@/lib/project-io')
  return {
    ...actual,
    importLatexProject: importLatexProjectMock,
  }
})

import { ProjectPicker } from '@/components/home/project-picker'
import { useProjectStore } from '@/stores/project-store'

describe('ProjectPicker LaTeX file input', () => {
  beforeEach(() => {
    importLatexProjectMock.mockClear()
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      currentFilePath: null,
    })
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
