// Real compiler API timings and artifacts for differential correctness checks.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createTypstCompiler, createTypstRenderer, loadFonts } from '@myriaddreamin/typst.ts'
import { normalizeCompilerSvg } from './compiler-artifacts.mjs'

const { values } = parseArgs({ options: {
  module: { type: 'string' }, wrapper: { type: 'string' },
  fonts: { type: 'string' }, out: { type: 'string' },
  samples: { type: 'string', default: '30' },
  'release-worlds': { type: 'boolean', default: false },
  'edit-location': { type: 'string', default: 'append' },
} })
assert(values.module && values.fonts && values.out, 'Required: --module --fonts --out')
const samples = Number(values.samples)
assert(Number.isInteger(samples) && samples > 0)
assert(['append', 'middle'].includes(values['edit-location']))
const hash = data => createHash('sha256').update(data).digest('hex')
const moduleBytes = readFileSync(values.module)
const fonts = readdirSync(values.fonts).sort().filter(name => /\.(otf|ttf)$/.test(name))
  .map(name => ({ name, bytes: new Uint8Array(readFileSync(path.join(values.fonts, name))) }))
assert.equal(fonts.length, 17, 'Use all 17 fonts loaded by the app')
// Freeze only the document clock. Timings use performance.now().
const RuntimeDate = Date
globalThis.Date = class extends RuntimeDate {
  constructor(...args) { super(...(args.length ? args : [0])) }
  static now() { return 0 }
}
const initStart = performance.now()
const compiler = createTypstCompiler()
await compiler.init({
  getModule: () => ({ module_or_path: moduleBytes }),
  ...(values.wrapper ? { getWrapper: () => import(pathToFileURL(path.resolve(values.wrapper)).href) } : {}),
  beforeBuild: [loadFonts(fonts.map(font => font.bytes), { assets: false })],
})
const initMs = performance.now() - initStart
const wrapper = values.wrapper ? await import(pathToFileURL(path.resolve(values.wrapper)).href)
  : await import('@myriaddreamin/typst-ts-web-compiler')
