import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, zipSync } from 'fflate'

interface MockProjectFile {
  path: string
  content: string
  isBinary: boolean
  binaryData?: Uint8Array
  lastModified: number
}

interface MockProject {
  id: string
  name: string
  files: MockProjectFile[]
  mainFile: string
  createdAt: number
  updatedAt: number
}

const mocked = vi.hoisted(() => {
  interface MockScaffoldFile {
    path: string
    content: string
    isBinary: boolean
    binaryData?: Uint8Array
  }

  interface MockScaffold {
    files: MockScaffoldFile[]
    mainFile: string
  }

  const state: {
    projects: MockProject[]
    currentProjectId: string | null
    currentFilePath: string | null
    hasSelectedProject: boolean
  } = {
    projects: [],
    currentProjectId: null,
    currentFilePath: null,
    hasSelectedProject: false,
  }

  const createProject = vi.fn(async (name: string, scaffold?: MockScaffold) => {
    const id = `project-${state.projects.length + 1}`
    state.projects.push({
      id,
      name,
      files: (scaffold?.files ?? [{ path: '/main.typ', content: '', isBinary: false }]).map((file) => ({
        path: file.path,
        content: file.content,
        isBinary: file.isBinary,
        binaryData: file.binaryData,
        lastModified: Date.now(),
      })),
      mainFile: scaffold?.mainFile ?? '/main.typ',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    state.currentProjectId = id
    state.currentFilePath = scaffold?.mainFile ?? '/main.typ'
    state.hasSelectedProject = true
    return id
  })

  const saveCurrentProject = vi.fn(async () => {})

  return { state, createProject, saveCurrentProject }
})

vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      createProject: mocked.createProject,
      saveCurrentProject: mocked.saveCurrentProject,
      getCurrentProject: () => mocked.state.projects.find((p) => p.id === mocked.state.currentProjectId),
      projects: mocked.state.projects,
    }),
    setState: (updater: unknown) => {
      const next = typeof updater === 'function'
        ? (updater as (s: typeof mocked.state) => Partial<typeof mocked.state>)(mocked.state)
        : updater as Partial<typeof mocked.state>
      Object.assign(mocked.state, next)
    },
  },
}))

import {
  exportAllProjects,
  exportProject,
  importAllProjects,
  importLatexZip,
  importProject,
  looksLikeImportableProject,
  normalizeSingleProjectZipEntries,
  uniqueExportFolderNames,
} from '@/lib/project-io'

function makeZipFileLike(name: string, zipped: Uint8Array): File {
  const buffer = Uint8Array.from(zipped).buffer
  return {
    name,
    arrayBuffer: async () => buffer,
  } as File
}

function asciiBytes(text: string): Uint8Array {
  return new Uint8Array(Array.from(text, (ch) => ch.charCodeAt(0)))
}

