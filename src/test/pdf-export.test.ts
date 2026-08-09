import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  ensureCompilerReady: vi.fn(async () => {}),
  ensurePackagesForCompile: vi.fn(async () => {}),
  compileToPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  findPreviewImportSpecs: vi.fn(() => [] as string[]),
  buildCompileInputs: vi.fn(() => ({
    mainSource: '= Doc',
    mainPath: '/main.typ',
    extraFiles: [] as Array<{ path: string; content: string }>,
    extraBinaryFiles: [] as Array<{ path: string; data: Uint8Array }>,
  })),
  applyPagePreamble: vi.fn((source: string) => source),
  getCurrentProject: vi.fn(() => ({ name: 'Paper', files: [], mainFile: '/main.typ' })),
  currentFilePath: '/main.typ',
  source: '= Doc',
}))

vi.mock('@/lib/compile-manager', () => ({
  ensureCompilerReady: mocked.ensureCompilerReady,
  applyPagePreamble: mocked.applyPagePreamble,
}))

vi.mock('@/lib/compiler', () => ({
  compileToPdf: mocked.compileToPdf,
  ensurePackagesForCompile: mocked.ensurePackagesForCompile,
}))

vi.mock('@/lib/universe-registry', () => ({
  findPreviewImportSpecs: mocked.findPreviewImportSpecs,
}))

vi.mock('@/lib/compile-inputs', () => ({
  buildCompileInputs: mocked.buildCompileInputs,
}))

vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      getCurrentProject: mocked.getCurrentProject,
      currentFilePath: mocked.currentFilePath,
    }),
  },
}))

vi.mock('@/stores/editor-store', () => ({
  useEditorStore: {
    getState: () => ({
      source: mocked.source,
    }),
  },
}))

import { exportCurrentProjectPdf } from '@/lib/pdf-export'

describe('exportCurrentProjectPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.compileToPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    mocked.findPreviewImportSpecs.mockReturnValue([])
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('downloads a compiled PDF', async () => {
    const result = await exportCurrentProjectPdf()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.filename).toBe('Paper.pdf')
    }
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('alerts when the compiler returns empty output', async () => {
    mocked.compileToPdf.mockResolvedValue(new Uint8Array())
    const result = await exportCurrentProjectPdf()
    expect(result).toEqual({
      ok: false,
      reason: 'empty',
      message: 'PDF export produced no output. Check the preview for compile errors.',
    })
    expect(window.alert).toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('alerts when compilation throws', async () => {
    mocked.compileToPdf.mockRejectedValue(new Error('boom'))
    const result = await exportCurrentProjectPdf()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('error')
    }
    expect(window.alert).toHaveBeenCalledWith('Failed to export PDF. Please try again.')
  })

  it('uses liveSource from the editor view when provided', async () => {
    await exportCurrentProjectPdf({ liveSource: '= Live' })
    expect(mocked.buildCompileInputs).toHaveBeenCalledWith(
      expect.objectContaining({ liveSource: '= Live' }),
    )
  })
})