const wasm = await wrapper.default({ module_or_path: moduleBytes })
const initialMemory = wasm.memory.buffer.byteLength
const renderer = createTypstRenderer()
await renderer.init({ getModule: () => ({ module_or_path: readFileSync(
  'node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm',
) }) })
const fixtures = [
  { name: 'small', source: '= A document\nHello, *Typst*. $x^2 + y^2 = z^2$' },
  { name: 'large', source: '#set page(height: 280mm)\n' + Array.from({ length: 100 }, (_, i) =>
    `\n== Section ${i}\n${'A paragraph with *bold*, _italic_, and a #link("https://typst.app")[link]. '.repeat(8)}\n`).join('') },
  { name: 'math-table', source: '= Equations\n$ integral_0^1 x^2 dif x = 1/3 $\n$ mat(1, 2; 3, 4) $\n#table(columns: 3, [Name], [Value], [Result], [Alpha], [$sqrt(2)$], [Yes])' },
  { name: 'imports', source: '#import "lib.typ": title\n#title\n#include "body.typ"',
    files: { '/lib.typ': '#let title = [Imported title]', '/body.typ': 'Body from another file.' } },
  { name: 'image', source: '#image("image.svg", width: 30mm)', files: {
    '/image.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>',
  } },
  { name: 'bibliography', source: '= Sources\nCited @sample.\n#bibliography("refs.yml")', files: {
    '/refs.yml': 'sample:\n  type: Article\n  title: A sample article\n  author: Smith, Jane\n  date: 2024\n',
  } },
  { name: 'fonts', source: '#set text(font: "DejaVu Sans Mono")\nRegular, *bold*, _italic_, and *_both_*.\nGreek: αβγδ. Cyrillic: Привет. Accents: café naïve.\n#text(font: "Libertinus Serif")[Serif, *bold*, _italic_.]\n#text(font: "New Computer Modern")[Modern, *bold*, _italic_.]\n$ integral_0^1 sqrt(x) dif x = 2/3 $' },
]
mkdirSync(values.out, { recursive: true })
const stats = times => {
  const sorted = [...times].sort((a, b) => a - b)
  return { samples_ms: times, median_ms: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
const compile = () => values['release-worlds']
  ? compiler.runWithWorld({ mainFilePath: '/main.typ', root: '/' }, world => world.vector({ diagnostics: 'full' }))
  : compiler.compile({ mainFilePath: '/main.typ', root: '/', diagnostics: 'full' })
const artifacts = []
const results = []
function editedSource(source, index) {
  const edit = `\n\nUnique edit ${index}.\n`
  if (values['edit-location'] === 'append') return source + edit
  const newline = source.indexOf('\n', Math.floor(source.length / 2))
  const offset = newline < 0 ? source.length : newline + 1
  return source.slice(0, offset) + edit + source.slice(offset)
}
for (const fixture of fixtures) {
  compiler.resetShadow()
  compiler.addSource('/main.typ', fixture.source)
  for (const [name, source] of Object.entries(fixture.files ?? {})) compiler.addSource(name, source)
  const firstStart = performance.now()
  const first = await compile()
  const firstMs = performance.now() - firstStart
  assert(first.result?.length, JSON.stringify(first.diagnostics))
  const vectorHash = hash(first.result)
  writeFileSync(path.join(values.out, `${fixture.name}.vector`), first.result)
  let svg, pages
  await renderer.runWithSession({ format: 'vector', artifactContent: first.result }, async session => {
    pages = session.retrievePagesInfo().map(p => ({ width: p.width, height: p.height, pageOffset: p.pageOffset }))
    svg = await session.renderSvg({})
  })
  writeFileSync(path.join(values.out, `${fixture.name}.svg`), svg)
  const pdf = await compiler.compile({ mainFilePath: '/main.typ', root: '/', format: 1, diagnostics: 'full' })
  assert(pdf.result?.length, JSON.stringify(pdf.diagnostics))
  writeFileSync(path.join(values.out, `${fixture.name}.pdf`), pdf.result)
  const unchanged = [], edits = [], editHashes = []
  for (let i = 0; i < samples + 5; i++) {
    const start = performance.now()
    const result = await compile()
    const elapsed = performance.now() - start
    assert(result.result?.length, JSON.stringify(result.diagnostics))
    if (i >= 5) unchanged.push(elapsed)
  }
  for (let i = 0; i < samples + 5; i++) {
    const start = performance.now()
    compiler.addSource('/main.typ', editedSource(fixture.source, i))
    const result = await compile()
    const elapsed = performance.now() - start
    assert(result.result?.length, JSON.stringify(result.diagnostics))
    await renderer.runWithSession({ format: 'vector', artifactContent: result.result }, async session => {
      editHashes.push(hash(normalizeCompilerSvg(await session.renderSvg({}))))
    })
    if (i >= 5) edits.push(elapsed)
  }
  artifacts.push({ fixture: fixture.name, vector_sha256: vectorHash, svg_sha256: hash(svg),
    normalized_svg_sha256: hash(normalizeCompilerSvg(svg)),
    pdf_sha256: hash(pdf.result), pages, diagnostics: first.diagnostics ?? [], edit_hashes: editHashes })
  results.push({ fixture: fixture.name, first_compile_ms: firstMs, unchanged: stats(unchanged), edits: stats(edits) })
}
compiler.resetShadow()
compiler.addSource('/main.typ', '#let broken =')
const invalid = await compile()
assert(!invalid.result)
assert(invalid.diagnostics?.some(d => d.severity === 'error'))
artifacts.push({ fixture: 'invalid', diagnostics: invalid.diagnostics })
compiler.addSource('/main.typ', 'Recovered')
assert((await compile()).result?.length)
const report = { runtime: process.versions, platform: process.platform, arch: process.arch,
  edit_location: values['edit-location'],
  release_worlds: values['release-worlds'], initial_memory_bytes: initialMemory,
  final_memory_bytes: wasm.memory.buffer.byteLength,
  wasm_bytes: moduleBytes.length, wasm_sha256: hash(moduleBytes), init_ms: initMs,
  font_hashes: fonts.map(font => ({ name: font.name, sha256: hash(font.bytes) })),
  samples, warmup: 5, results, artifacts,
  scope: 'In-process compiler calls. Edits include source upload; network, worker transport, and output writes excluded. Startup and first compilation are single observations.' }
writeFileSync(path.join(values.out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ bytes: report.wasm_bytes, init_ms: initMs,
  results: results.map(r => ({ fixture: r.fixture, first_ms: r.first_compile_ms,
    unchanged_ms: r.unchanged.median_ms, edit_ms: r.edits.median_ms })) }, null, 2))
