import { beforeEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'

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
  } = {
    projects: [],
    currentProjectId: null,
    currentFilePath: null,
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
    state.currentFilePath = '/main.typ'
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
    }),
    setState: (updater: unknown) => {
      const next = typeof updater === 'function'
        ? (updater as (s: typeof mocked.state) => Partial<typeof mocked.state>)(mocked.state)
        : updater as Partial<typeof mocked.state>
      Object.assign(mocked.state, next)
    },
  },
}))

import { importProject } from '@/lib/project-io'

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
})
