import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/latex-converter', () => ({
  convertLatexToTypst: vi.fn(async () => {
    throw new Error('parser boom')
  }),
}))

vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      createProject: vi.fn(),
      getCurrentProject: () => null,
      projects: [],
    }),
    setState: () => {},
  },
}))

import { convertUploadedLatexFile } from '@/lib/project-io'
import { convertLatexToTypst } from '@/lib/latex-converter'

describe('convertUploadedLatexFile', () => {
  beforeEach(() => {
    vi.mocked(convertLatexToTypst).mockRejectedValue(new Error('parser boom'))
  })

  it('never throws and escapes block-comment terminators in fallback content', async () => {
    const result = await convertUploadedLatexFile('body */ still', 'broken.tex')
    expect(result.content).toContain('LaTeX conversion failed')
    expect(result.content).toContain('* /')
    expect(result.warnings[0]?.message).toContain('Conversion failed')
    expect(result.warnings[0]?.message).toContain('broken.tex')
  })
})
