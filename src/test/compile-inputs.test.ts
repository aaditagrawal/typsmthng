import { describe, expect, it } from 'vitest'
import { buildCompileInputs, computeContentDigest } from '@/lib/compile-inputs'
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

  it('falls back to the default main path when mainFile is empty', () => {
    const inputs = buildCompileInputs({
      project: project({
        mainFile: '',
        files: [
          { path: '/main.typ', content: '= Main', isBinary: false, lastModified: 1 },
        ],
      }),
      currentFilePath: '/main.typ',
      liveSource: '= Live Main',
    })

    expect(inputs.mainPath).toBe('/main.typ')
    expect(inputs.mainSource).toBe('= Live Main')
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

describe('computeContentDigest', () => {
  it('is deterministic and prefixed with the content length', () => {
    const digest = computeContentDigest('= Hello')
    expect(computeContentDigest('= Hello')).toBe(digest)
    expect(digest.startsWith('7:')).toBe(true)
  })

  it('distinguishes same-length content and single-character edits', () => {
    expect(computeContentDigest('= Hello')).not.toBe(computeContentDigest('= Hallo'))
    expect(computeContentDigest('= Hello')).not.toBe(computeContentDigest('= Hello!'))
    expect(computeContentDigest('ab')).not.toBe(computeContentDigest('ba'))
    expect(computeContentDigest('')).not.toBe(computeContentDigest(' '))
  })

  it('carries two independent hash passes', () => {
    const [, h1, h2] = computeContentDigest('= Doc').split(':')
    expect(h1).toBeTruthy()
    expect(h2).toBeTruthy()
    expect(h1).not.toBe(h2)
  })
})