describe('project-io import classification', () => {
  beforeEach(() => {
    mocked.state.projects = []
    mocked.state.currentProjectId = null
    mocked.state.currentFilePath = null
    mocked.state.hasSelectedProject = false
    mocked.createProject.mockClear()
    mocked.saveCurrentProject.mockClear()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('imports .bibtex and .ris files as text', async () => {
    const zipped = zipSync({
      'main.typ': asciiBytes('= Paper'),
      'refs/library.bibtex': asciiBytes('@article{key, title={Paper}}'),
      'refs/exports.RIS': asciiBytes('TY  - JOUR\nTI  - Sample\nER  -'),
    })

    const file = makeZipFileLike('Research.zip', zipped)
    await importProject(file)
    expect(window.alert).not.toHaveBeenCalled()
    expect(mocked.createProject).toHaveBeenCalledWith(
      'Research',
      expect.objectContaining({
        mainFile: '/main.typ',
      }),
    )

    const project = mocked.state.projects.find((p) => p.name === 'Research')
    expect(project).toBeDefined()

    const bibtex = project?.files.find((f) => f.path === '/refs/library.bibtex')
    const ris = project?.files.find((f) => f.path === '/refs/exports.RIS')

    expect(bibtex?.isBinary).toBe(false)
    expect(bibtex?.content).toContain('@article')
    expect(ris?.isBinary).toBe(false)
    expect(ris?.content).toContain('TY  - JOUR')
  })

  it('keeps unsupported binary files as binary', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const zipped = zipSync({
      'main.typ': asciiBytes('= Paper'),
      'assets/raw.custombin': imageBytes,
    })

    const file = makeZipFileLike('BinaryImport.zip', zipped)
    await importProject(file)
    expect(window.alert).not.toHaveBeenCalled()
    expect(mocked.createProject).toHaveBeenCalledWith(
      'BinaryImport',
      expect.objectContaining({
        mainFile: '/main.typ',
      }),
    )

    const project = mocked.state.projects.find((p) => p.name === 'BinaryImport')
    const binary = project?.files.find((f) => f.path === '/assets/raw.custombin')

    expect(binary).toBeDefined()
    expect(binary?.isBinary).toBe(true)
    expect(binary?.content).toBe('')
    expect(binary?.binaryData).toEqual(imageBytes)
  })

  it('unwraps a zipped typsmthng project folder', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const zipped = zipSync({
      'Folder Name/main.typ': asciiBytes('= Wrapped'),
      'Folder Name/chapters/intro.typ': asciiBytes('== Intro'),
      'Folder Name/.typsmthng/template.json': asciiBytes('{"source":"built-in"}'),
      'Folder Name/assets/raw.custombin': imageBytes,
    })

    const file = makeZipFileLike('Archive.zip', zipped)
    await importProject(file)

    expect(mocked.createProject).toHaveBeenCalledWith(
      'Folder Name',
      expect.objectContaining({
        mainFile: '/main.typ',
      }),
    )

    const project = mocked.state.projects.find((p) => p.name === 'Folder Name')
    expect(project?.files.map((projectFile) => projectFile.path).sort()).toEqual([
      '/.typsmthng/template.json',
      '/assets/raw.custombin',
      '/chapters/intro.typ',
      '/main.typ',
    ])
    expect(project?.files.find((projectFile) => projectFile.path === '/assets/raw.custombin')?.binaryData).toEqual(imageBytes)
  })

  it('keeps the zip filename for unwrapped project imports', async () => {
    const zipped = zipSync({
      'main.typ': asciiBytes('= Root'),
      'chapters/intro.typ': asciiBytes('== Intro'),
    })

    const file = makeZipFileLike('RootProject.zip', zipped)
    await importProject(file)

    expect(mocked.createProject).toHaveBeenCalledWith(
      'RootProject',
      expect.objectContaining({
        mainFile: '/main.typ',
      }),
    )

    const project = mocked.state.projects.find((p) => p.name === 'RootProject')
    expect(project?.files.map((projectFile) => projectFile.path).sort()).toEqual([
      '/chapters/intro.typ',
      '/main.typ',
    ])
  })

  it('unwraps a wrapped LaTeX zip via importProject and converts .tex', async () => {
    const zipped = zipSync({
      'Paper/main.tex': asciiBytes('\\title{Ignored Title}\n\\begin{document}\nHello.\n\\end{document}'),
      'Paper/figs/note.txt': asciiBytes('note'),
    })

    const file = makeZipFileLike('PaperArchive.zip', zipped)
    const result = await importProject(file)

    expect(result?.texFilesConverted).toBe(1)
    // Generic zip import keeps the folder/archive name, not \\title metadata.
    expect(mocked.createProject).toHaveBeenCalledWith(
      'Paper',
      expect.objectContaining({
        mainFile: '/main.typ',
      }),
    )

    const project = mocked.state.projects.find((p) => p.name === 'Paper')
    expect(project?.files.map((projectFile) => projectFile.path).sort()).toEqual([
      '/figs/note.txt',
      '/main.typ',
    ])
    expect(project?.files.find((f) => f.path === '/main.typ')?.content).toContain('Hello')
  })

  it('unwraps wrapped LaTeX zips in importLatexZip', async () => {
    const zipped = zipSync({
      'Thesis/main.tex': asciiBytes('\\title{Thesis Title}\n\\begin{document}\nBody.\n\\end{document}'),
      'Thesis/chapters/one.tex': asciiBytes('\\section{One}\nText.'),
    })

    const file = makeZipFileLike('Thesis.zip', zipped)
    const result = await importLatexZip(file)

    expect(result.texFilesConverted).toBe(2)
    expect(result.projectName).toBe('Thesis Title')
    const project = mocked.state.projects[0]
    expect(project.files.map((f) => f.path).sort()).toEqual([
      '/chapters/one.typ',
      '/main.typ',
    ])
    expect(project.mainFile).toBe('/main.typ')
  })

  it('converts .tex files inside importAllProjects folders', async () => {
    const zipped = zipSync({
      'Alpha/main.tex': asciiBytes('\\begin{document}\nA\n\\end{document}'),
      'Beta/main.typ': asciiBytes('= Beta'),
    })

    const imported = await importAllProjects(makeZipFileLike('bundle.zip', zipped))
    expect(imported).toBe(2)

    const alpha = mocked.state.projects.find((p) => p.name === 'Alpha')
    const beta = mocked.state.projects.find((p) => p.name === 'Beta')
    expect(alpha?.files.map((f) => f.path)).toEqual(['/main.typ'])
    expect(alpha?.mainFile).toBe('/main.typ')
    expect(beta?.files.map((f) => f.path)).toEqual(['/main.typ'])
  })

  it('does not unwrap a folder that only has nested ancillary .tex', async () => {
    const zipped = zipSync({
      'Bundle/docs/notes.tex': asciiBytes('\\begin{document}\nHi\n\\end{document}'),
      'Bundle/photos/readme.txt': asciiBytes('photos'),
    })

    await importProject(makeZipFileLike('Bundle.zip', zipped))
    const project = mocked.state.projects[0]
    expect(project.name).toBe('Bundle')
    expect(project.files.map((f) => f.path).sort()).toEqual([
      '/Bundle/docs/notes.typ',
      '/Bundle/photos/readme.txt',
    ])
  })

  it('rejects zip-slip traversal paths on import', async () => {
    const zipped = zipSync({
      'main.typ': asciiBytes('= Safe'),
      '../evil.typ': asciiBytes('= Evil'),
      'nested/../../escape.typ': asciiBytes('= Escape'),
    })

    await importProject(makeZipFileLike('Safe.zip', zipped))
    const project = mocked.state.projects[0]
    expect(project.files.map((f) => f.path)).toEqual(['/main.typ'])
  })
})

