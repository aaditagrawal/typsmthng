import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'

vi.mock('@/lib/compile-manager', () => ({
  ensureCompilerReady: vi.fn(async () => {}),
  forceCompile: vi.fn(async () => {}),
  requestCompile: vi.fn(),
}))

import { forceCompile } from '@/lib/compile-manager'
import { TypstEditor } from '@/components/editor/typst-editor'

describe('TypstEditor project switches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ vimMode: false })
    useCompileStore.getState().clearPreview()
    useEditorStore.setState({ source: '', isDirty: false, saveStatus: 'saved', lastUserEditAt: 0 })
    useProjectStore.setState({
      projects: ['original', 'imported'].map((id) => ({
        id,
        name: id,
        files: [{ path: '/main.typ', content: '= Same main document', isBinary: false, lastModified: 1 }],
        mainFile: '/main.typ',
        createdAt: 1,
        updatedAt: 1,
      })),
      currentProjectId: 'original',
      currentFilePath: '/main.typ',
      hasSelectedProject: true,
    })
  })

  afterEach(cleanup)

  it('compiles the imported project after its identical main buffer leaves the preview cleared', () => {
    render(<TypstEditor />)
    expect(forceCompile).toHaveBeenCalledTimes(1)
    vi.mocked(forceCompile).mockClear()
    useCompileStore.getState().setSvgResult('<svg/>', new Uint8Array([1]), [{ width: 100, height: 100 }])

    act(() => {
      useProjectStore.setState({ currentProjectId: 'imported' })
      useCompileStore.getState().clearPreview()
    })

    expect(forceCompile).toHaveBeenCalledExactlyOnceWith('= Same main document', '/main.typ')
    expect(useEditorStore.getState().source).toBe('= Same main document')
    expect(useEditorStore.getState().isDirty).toBe(false)
  })
})
