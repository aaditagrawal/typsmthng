import { describe, expect, it } from 'vitest'
import { buildCompileInputs } from '@/lib/compile-inputs'
import type { Project } from '@/stores/project-store'

function project(partial: Partial<Project> & Pick<Project, 'files' | 'mainFile'>): Project {
  return {
    id: 'p1',
    name: 'P',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('buildCompileInputs', () => {
  it('overlays live source onto the open file', () => {
    const inputs = buildCompileInputs({
      project: project({
        mainFile: '/main.typ',
        files: [
          { path: '/main.typ', content: '= Main', isBinary: false, lastModified: 1 },
          { path: '/other.typ', content: '= Other', isBinary: false, lastModified: 1 },
        ],
      }),
      currentFilePath: '/other.typ',
      liveSource: '= Live Other',
    })

    expect(inputs.mainSource).toBe('= Main')
    expect(inputs.extraFiles.find((f) => f.path === '/other.typ')?.content).toBe('= Live Other')
  })

  it('does not treat an arbitrary open buffer as missing main', () => {
    const inputs = buildCompileInputs({
      project: project({
        mainFile: '/missing.typ',
        files: [
          { path: '/chapter.typ', content: '= Chapter', isBinary: false, lastModified: 1 },
        ],
      }),
      currentFilePath: '/chapter.typ',
      liveSource: '= Should Not Become Main',
    })

    expect(inputs.mainPath).toBe('/missing.typ')
    expect(inputs.mainSource).toBe('')
    expect(inputs.textFiles.some((f) => f.content === '= Should Not Become Main')).toBe(true)
  })

  it('uses live source when the open file is the missing main', () => {
    const inputs = buildCompileInputs({
      project: project({
        mainFile: '/main.typ',
        files: [],
      }),
      currentFilePath: '/main.typ',
      liveSource: '= Live Main',
    })

    expect(inputs.mainSource).toBe('= Live Main')
  })
})
