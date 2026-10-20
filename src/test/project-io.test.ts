import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync, zipSync } from 'fflate'

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
    failPersistNames: string[]
  } = {
    projects: [],
    currentProjectId: null,
    currentFilePath: null,
    hasSelectedProject: false,
    failPersistNames: [],
  }

  const createProject = vi.fn(async (
    name: string,
    scaffold?: MockScaffold,
    options?: { select?: boolean },
  ) => {
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
    if (options?.select !== false) {
      state.currentProjectId = id
      state.currentFilePath = scaffold?.mainFile ?? '/main.typ'
      state.hasSelectedProject = true
    }
    if (state.failPersistNames.includes(name)) {
      return {
        id,
        persisted: false,
        persistError: new DOMException('quota exceeded', 'QuotaExceededError'),
      }
    }
    return { id, persisted: true }
  })

  const updateFileContent = vi.fn((path: string, content: string) => {
    const project = state.projects.find((p) => p.id === state.currentProjectId)
    const file = project?.files.find((f) => f.path === path && !f.isBinary)
    if (file) file.content = content
  })

  const saveCurrentProject = vi.fn(async () => {})

  return { state, createProject, updateFileContent, saveCurrentProject }
})

vi.mock('@/stores/project-store', () => ({
  isQuotaExceededError: (err: unknown) => err instanceof DOMException && err.name === 'QuotaExceededError',
  useProjectStore: {
    getState: () => ({
      createProject: mocked.createProject,
      updateFileContent: mocked.updateFileContent,
      saveCurrentProject: mocked.saveCurrentProject,
      getCurrentProject: () => mocked.state.projects.find((p) => p.id === mocked.state.currentProjectId),
      projects: mocked.state.projects,
      currentFilePath: mocked.state.currentFilePath,
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
  importLatexProject,
  importLatexZip,
  importProject,
  looksLikeImportableProject,
  normalizeSingleProjectZipEntries,
  prepareUploadedFiles,
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
    mocked.state.failPersistNames = []
    mocked.createProject.mockClear()
    mocked.updateFileContent.mockClear()
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
      '/main.tex',
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
      '/chapters/one.tex',
      '/chapters/one.typ',
      '/main.tex',
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
    expect(mocked.state.hasSelectedProject).toBe(false)
    expect(mocked.state.currentProjectId).toBeNull()
    expect(mocked.createProject).toHaveBeenCalledWith(
      'Alpha',
      expect.objectContaining({ mainFile: '/main.typ' }),
      { select: false },
    )

    const alpha = mocked.state.projects.find((p) => p.name === 'Alpha')
    const beta = mocked.state.projects.find((p) => p.name === 'Beta')
    expect(alpha?.files.map((f) => f.path)).toEqual(['/main.typ', '/main.tex'])
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
      '/Bundle/docs/notes.tex',
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

  it('decodes non-UTF-8 text files as Windows-1252 with a warning instead of corrupting them', async () => {
    const zipped = zipSync({
      'main.typ': asciiBytes('= Paper'),
      // "café" in latin-1/windows-1252: 0xE9 is invalid UTF-8.
      'notes.txt': new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
    })

    const result = await importProject(makeZipFileLike('Legacy.zip', zipped))
    const project = mocked.state.projects[0]
    const notes = project.files.find((f) => f.path === '/notes.txt')

    expect(notes?.isBinary).toBe(false)
    expect(notes?.content).toBe('café')
    expect(result?.warnings.some((w) => (
      w.message.includes('/notes.txt') && w.message.includes('Windows-1252')
    ))).toBe(true)
  })

  it('keeps ambiguous native references on the first canonical converted path', async () => {
    const zipped = zipSync({
      'one.tex': asciiBytes('\\section{First}'),
      'one.TEX': asciiBytes('\\section{Second}'),
      'main.typ': asciiBytes('#import "one.typ": *'),
    })

    await importProject(makeZipFileLike('Imports.zip', zipped))
    const project = mocked.state.projects[0]
    const byPath = Object.fromEntries(project.files.map((f) => [f.path, f.content]))

    expect(Object.keys(byPath).sort()).toEqual(['/main.typ', '/one-2.typ', '/one.TEX', '/one.tex', '/one.typ'])
    expect(byPath['/main.typ']).toContain('#import "one.typ": *')
  })

  it('counts only persisted projects in importAllProjects and alerts on failures', async () => {
    mocked.state.failPersistNames = ['Beta']
    const zipped = zipSync({
      'Alpha/main.typ': asciiBytes('= Alpha'),
      'Beta/main.typ': asciiBytes('= Beta'),
    })

    const imported = await importAllProjects(makeZipFileLike('bundle.zip', zipped))

    expect(imported).toBe(1)
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('1 project could not be saved — storage is full'),
    )
  })

  it('throws from importAllProjects when no project could be persisted', async () => {
    mocked.state.failPersistNames = ['Alpha']
    const zipped = zipSync({
      'Alpha/main.typ': asciiBytes('= Alpha'),
    })

    await expect(importAllProjects(makeZipFileLike('bundle.zip', zipped)))
      .rejects.toThrow('No projects could be saved — storage is full')
  })

  it('reports skipped root-level zip entries in importAllProjects', async () => {
    const zipped = zipSync({
      'loose.txt': asciiBytes('not in a project folder'),
      'stray.typ': asciiBytes('= stray'),
      'Alpha/main.typ': asciiBytes('= Alpha'),
    })

    const imported = await importAllProjects(makeZipFileLike('bundle.zip', zipped))

    expect(imported).toBe(1)
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('2 root-level files were skipped'),
    )
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
    mocked.state.failPersistNames = []
    mocked.createProject.mockClear()
    mocked.updateFileContent.mockClear()
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
    expect(Object.keys(unzipped).sort()).toEqual(['.typsmthng/project.json', 'img.png', 'main.typ'])
  })

  it('dedupes colliding .tex/.typ paths on import', async () => {
    const zipped = zipSync({
      'main.tex': asciiBytes('\\begin{document}From tex\\end{document}'),
      'main.typ': asciiBytes('= From typ'),
    })

    const result = await importProject(makeZipFileLike('Dup.zip', zipped))
    const project = mocked.state.projects[0]
    expect(project.files.map((f) => f.path).sort()).toEqual(['/main-2.typ', '/main.tex', '/main.typ'])
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
    expect(Object.keys(byPath).sort()).toEqual(['/main.tex', '/main.typ', '/shared-2.typ', '/shared.tex', '/shared.typ'])
    expect(byPath['/main.typ']).toContain('#include "shared.typ"')
    expect(byPath['/shared.typ']).toContain('Converted shared')
    expect(byPath['/shared-2.typ']).toContain('Native shared')
    expect(result?.warnings.some((w) => w.message.includes('/shared-2.typ'))).toBe(true)
  })

  it('flushes the live editor buffer into exported zips', async () => {
    const { useEditorStore } = await import('@/stores/editor-store')
    mocked.state.projects = [{
      id: 'p1',
      name: 'Live',
      files: [{ path: '/main.typ', content: '= stale store copy', isBinary: false, lastModified: 1 }],
      mainFile: '/main.typ',
      createdAt: 1,
      updatedAt: 1,
    }]
    mocked.state.currentProjectId = 'p1'
    mocked.state.currentFilePath = '/main.typ'
    useEditorStore.setState({ source: '= fresh typing', isDirty: true, saveStatus: 'unsaved' })

    await exportProject()

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(strFromU8(unzipped['main.typ'])).toBe('= fresh typing')

    vi.mocked(URL.createObjectURL).mockClear()
    await exportAllProjects()
    const allBlob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const allUnzipped = unzipSync(new Uint8Array(await allBlob.arrayBuffer()))
    expect(strFromU8(allUnzipped['Live/main.typ'])).toBe('= fresh typing')

    useEditorStore.setState({ source: '', isDirty: false, saveStatus: 'saved' })
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
    expect(Object.keys(unzipped).sort()).toEqual(['.typsmthng/project.json', 'empty.bin', 'main.typ'])
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
      '/chapters/one.tex',
      '/chapters/one.typ',
      '/main.tex',
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
      '/chapters/one.tex',
      '/chapters/one.typ',
      '/main.tex',
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
    expect(Object.keys(unzipped).sort()).toEqual([
      'A_B-2/.typsmthng/project.json',
      'A_B-2/main.typ',
      'A_B/.typsmthng/project.json',
      'A_B/main.typ',
    ])
  })

  it('round-trips export then importProject', async () => {
    mocked.state.projects = [{
      id: 'p1',
      name: 'RoundTrip',
      files: [
        { path: '/main.typ', content: '= Round', isBinary: false, lastModified: 1 },
        { path: '/extra.typ', content: '== Extra', isBinary: false, lastModified: 1 },
        { path: '/.typsmthng/project.json', content: '{"user":true}', isBinary: false, lastModified: 1 },
        { path: '/.typsmthng/project.user.json', content: '{"also":"user"}', isBinary: false, lastModified: 1 },
      ],
      mainFile: '/extra.typ',
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
    expect(project.files.map((f) => f.path).sort()).toEqual([
      '/.typsmthng/project.json',
      '/.typsmthng/project.user.json',
      '/extra.typ',
      '/main.typ',
    ])
    expect(project.mainFile).toBe('/extra.typ')
    expect(project.files.find((file) => file.path === '/.typsmthng/project.json')?.content)
      .toBe('{"user":true}')
    expect(project.files.find((file) => file.path === '/.typsmthng/project.user.json')?.content)
      .toBe('{"also":"user"}')
  })

  it('preserves malformed or non-manifest files at the metadata path', async () => {
    for (const manifest of [
      '{not json',
      JSON.stringify({ version: 1, mainFile: '/missing.typ' }),
      JSON.stringify({ format: 'typsmthng-project', version: 1, mainFile: '/missing.typ' }),
      JSON.stringify({ format: 'typsmthng-project', version: 1, mainFile: '/../main.typ' }),
    ]) {
      mocked.state.projects = []
      const zipped = zipSync({
        '.typsmthng/project.json': asciiBytes(manifest),
        'main.typ': asciiBytes('= Main'),
        'other.typ': asciiBytes('= Other'),
        'asset.bin': new Uint8Array([1]),
      })

      await importProject(makeZipFileLike('Generic.zip', zipped))
      const project = mocked.state.projects[0]
      expect(project.mainFile).toBe('/main.typ')
      expect(project.files.find((file) => file.path === '/.typsmthng/project.json')?.content)
        .toBe(manifest)
    }
  })

  it('round-trips exportAllProjects through importAllProjects with collisions and binaries', async () => {
    const imageBytes = new Uint8Array([9, 8, 7])
    mocked.state.projects = [
      {
        id: 'p1',
        name: 'A/B',
        files: [
          { path: '/main.typ', content: '= One', isBinary: false, lastModified: 1 },
          { path: '/img.png', content: '', isBinary: true, binaryData: imageBytes, lastModified: 1 },
        ],
        mainFile: '/main.typ',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'p2',
        name: 'A_B',
        files: [
          { path: '/main.typ', content: '= Helper', isBinary: false, lastModified: 1 },
          { path: '/paper.typ', content: '= Two', isBinary: false, lastModified: 1 },
          { path: '/.typsmthng/project.json', content: '{"keep":"me"}', isBinary: false, lastModified: 1 },
        ],
        mainFile: '/paper.typ',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'p3',
        name: 'A-2',
        files: [{
          path: '/main.tex',
          content: '\\begin{document}TeX\\end{document}',
          isBinary: false,
          lastModified: 1,
        }],
        mainFile: '/main.tex',
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    await exportAllProjects()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const zipped = new Uint8Array(await blob.arrayBuffer())
    const exportedKeys = Object.keys(unzipSync(zipped)).sort()
    expect(exportedKeys).toEqual([
      'A-2/.typsmthng/project.json',
      'A-2/main.tex',
      'A_B-2/.typsmthng/project.json',
      'A_B-2/.typsmthng/project.user.json',
      'A_B-2/main.typ',
      'A_B-2/paper.typ',
      'A_B/.typsmthng/project.json',
      'A_B/img.png',
      'A_B/main.typ',
    ])

    mocked.state.projects = []
    mocked.state.currentProjectId = null
    mocked.state.hasSelectedProject = true
    mocked.createProject.mockClear()

    const imported = await importAllProjects(makeZipFileLike('all.zip', zipped))
    expect(imported).toBe(3)
    expect(mocked.state.hasSelectedProject).toBe(false)
    expect(mocked.state.currentProjectId).toBeNull()

    const byName = Object.fromEntries(mocked.state.projects.map((p) => [p.name, p]))
    expect(Object.keys(byName).sort()).toEqual(['A-2', 'A/B', 'A_B'])
    expect(byName['A/B'].files.find((f) => f.path === '/img.png')?.binaryData).toEqual(imageBytes)
    expect(byName['A_B'].mainFile).toBe('/paper.typ')
    expect(byName['A_B'].files.find((file) => file.path === '/.typsmthng/project.json')?.content)
      .toBe('{"keep":"me"}')
    expect(byName['A-2'].files.map((f) => f.path)).toEqual(['/main.tex'])
    expect(byName['A-2'].mainFile).toBe('/main.tex')
  })

  it('merges LaTeX metadata across files and keeps zip name for importProject', async () => {
    const zipped = zipSync({
      'Paper/main.tex': asciiBytes('\\title{Keep Me}\\usepackage{amsmath}\\begin{document}A\\end{document}'),
      'Paper/meta.tex': asciiBytes('\\author{Only Author}\\usepackage{graphicx}\\begin{document}B\\end{document}'),
    })

    const latex = await importLatexZip(makeZipFileLike('Paper.zip', zipped))
    expect(latex.metadata.title).toBe('Keep Me')
    expect(latex.metadata.author).toBe('Only Author')
    expect(latex.metadata.packages).toEqual(expect.arrayContaining(['amsmath', 'graphicx']))
    expect(latex.projectName).toBe('Keep Me')

    mocked.state.projects = []
    mocked.createProject.mockClear()
    await importProject(makeZipFileLike('PaperArchive.zip', zipped))
    expect(mocked.createProject).toHaveBeenCalledWith(
      'Paper',
      expect.objectContaining({ mainFile: '/main.typ' }),
    )
  })

  it('names importLatexProject from title, filename, or multi-file fallback', async () => {
    const titled = await importLatexProject([{
      relativePath: 'doc.tex',
      file: { name: 'doc.tex', text: async () => '\\title{Named}\\begin{document}x\\end{document}' } as File,
    }])
    expect(titled.projectName).toBe('Named')

    mocked.state.projects = []
    const untitled = await importLatexProject([{
      relativePath: 'paper.tex',
      file: { name: 'paper.tex', text: async () => '\\begin{document}x\\end{document}' } as File,
    }])
    expect(untitled.projectName).toBe('paper')

    mocked.state.projects = []
    const multi = await importLatexProject([
      {
        relativePath: 'a.tex',
        file: { name: 'a.tex', text: async () => '\\begin{document}a\\end{document}' } as File,
      },
      {
        relativePath: 'b.tex',
        file: { name: 'b.tex', text: async () => '\\begin{document}b\\end{document}' } as File,
      },
    ])
    expect(multi.projectName).toBe('LaTeX Import (2 files)')

    await expect(importLatexProject([])).rejects.toThrow('No files found to import')
  })

  it('skips __MACOSX junk and rejects invalid zip archives', async () => {
    const zipped = zipSync({
      'main.typ': asciiBytes('= Ok'),
      '__MACOSX/._main.typ': asciiBytes('junk'),
      '.DS_Store': asciiBytes('junk'),
    })
    await importProject(makeZipFileLike('Clean.zip', zipped))
    expect(mocked.state.projects[0].files.map((f) => f.path)).toEqual(['/main.typ'])

    await importProject(makeZipFileLike('bad.zip', new Uint8Array([1, 2, 3, 4])))
    expect(window.alert).toHaveBeenCalled()
    await expect(importAllProjects(makeZipFileLike('bad.zip', new Uint8Array([1, 2, 3])))).rejects.toThrow(
      'valid zip archive',
    )
  })
})

describe('multifile import fidelity', () => {
  beforeEach(() => {
    mocked.state.projects = []
    mocked.state.currentProjectId = null
    mocked.state.currentFilePath = null
    mocked.state.failPersistNames = []
    mocked.createProject.mockClear()
    vi.restoreAllMocks()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('resolves nested TeX includes, bibliography and extensionless images from the document root', async () => {
    const main = '\\documentclass{article}\n\\begin{document}\n\\input{chapters/intro}\n\\end{document}'
    const intro = '\\section{Introduction}\n\\input{chapters/details}\n\\includegraphics{figures/chart}\n\\bibliography{refs/library}'
    const image = new Uint8Array([137, 80, 78, 71])
    const result = await importLatexZip(makeZipFileLike('Paper.zip', zipSync({
      'Paper/main.tex': asciiBytes(main),
      'Paper/chapters/intro.tex': asciiBytes(intro),
      'Paper/chapters/details.tex': asciiBytes('Nested detail.'),
      'Paper/figures/chart.png': image,
      'Paper/refs/library.bib': asciiBytes('@article{key,title={Title},author={Author},year={2026}}'),
    })))
    const project = mocked.state.projects[0]
    const content = project.files.find((file) => file.path === '/chapters/intro.typ')?.content
    expect(content).toContain('#include "details.typ"')
    expect(content).toContain('#image("../figures/chart.png")')
    expect(content).toContain('#bibliography("../refs/library.bib")')
    expect(project.files.find((file) => file.path === '/main.tex')?.content).toBe(main)
    expect(project.files.find((file) => file.path === '/chapters/intro.tex')?.content).toBe(intro)
    expect(project.files.find((file) => file.path === '/figures/chart.png')?.binaryData).toEqual(image)
    expect(result.warnings).toEqual([])
  })

  it('chooses the document root before an alphabetically earlier helper and keeps its metadata', async () => {
    const result = await importLatexZip(makeZipFileLike('Thesis.zip', zipSync({
      'macros.tex': asciiBytes('\\title{Wrong auxiliary title}'),
      'chapters/intro.tex': asciiBytes('Intro'),
      'submission.tex': asciiBytes('\\documentclass{article}\\title{Actual title}\\begin{document}\\input{chapters/intro}\\end{document}'),
    })))
    expect(mocked.state.projects[0].mainFile).toBe('/submission.typ')
    expect(result.projectName).toBe('Actual title')
  })

  it('distinguishes case-sensitive TeX references and reserves native collision suffixes', async () => {
    await importProject(makeZipFileLike('Collision.zip', zipSync({
      'one.tex': asciiBytes('First'),
      'one.TEX': asciiBytes('Second'),
      'one-2.typ': asciiBytes('Native suffix'),
      'main.tex': asciiBytes('\\begin{document}\\input{one.tex}\\input{one.TEX}\\end{document}'),
    })))
    const project = mocked.state.projects[0]
    const content = project.files.find((file) => file.path === '/main.typ')?.content
    expect(content).toContain('#include "one.typ"')
    expect(content).toContain('#include "one-3.typ"')
    expect(project.files.find((file) => file.path === '/one-2.typ')?.content).toBe('Native suffix')
    expect(project.files.find((file) => file.path === '/one-3.typ')?.content).toContain('Second')
  })

  it('retargets native Typst references to displaced native files without changing converted references', async () => {
    await importProject(makeZipFileLike('Mixed.zip', zipSync({
      'shared.tex': asciiBytes('Converted'),
      'shared.typ': asciiBytes('Native'),
      'chapters/native.typ': asciiBytes('#include "../shared.typ"'),
      'main.tex': asciiBytes('\\begin{document}\\input{shared}\\end{document}'),
    })))
    const project = mocked.state.projects[0]
    expect(project.files.find((file) => file.path === '/chapters/native.typ')?.content).toBe('#include "../shared-2.typ"')
    expect(project.files.find((file) => file.path === '/main.typ')?.content).toContain('#include "shared.typ"')
  })

  it('warns about a missing dependency with the referring filename', async () => {
    const result = await importLatexZip(makeZipFileLike('Missing.zip', zipSync({
      'main.tex': asciiBytes('\\begin{document}\\input{absent}\\end{document}'),
    })))
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('"absent" referenced by /main.tex') }),
    ]))
  })

  it('keeps converted edits, original sources and all file classifications through repeated exports', async () => {
    await importProject(makeZipFileLike('Research.zip', zipSync({
      'main.tex': asciiBytes('\\begin{document}Original\\end{document}'),
      'library.bib': asciiBytes('@article{sample,title={Sample}}'),
    })))
    const project = mocked.state.projects[0]
    project.files.find((file) => file.path === '/main.typ')!.content = '= Edited Typst'
    project.files.push(
      { path: '/LICENSE', content: 'License text', isBinary: false, lastModified: 1 },
      { path: '/raw.txt', content: '', isBinary: true, binaryData: new Uint8Array([0, 255, 1]), lastModified: 1 },
      { path: '/notes.folder', content: 'Real file', isBinary: false, lastModified: 1 },
    )
    for (let round = 0; round < 2; round++) {
      vi.mocked(URL.createObjectURL).mockClear()
      await exportProject()
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
      mocked.state.projects = []
      const imported = await importProject(makeZipFileLike('RenamedArchive.zip', new Uint8Array(await blob.arrayBuffer())))
      const restored = mocked.state.projects[0]
      expect(imported?.texFilesConverted).toBe(0)
      expect(restored.name).toBe('Research')
      expect(restored.files.find((file) => file.path === '/main.typ')?.content).toBe('= Edited Typst')
      expect(restored.files.find((file) => file.path === '/main.tex')?.content).toContain('Original')
      expect(restored.files.find((file) => file.path === '/LICENSE')).toMatchObject({ isBinary: false, content: 'License text' })
      expect(restored.files.find((file) => file.path === '/raw.txt')?.binaryData).toEqual(new Uint8Array([0, 255, 1]))
      expect(restored.files.find((file) => file.path === '/notes.folder')?.content).toBe('Real file')
      expect(restored.files).toHaveLength(6)
    }
  })

  it('decodes folder-picked legacy text and UTF-16 source with the same rules as ZIP imports', async () => {
    const source = '\\begin{document}Hello\\end{document}'
    const utf16 = new Uint8Array(2 + source.length * 2)
    utf16.set([0xff, 0xfe])
    for (let index = 0; index < source.length; index++) utf16[2 + index * 2] = source.charCodeAt(index)
    const result = await importLatexProject([
      { relativePath: 'main.tex', file: makeZipFileLike('main.tex', utf16) },
      { relativePath: 'notes.txt', file: makeZipFileLike('notes.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9])) },
    ])
    expect(mocked.state.projects[0].files.find((file) => file.path === '/main.typ')?.content).toContain('Hello')
    expect(mocked.state.projects[0].files.find((file) => file.path === '/notes.txt')?.content).toBe('café')
    expect(result.warnings.some((warning) => warning.message.includes('Windows-1252'))).toBe(true)
  })

  it('preserves legitimate metadata-like names while rejecting unsafe paths', async () => {
    await importProject(makeZipFileLike('Paths.zip', zipSync({
      'main.typ': asciiBytes('Main'),
      'notes.DS_Store.txt': asciiBytes('Keep me'),
      'contains__MACOSX/data.txt': asciiBytes('Keep me too'),
      '../escape.typ': asciiBytes('Unsafe'),
      'C:/escape.typ': asciiBytes('Unsafe'),
      'bad\u0000name.typ': asciiBytes('Unsafe'),
      '__MACOSX/._main.typ': asciiBytes('Junk'),
    })))
    expect(mocked.state.projects[0].files.map((file) => file.path).sort()).toEqual([
      '/contains__MACOSX/data.txt', '/main.typ', '/notes.DS_Store.txt',
    ])
  })

  it('throws when a single imported project could not be saved', async () => {
    mocked.state.failPersistNames = ['Unsaved']
    await expect(importProject(makeZipFileLike('Unsaved.zip', zipSync({ 'main.typ': asciiBytes('Main') }))))
      .rejects.toThrow('Browser storage is full')
    await expect(importLatexZip(makeZipFileLike('Unsaved.zip', zipSync({ 'main.tex': asciiBytes('Text') }))))
      .rejects.toThrow('could not be saved')
  })

  it('prepares uploads without overwriting existing files and retargets their includes', async () => {
    const prepared = await prepareUploadedFiles([
      { relativePath: 'main.tex', file: makeZipFileLike('main.tex', asciiBytes('\\begin{document}\\input{chapters/intro}\\end{document}')) },
      { relativePath: 'chapters/intro.tex', file: makeZipFileLike('intro.tex', asciiBytes('Introduction')) },
    ], ['/main.typ', '/main.tex', '/chapters/intro.typ'])
    const paths = prepared.projectFiles.map((file) => file.path).sort()
    expect(paths).toEqual(['/chapters/intro-2.typ', '/chapters/intro.tex', '/main-2.tex', '/main-2.typ'])
    expect(prepared.projectFiles.find((file) => file.path === '/main-2.typ')?.content).toContain('#include "chapters/intro-2.typ"')
    expect(mocked.createProject).not.toHaveBeenCalled()
  })

  it('round-trips empty projects and empty folders using native metadata', async () => {
    mocked.state.projects = [
      { id: 'empty', name: 'Empty', files: [], mainFile: '', createdAt: 1, updatedAt: 1 },
      { id: 'folders', name: 'Folders', files: [
        { path: '/drafts/.folder', content: '', isBinary: false, lastModified: 1 },
        { path: '/main.typ', content: 'Main', isBinary: false, lastModified: 1 },
      ], mainFile: '/main.typ', createdAt: 1, updatedAt: 1 },
    ]
    await exportAllProjects()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    mocked.state.projects = []
    const imported = await importAllProjects(makeZipFileLike('backup.zip', new Uint8Array(await blob.arrayBuffer())))
    expect(imported).toBe(2)
    expect(mocked.state.projects.find((project) => project.name === 'Empty')).toMatchObject({ files: [], mainFile: '' })
    expect(mocked.state.projects.find((project) => project.name === 'Folders')?.files.map((file) => file.path).sort())
      .toEqual(['/drafts/.folder', '/main.typ'])
  })

  it('retargets bibliography tuples and code-mode references but leaves comments and strings alone', async () => {
    const source = [
      '#bibliography(("a.bib", "b.bib"))',
      '#let body = include "helper.typ"',
      '// #include "helper.typ"',
      '#let example = "include \\"helper.typ\\""',
    ].join('\n')
    const prepared = await prepareUploadedFiles([
      { relativePath: 'main.typ', file: makeZipFileLike('main.typ', asciiBytes(source)) },
      { relativePath: 'helper.typ', file: makeZipFileLike('helper.typ', asciiBytes('Body')) },
      { relativePath: 'a.bib', file: makeZipFileLike('a.bib', asciiBytes('@article{a,title={A}}')) },
      { relativePath: 'b.bib', file: makeZipFileLike('b.bib', asciiBytes('@article{b,title={B}}')) },
    ], ['/helper.typ', '/a.bib', '/b.bib'])
    const content = prepared.projectFiles.find((file) => file.path === '/main.typ')?.content
    expect(content).toContain('#bibliography(("a-2.bib", "b-2.bib"))')
    expect(content).toContain('#let body = include "helper-2.typ"')
    expect(content).toContain('// #include "helper.typ"')
    expect(content).toContain('#let example = "include \\"helper.typ\\""')
  })

  it('does not let unused or commented manual bibliographies change real bibliography citations', async () => {
    await importLatexZip(makeZipFileLike('Citations.zip', zipSync({
      'main.tex': asciiBytes('\\begin{document}\n% \\begin{thebibliography}\n\\cite{key}\\bibliography{refs}\\end{document}'),
      'unused.tex': asciiBytes('\\begin{thebibliography}{1}\\bibitem{other}Other\\end{thebibliography}'),
      'refs.bib': asciiBytes('@article{key,title={Title}}'),
    })))
    const content = mocked.state.projects[0].files.find((file) => file.path === '/main.typ')?.content
    expect(content).toContain('@key')
    expect(content).not.toContain('#link(label')
  })

  it('creates usable bibliography aliases without overwriting native .bib files or dropping sources', async () => {
    const bibtex = '@book{extended,title={Extended},author={Writer},year={2026}}'
    const upper = '@book{upper,title={Uppercase},author={Writer},year={2026}}'
    const result = await importLatexZip(makeZipFileLike('Aliases.zip', zipSync({
      'main.tex': asciiBytes('\\documentclass{article}\\usepackage{biblatex}\\addbibresource{refs/library.bibtex}\\addbibresource{refs/OTHER.BIB}\\begin{document}\\cite{extended}\\cite{upper}\\printbibliography\\end{document}'),
      'refs/library.bibtex': asciiBytes(bibtex),
      'refs/library.bib': asciiBytes('@book{native,title={Preserve}}'),
      'refs/OTHER.BIB': asciiBytes(upper),
    })))
    const project = mocked.state.projects[0]
    const content = project.files.find((file) => file.path === '/main.typ')?.content
    expect(content).toContain('#bibliography(("refs/library-2.bib", "refs/OTHER.bib"))')
    expect(project.files.find((file) => file.path === '/refs/library.bibtex')?.content).toBe(bibtex)
    expect(project.files.find((file) => file.path === '/refs/library-2.bib')?.content).toBe(bibtex)
    expect(project.files.find((file) => file.path === '/refs/library.bib')?.content).toContain('Preserve')
    expect(project.files.find((file) => file.path === '/refs/OTHER.BIB')?.content).toBe(upper)
    expect(project.files.find((file) => file.path === '/refs/OTHER.bib')?.content).toBe(upper)
    expect(result.warnings).toEqual([])
  })
})
