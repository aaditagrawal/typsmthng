import { gzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unescapeTomlString } from '@/lib/universe-registry'

const encoder = new TextEncoder()

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  const oct = value.toString(8)
  const padded = oct.padStart(length - 1, '0') + '\0'
  buf.set(encoder.encode(padded.slice(-length)), offset)
}

function writeString(buf: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value)
  buf.set(bytes.subarray(0, length), offset)
}

function checksum(header: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < header.length; i++) sum += header[i]
  return sum
}

function createTarGz(entries: Array<{ path: string; content: string }>): Uint8Array {
  const chunks: Uint8Array[] = []

  for (const entry of entries) {
    const data = encoder.encode(entry.content)
    const header = new Uint8Array(512)

    writeString(header, 0, 100, entry.path)
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, data.length)
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
    header.fill(0x20, 148, 156)
    header[156] = '0'.charCodeAt(0)
    writeString(header, 257, 6, 'ustar\0')
    writeString(header, 263, 2, '00')
    writeOctal(header, 148, 8, checksum(header))

    chunks.push(header)
    chunks.push(data)

    const remainder = data.length % 512
    if (remainder > 0) chunks.push(new Uint8Array(512 - remainder))
  }

  chunks.push(new Uint8Array(1024))

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const tar = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    tar.set(chunk, offset)
    offset += chunk.length
  }

  return gzipSync(tar)
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    keys: vi.fn(async () => Array.from(store.keys())),
    __store: store,
  }
})