describe('project-io zip helpers', () => {
  it('recognizes Typst and LaTeX roots as importable projects', () => {
    expect(looksLikeImportableProject(['main.typ', 'chapters/a.typ'])).toBe(true)
    expect(looksLikeImportableProject(['main.tex', 'figs/a.png'])).toBe(true)
    expect(looksLikeImportableProject(['paper.tex', 'figs/a.png'])).toBe(true)
    expect(looksLikeImportableProject(['notes.typ', 'figs/a.png'])).toBe(true)
    expect(looksLikeImportableProject(['readme.md', 'data.csv'])).toBe(false)
    // Nested ancillary sources alone should not trigger unwrap.
    expect(looksLikeImportableProject(['docs/notes.tex', 'photos/a.png'])).toBe(false)
    expect(looksLikeImportableProject(['docs/notes.typ', 'photos/a.png'])).toBe(false)
  })

  it('does not unwrap a folder just because a nested .typ exists', () => {
    const unzipped = unzipSync(zipSync({
      'Bundle/docs/notes.typ': asciiBytes('= Notes'),
      'Bundle/photos/a.png': new Uint8Array([1, 2, 3]),
    }))
    const normalized = normalizeSingleProjectZipEntries(unzipped, 'fallback')
    expect(normalized.projectName).toBe('fallback')
    expect(normalized.entries.map((e) => e.path).sort()).toEqual([
      'Bundle/docs/notes.typ',
      'Bundle/photos/a.png',
    ])
  })

  it('normalizes single-folder latex archives', () => {
    const unzipped = unzipSync(zipSync({
      'Wrapped/main.tex': asciiBytes('x'),
      'Wrapped/a.txt': asciiBytes('y'),
    }))
    const normalized = normalizeSingleProjectZipEntries(unzipped, 'fallback')
    expect(normalized.projectName).toBe('Wrapped')
    expect(normalized.entries.map((e) => e.path).sort()).toEqual(['a.txt', 'main.tex'])
  })

  it('dedupes colliding export folder names', () => {
    expect(uniqueExportFolderNames(['A/B', 'A_B', 'A/B'])).toEqual(['A_B', 'A_B-2', 'A_B-3'])
  })

  it('does not let generated suffixes collide with existing project names', () => {
    expect(uniqueExportFolderNames(['A', 'A', 'A-2'])).toEqual(['A', 'A-2', 'A-2-2'])
    expect(uniqueExportFolderNames(['A-2', 'A', 'A'])).toEqual(['A-2', 'A', 'A-3'])
  })
})

