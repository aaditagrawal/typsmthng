// Real vector-export checks for cache eviction and immutable font identity.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createTypstCompiler, createTypstFontBuilder, createTypstRenderer, loadFonts } from '@myriaddreamin/typst.ts'
import { normalizeCompilerSvg } from './compiler-artifacts.mjs'

const { values } = parseArgs({ options: {
  module: { type: 'string', default: 'vendor/typst-compiler/compiler_bg.wasm' },
  wrapper: { type: 'string', default: 'vendor/typst-compiler/compiler.js' },
  out: { type: 'string' },
} })
const options = {
  getModule: () => ({ module_or_path: readFileSync(values.module) }),
  getWrapper: () => import(pathToFileURL(path.resolve(values.wrapper)).href),
}
const fontsFolder = '.compiler-perf/fonts'
const fonts = readdirSync(fontsFolder).sort().filter(name => /\.(otf|ttf)$/.test(name))
  .map(name => new Uint8Array(readFileSync(path.join(fontsFolder, name))))
const compiler = createTypstCompiler()
await compiler.init({ ...options, beforeBuild: [loadFonts(fonts, { assets: false })] })
const renderer = createTypstRenderer()
await renderer.init({ getModule: () => ({ module_or_path: readFileSync(
  'node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm',
) }) })
const hashes = []
async function preview(name, source) {
  compiler.addSource('/main.typ', source)
  const result = await compiler.compile({ mainFilePath: '/main.typ', root: '/', diagnostics: 'full' })
  assert(result.result?.length, JSON.stringify(result.diagnostics))
  let svg
  await renderer.runWithSession({ format: 'vector', artifactContent: result.result }, async session => {
    svg = await session.renderSvg({})
  })
  const digest = createHash('sha256').update(normalizeCompilerSvg(svg)).digest('hex')
  hashes.push({ name, sha256: digest, diagnostics: result.diagnostics ?? [] })
  return digest
}
const source = '#set text(font: "DejaVu Sans Mono")\nAAAA *AAAA* _AAAA_'
const before = await preview('before-churn', source)
const chars = JSON.parse(readFileSync('.compiler-perf/cache-churn-characters.json', 'utf8'))
await preview('cache-churn', '#set text(font: "DejaVu Sans Mono", size: 8pt)\n#text(' + JSON.stringify(chars) + ')')
assert.equal(await preview('after-churn', source), before, 'Eviction changed a preview')
async function replaceFonts(file) {
  const builder = createTypstFontBuilder()
  await builder.init(options)
  await builder.addFontData(new Uint8Array(readFileSync(file)))
  await builder.build(async fonts => { compiler.setFonts(fonts) })
}
const plain = '#set text(font: "DejaVu Sans Mono")\nAAAA'
await replaceFonts(path.join(fontsFolder, 'DejaVuSansMono.ttf'))
const original = await preview('original-font', plain)
await replaceFonts('.compiler-perf/cache-modified-font.ttf')
assert.notEqual(await preview('changed-outline', plain), original, 'Font bytes changed but the cached outline did not')
await replaceFonts(path.join(fontsFolder, 'DejaVuSansMono.ttf'))
assert.equal(await preview('restored-font', plain), original, 'Restoring font bytes changed the preview')
const report = { mapped_characters: chars.split(' ').length, hashes }
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
