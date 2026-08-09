import { describe, it, expect, vi, beforeEach } from 'vitest'
import { convertLatexToTypst } from '@/lib/latex-converter'
import {
  looksLikeImportableProject,
  normalizeSingleProjectZipEntries,
  importProject,
  exportProject,
  importLatexProject,
} from '@/lib/project-io'
import { zipSync, unzipSync, strToU8 } from 'fflate'

const mocked = vi.hoisted(() => {
  const state: {
    projects: Array<{
      id: string
      name: string
      files: Array<{ path: string; content: string; isBinary: boolean; binaryData?: Uint8Array; lastModified: number }>
      mainFile: string
    }>
    currentProjectId: string | null
  } = { projects: [], currentProjectId: null }

  const createProject = vi.fn(async (name: string, scaffold?: {
    files: Array<{ path: string; content: string; isBinary: boolean; binaryData?: Uint8Array }>
    mainFile: string
  }) => {
    const id = `p-${state.projects.length + 1}`
    state.projects.push({
      id,
      name,
      files: (scaffold?.files ?? []).map((f) => ({ ...f, lastModified: 1 })),
      mainFile: scaffold?.mainFile ?? '/main.typ',
    })
    state.currentProjectId = id
    return id
  })

  return { state, createProject }
})

vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({
      createProject: mocked.createProject,
      getCurrentProject: () => mocked.state.projects.find((p) => p.id === mocked.state.currentProjectId),
      projects: mocked.state.projects,
    }),
    setState: () => {},
  },
}))

function asciiBytes(text: string): Uint8Array {
  return new Uint8Array(Array.from(text, (ch) => ch.charCodeAt(0)))
}

describe('remaining bugs after recent fixes', () => {
  beforeEach(() => {
    mocked.state.projects = []
    mocked.state.currentProjectId = null
    mocked.createProject.mockClear()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('bibliography .bibtex becomes .bibtex.bib', async () => {
    const r = await convertLatexToTypst(String.raw`\begin{document}\bibliography{refs.bibtex}\end{document}`)
    expect(r.typst).toContain('#bibliography("refs.bibtex.bib")')
  })

  it('comma-separated bibliography stays invalid', async () => {
    const r = await convertLatexToTypst(String.raw`\begin{document}\bibliography{refs,extra}\end{document}`)
    expect(r.typst).toContain('#bibliography("refs,extra.bib")')
  })

  it('href/url quotes and brackets are not escaped', async () => {
    const r = await convertLatexToTypst(String.raw`\begin{document}\href{https://ex.com/a"b}{te]xt}\url{https://ex.com/c"d}\end{document}`)
    expect(r.typst).toContain('#link("https://ex.com/a"b")[te]xt]')
    expect(r.typst).toContain('#link("https://ex.com/c"d")')
  })

  it('nested .typ alone still counts as importable (unwrap asymmetry)', () => {
    expect(looksLikeImportableProject(['docs/notes.typ', 'photos/a.png'])).toBe(true)
    expect(looksLikeImportableProject(['docs/notes.tex', 'photos/a.png'])).toBe(false)
  })

  it('extensionless includegraphics keeps bare name', async () => {
    const r = await convertLatexToTypst(String.raw`\begin{document}\includegraphics{photo}\end{document}`)
    expect(r.typst).toContain('#image("photo")')
  })

  it('include path quotes are not escaped', async () => {
    const r = await convertLatexToTypst(String.raw`\begin{document}\input{foo"bar}\end{document}`)
    expect(r.typst).toContain('#include "foo"bar.typ"')
  })

  it('dedupe renames break rewritten include targets', async () => {
    const zipped = zipSync({
      'main.tex': asciiBytes('\\begin{document}\\input{shared}\\end{document}'),
      'shared.tex': asciiBytes('\\section{From tex}'),
      'shared.typ': asciiBytes('= From typ'),
    })
    const buffer = Uint8Array.from(zipped).buffer
    await importProject({ name: 'Dup.zip', arrayBuffer: async () => buffer } as File)
    const project = mocked.state.projects[0]
    const paths = project.files.map((f) => f.path).sort()
    expect(paths).toEqual(['/main.typ', '/shared-2.typ', '/shared.typ'])
    const main = project.files.find((f) => f.path === '/main.typ')!
    // include still points at shared.typ, but converted shared.tex landed on shared-2.typ
    expect(main.content).toContain('#include "shared.typ"')
    expect(project.files.find((f) => f.path === '/shared-2.typ')?.content).toContain('From tex')
  })

  it('export silently omits binary files with empty/missing bytes', async () => {
    mocked.state.projects = [{
      id: 'p1',
      name: 'BinGap',
      files: [
        { path: '/main.typ', content: '= X', isBinary: false, lastModified: 1 },
        { path: '/img.png', content: '', isBinary: true, lastModified: 1 },
        { path: '/ok.png', content: '', isBinary: true, binaryData: new Uint8Array([1, 2]), lastModified: 1 },
      ],
      mainFile: '/main.typ',
    }]
    mocked.state.currentProjectId = 'p1'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await exportProject()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(unzipped).sort()).toEqual(['main.typ', 'ok.png'])
  })

  it('folder import strips shared root for latex projects', async () => {
    await importLatexProject([
      {
        relativePath: 'Thesis/main.tex',
        file: { name: 'main.tex', text: async () => '\\begin{document}\\includegraphics{figs/a.png}\\end{document}', type: '' } as File,
      },
      {
        relativePath: 'Thesis/figs/a.png',
        file: {
          name: 'a.png',
          type: 'image/png',
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          text: async () => '',
        } as File,
      },
    ])
    const paths = mocked.state.projects[0].files.map((f) => f.path).sort()
    expect(paths).toEqual(['/figs/a.png', '/main.typ'])
  })

  it('unwraps wrapped archive that only has nested typ', () => {
    const unzipped = {
      'Photos/docs/notes.typ': strToU8('= Note'),
      'Photos/img.png': new Uint8Array([1, 2, 3]),
    } as unknown as ReturnType<typeof unzipSync>
    const normalized = normalizeSingleProjectZipEntries(unzipped, 'fallback')
    expect(normalized.projectName).toBe('Photos')
    expect(normalized.entries.map((e) => e.path).sort()).toEqual(['docs/notes.typ', 'img.png'])
  })
})