describe('project-io export', () => {
  beforeEach(() => {
    mocked.state.projects = []
    mocked.state.currentProjectId = null
    mocked.state.currentFilePath = null
    mocked.createProject.mockClear()
    vi.restoreAllMocks()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('exports the current project zip with text and binary files', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4])
    mocked.state.projects = [{
      id: 'p1',
      name: 'Demo',
      files: [
        { path: '/main.typ', content: '= Demo', isBinary: false, lastModified: 1 },
        { path: '/img.png', content: '', isBinary: true, binaryData: imageBytes, lastModified: 1 },
        { path: '/missing.bin', content: '', isBinary: true, lastModified: 1 },
        { path: '/empty/.folder', content: '', isBinary: false, lastModified: 1 },
      ],
      mainFile: '/main.typ',
      createdAt: 1,
      updatedAt: 1,
    }]
    mocked.state.currentProjectId = 'p1'

    await exportProject()

    expect(URL.createObjectURL).toHaveBeenCalled()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const buffer = new Uint8Array(await blob.arrayBuffer())
    const unzipped = unzipSync(buffer)
    expect(Object.keys(unzipped).sort()).toEqual(['img.png', 'main.typ'])
  })

  it('dedupes colliding .tex/.typ paths on import', async () => {
    const zipped = zipSync({
      'main.tex': asciiBytes('\\begin{document}From tex\\end{document}'),
      'main.typ': asciiBytes('= From typ'),
    })

    const result = await importProject(makeZipFileLike('Dup.zip', zipped))
    const project = mocked.state.projects[0]
    expect(project.files.map((f) => f.path).sort()).toEqual(['/main-2.typ', '/main.typ'])
    expect(result?.warnings.some((w) => w.message.includes('colliding'))).toBe(true)
  })

  it('prefers converted .tex for canonical .typ when a native .typ collides first', async () => {
    const zipped = zipSync({
      // Native .typ listed first in the archive; converted .tex must still win /shared.typ.
      'shared.typ': asciiBytes('= Native shared'),
      'shared.tex': asciiBytes('\\section{Converted shared}'),
      'main.tex': asciiBytes('\\begin{document}\\input{shared}\\end{document}'),
    })

    const result = await importProject(makeZipFileLike('PreferTex.zip', zipped))
    const project = mocked.state.projects[0]
    const byPath = Object.fromEntries(project.files.map((f) => [f.path, f.content]))
    expect(Object.keys(byPath).sort()).toEqual(['/main.typ', '/shared-2.typ', '/shared.typ'])
    expect(byPath['/main.typ']).toContain('#include "shared.typ"')
    expect(byPath['/shared.typ']).toContain('Converted shared')
    expect(byPath['/shared-2.typ']).toContain('Native shared')
    expect(result?.warnings.some((w) => w.message.includes('/shared-2.typ'))).toBe(true)
  })

  it('warns when export skips binaries with missing data', async () => {
    mocked.state.projects = [{
      id: 'p1',
      name: 'Demo',
      files: [
        { path: '/main.typ', content: '= Demo', isBinary: false, lastModified: 1 },
        { path: '/missing.bin', content: '', isBinary: true, lastModified: 1 },
        { path: '/empty.bin', content: '', isBinary: true, binaryData: new Uint8Array(0), lastModified: 1 },
      ],
      mainFile: '/main.typ',
      createdAt: 1,
      updatedAt: 1,
    }]
    mocked.state.currentProjectId = 'p1'

    await exportProject()

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const buffer = new Uint8Array(await blob.arrayBuffer())
    const unzipped = unzipSync(buffer)
    expect(Object.keys(unzipped).sort()).toEqual(['empty.bin', 'main.typ'])
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('1 binary file'))
  })

  it('still strips shared folder when one rejected path is present', async () => {
    const { importLatexProject } = await import('@/lib/project-io')
    const files = [
      {
        relativePath: 'Thesis/../evil.tex',
        file: { name: 'evil.tex', text: async () => '\\section{Evil}' } as File,
      },
      {
        relativePath: 'Thesis/main.tex',
        file: { name: 'main.tex', text: async () => '\\begin{document}\\input{chapters/one}\\end{document}' } as File,
      },
      {
        relativePath: 'Thesis/chapters/one.tex',
        file: { name: 'one.tex', text: async () => '\\section{One}' } as File,
      },
    ]

    await importLatexProject(files)
    const project = mocked.state.projects[0]
    expect(project.files.map((f) => f.path).sort()).toEqual([
      '/chapters/one.typ',
      '/main.typ',
    ])
  })

  it('strips shared folder prefix for LaTeX folder imports', async () => {
    const { importLatexProject } = await import('@/lib/project-io')
    const files = [
      {
        relativePath: 'Thesis/main.tex',
        file: { name: 'main.tex', text: async () => '\\begin{document}\\input{chapters/one}\\end{document}' } as File,
      },
      {
        relativePath: 'Thesis/chapters/one.tex',
        file: { name: 'one.tex', text: async () => '\\section{One}' } as File,
      },
    ]

    await importLatexProject(files)
    const project = mocked.state.projects[0]
    expect(project.files.map((f) => f.path).sort()).toEqual([
      '/chapters/one.typ',
      '/main.typ',
    ])
    expect(project.mainFile).toBe('/main.typ')
  })

  it('exports all projects under unique folders', async () => {
    mocked.state.projects = [
      {
        id: 'p1',
        name: 'A/B',
        files: [{ path: '/main.typ', content: '= A', isBinary: false, lastModified: 1 }],
        mainFile: '/main.typ',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'p2',
        name: 'A_B',
        files: [{ path: '/main.typ', content: '= B', isBinary: false, lastModified: 1 }],
        mainFile: '/main.typ',
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    await exportAllProjects()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(unzipped).sort()).toEqual(['A_B-2/main.typ', 'A_B/main.typ'])
  })

  it('round-trips export then importProject', async () => {
    mocked.state.projects = [{
      id: 'p1',
      name: 'RoundTrip',
      files: [
        { path: '/main.typ', content: '= Round', isBinary: false, lastModified: 1 },
        { path: '/extra.typ', content: '== Extra', isBinary: false, lastModified: 1 },
      ],
      mainFile: '/main.typ',
      createdAt: 1,
      updatedAt: 1,
    }]
    mocked.state.currentProjectId = 'p1'

    await exportProject()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const zipped = new Uint8Array(await blob.arrayBuffer())

    mocked.state.projects = []
    mocked.state.currentProjectId = null
    mocked.createProject.mockClear()

    await importProject(makeZipFileLike('RoundTrip.zip', zipped))
    const project = mocked.state.projects[0]
    expect(project.name).toBe('RoundTrip')
    expect(project.files.map((f) => f.path).sort()).toEqual(['/extra.typ', '/main.typ'])
    expect(project.mainFile).toBe('/main.typ')
  })
})