describe('universe registry', () => {
  beforeEach(async () => {
    vi.resetModules()
    const idb = await import('idb-keyval') as unknown as { __store: Map<string, unknown> }
    idb.__store.clear()
    vi.restoreAllMocks()
  })

  it('resolves latest version from index for versionless specs', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: 'aero-check', version: '0.1.0' },
      { name: 'aero-check', version: '0.1.1' },
    ]), { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)

    const { resolveSpec } = await import('@/lib/universe-registry')
    const resolved = await resolveSpec('@preview/aero-check')

    expect(resolved).toEqual({ namespace: 'preview', name: 'aero-check', version: '0.1.1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('builds template scaffold from typst package archive', async () => {
    const archive = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "aero-check"\nversion = "0.1.1"\n\n[template]\npath = "template"\nentrypoint = "main.typ"\n',
      },
      {
        path: 'template/main.typ',
        content: '#import "@preview/aero-check:0.1.1": helper\n#import "@preview/ctheorems:1.1.2": *\n= Main\n#helper\n',
      },
      { path: 'template/refs.bib', content: '@book{x, title={X}}\n' },
      { path: 'lib.typ', content: '#let helper = [ok]\n' },
    ])

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('.tar.gz')) {
        return new Response(bytesToArrayBuffer(archive), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }))

    const { fetchTemplateScaffold } = await import('@/lib/universe-registry')
    const scaffold = await fetchTemplateScaffold({
      namespace: 'preview',
      name: 'aero-check',
      version: '0.1.1',
    })

    // typst init content_only: flatten template/ → project root; package lib stays out.
    expect(scaffold.mainFile).toBe('/main.typ')
    expect(scaffold.files.some((f) => f.path === '/main.typ')).toBe(true)
    expect(scaffold.files.some((f) => f.path === '/refs.bib')).toBe(true)
    expect(scaffold.files.some((f) => f.path === '/lib.typ')).toBe(false)
    expect(scaffold.files.some((f) => f.path === '/template/main.typ')).toBe(false)
    expect(scaffold.files.some((f) => f.path === '/.typsmthng/template.json')).toBe(true)
    const mainContent = scaffold.files.find((f) => f.path === '/main.typ' && !f.isBinary)?.content ?? ''
    expect(mainContent).toContain('@preview/ctheorems:1.1.3')
    expect(mainContent).not.toContain('@preview/ctheorems:1.1.2')
    expect(scaffold.templateMeta?.resolvedSpec).toBe('@preview/aero-check:0.1.1')
    expect(scaffold.templateMeta?.templateEntrypoint).toBe('main.typ')
  })

  it('prefetches recursive package imports for compile', async () => {
    const pkgA = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "pkg-a"\nversion = "1.0.0"\n',
      },
      { path: 'lib.typ', content: '#import "@preview/pkg-b:1.0.0": *\n= A\n' },
    ])

    const pkgB = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "pkg-b"\nversion = "1.0.0"\n',
      },
      { path: 'lib.typ', content: '= B\n' },
    ])

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('pkg-a-1.0.0.tar.gz')) return new Response(bytesToArrayBuffer(pkgA), { status: 200 })
      if (url.includes('pkg-b-1.0.0.tar.gz')) return new Response(bytesToArrayBuffer(pkgB), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))

    const { ensurePackagesForCompile, getPreparedPackageForResolver } = await import('@/lib/universe-registry')

    await ensurePackagesForCompile(['@preview/pkg-a:1.0.0'])

    expect(getPreparedPackageForResolver({ namespace: 'preview', name: 'pkg-a', version: '1.0.0' })).toBeDefined()
    expect(getPreparedPackageForResolver({ namespace: 'preview', name: 'pkg-b', version: '1.0.0' })).toBeDefined()
  })

  it('rewrites incompatible transitive package imports during package preparation', async () => {
    const springer = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "springer-spaniel"\nversion = "0.1.0"\n',
      },
      {
        path: 'lib.typ',
        content: [
          '#import "@preview/ctheorems:1.1.2": *',
          '#import "@preview/gentle-clues:0.9.0": *',
          '= S',
          '',
        ].join('\n'),
      },
    ])

    const ctheorems = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "ctheorems"\nversion = "1.1.3"\n',
      },
      { path: 'lib.typ', content: '= C\n' },
    ])

    const gentleClues = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "gentle-clues"\nversion = "1.2.0"\n',
      },
      { path: 'lib.typ', content: '= G\n' },
    ])

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('springer-spaniel-0.1.0.tar.gz')) return new Response(bytesToArrayBuffer(springer), { status: 200 })
      if (url.includes('ctheorems-1.1.3.tar.gz')) return new Response(bytesToArrayBuffer(ctheorems), { status: 200 })
      if (url.includes('gentle-clues-1.2.0.tar.gz')) return new Response(bytesToArrayBuffer(gentleClues), { status: 200 })
      if (url.includes('ctheorems-1.1.2.tar.gz')) return new Response(null, { status: 404 })
      if (url.includes('gentle-clues-0.9.0.tar.gz')) return new Response(null, { status: 404 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))

    const { ensurePackagesForCompile, getPreparedPackageForResolver } = await import('@/lib/universe-registry')
    await expect(ensurePackagesForCompile(['@preview/springer-spaniel:0.1.0'])).resolves.toBeUndefined()

    const springerPrepared = getPreparedPackageForResolver({
      namespace: 'preview',
      name: 'springer-spaniel',
      version: '0.1.0',
    })
    const springerLib = springerPrepared?.files.find((row) => row.path === 'lib.typ')?.textContent ?? ''
    expect(springerLib).toContain('@preview/ctheorems:1.1.3')
    expect(springerLib).not.toContain('@preview/ctheorems:1.1.2')
    expect(springerLib).toContain('@preview/gentle-clues:1.2.0')
    expect(springerLib).not.toContain('@preview/gentle-clues:0.9.0')

    expect(getPreparedPackageForResolver({
      namespace: 'preview',
      name: 'ctheorems',
      version: '1.1.3',
    })).toBeDefined()
    expect(getPreparedPackageForResolver({
      namespace: 'preview',
      name: 'gentle-clues',
      version: '1.2.0',
    })).toBeDefined()
  })

  it('ignores docs/example imports when prefetching runtime package dependencies', async () => {
    const pkgMain = createTarGz([
      {
        path: 'typst.toml',
        content: [
          '[package]',
          'name = "pkg-main"',
          'version = "1.0.0"',
          'entrypoint = "src/main.typ"',
          '',
        ].join('\n'),
      },
      { path: 'src/main.typ', content: '#import "deps.typ": *\n= Main\n' },
      { path: 'src/deps.typ', content: '#import "@preview/pkg-b:1.0.0": *\n' },
      { path: 'docs/manual.typ', content: '#import "@preview/o-rly-typst:0.1.1": *\n' },
    ])

    const pkgB = createTarGz([
      {
        path: 'typst.toml',
        content: '[package]\nname = "pkg-b"\nversion = "1.0.0"\n',
      },
      { path: 'lib.typ', content: '= B\n' },
    ])

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('pkg-main-1.0.0.tar.gz')) return new Response(bytesToArrayBuffer(pkgMain), { status: 200 })
      if (url.includes('pkg-b-1.0.0.tar.gz')) return new Response(bytesToArrayBuffer(pkgB), { status: 200 })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ensurePackagesForCompile } = await import('@/lib/universe-registry')
    await expect(ensurePackagesForCompile(['@preview/pkg-main:1.0.0'])).resolves.toBeUndefined()

    const fetchedOrly = fetchMock.mock.calls.some((call) => String(call[0]).includes('o-rly-typst'))
    expect(fetchedOrly).toBe(false)
  })

  it('searches marketplace packages and marks non-template entries as disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { name: 'aero-check', version: '0.1.0', template: { path: 'template', entrypoint: 'main.typ' } },
      { name: 'aero-check', version: '0.2.0', template: { path: 'template', entrypoint: 'main.typ' } },
      { name: 'academic-utils', version: '1.4.0' },
      { name: 'notes-kit', version: '2.0.0' },
    ]), { status: 200 })))

    const { searchUniverseMarketplace } = await import('@/lib/universe-registry')
    const templateResults = await searchUniverseMarketplace('ae')
    const templateResult = templateResults.find((row) => row.name === 'aero-check')
    expect(templateResult).toMatchObject({
      latestVersion: '0.2.0',
      isTemplate: true,
      latestResolvedSpec: '@preview/aero-check:0.2.0',
      initCommand: 'typst init @preview/aero-check:0.2.0',
    })

    const results = await searchUniverseMarketplace('ac')
    expect(results.map((row) => row.name)).toEqual(['academic-utils'])

    const nonTemplateResult = results.find((row) => row.name === 'academic-utils')
    expect(nonTemplateResult?.isTemplate).toBe(false)
    expect(nonTemplateResult?.disabledReason).toContain('does not expose a template scaffold')
  })

  it('does not fetch marketplace index for very short query strings', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { searchUniverseMarketplace } = await import('@/lib/universe-registry')
    const results = await searchUniverseMarketplace('a')

    expect(results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('unescapeTomlString', () => {
  it('unescapes sequences without corrupting literal backslash-n', () => {
    expect(unescapeTomlString('line\\nnext')).toBe('line\nnext')
    expect(unescapeTomlString('keep\\\\n')).toBe('keep\\n')
    expect(unescapeTomlString('quote\\"here')).toBe('quote"here')
  })
})
