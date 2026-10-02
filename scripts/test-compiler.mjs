// Exercise actual virtual files and package callbacks, including invalidation.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createTypstCompiler, loadFonts, initOptions, MemoryAccessModel } from '@myriaddreamin/typst.ts'

const { values } = parseArgs({ options: {
  module: { type: 'string', default: 'vendor/typst-compiler/compiler_bg.wasm' },
  wrapper: { type: 'string', default: 'vendor/typst-compiler/compiler.js' },
  fonts: { type: 'string', default: '.compiler-perf/fonts' },
  out: { type: 'string' },
} })
const fonts = readdirSync(values.fonts).sort().filter(name => /\.(otf|ttf)$/.test(name))
  .map(name => new Uint8Array(readFileSync(path.join(values.fonts, name))))
assert.equal(fonts.length, 17)
const access = new MemoryAccessModel()
const root = '/@memory/fetch/packages/preview/bench-helper/0.1.0'
const encode = text => new TextEncoder().encode(text)
access.insertFile(`${root}/typst.toml`, encode('[package]\nname="bench-helper"\nversion="0.1.0"\nentrypoint="lib.typ"\nauthors=["Bench"]\nlicense="MIT"\ndescription="Compiler fixture"'), new Date(0))
access.insertFile(`${root}/lib.typ`, encode('#let message = [Package helper]'), new Date(0))
const compiler = createTypstCompiler()
await compiler.init({
  getModule: () => ({ module_or_path: readFileSync(values.module) }),
  ...(values.wrapper ? { getWrapper: () => import(pathToFileURL(path.resolve(values.wrapper)).href) } : {}),
  beforeBuild: [loadFonts(fonts, { assets: false }), initOptions.withAccessModel(access),
    initOptions.withPackageRegistry({ resolve: () => root })],
})
const hashes = []
const hash = data => createHash('sha256').update(data).digest('hex')
async function pdf(name, inputs) {
  const result = await compiler.compile({ mainFilePath: '/main.typ', root: '/', format: 1, diagnostics: 'full', inputs })
  assert(result.result?.length, JSON.stringify(result.diagnostics))
  const digest = hash(result.result)
  hashes.push({ name, sha256: digest })
  return digest
}
compiler.addSource('/main.typ', '#set document(date: none)\n#import "@preview/bench-helper:0.1.0": message\n#message')
await pdf('package')
compiler.resetShadow()
compiler.addSource('/main.typ', '#set document(date: none)\n#include "body.typ"')
compiler.addSource('/body.typ', 'Original dependency')
const original = await pdf('import')
compiler.addSource('/body.typ', 'Changed dependency')
assert.notEqual(await pdf('changed-import'), original)
compiler.unmapShadow('/body.typ')
const invalid = await compiler.compile({ mainFilePath: '/main.typ', root: '/', diagnostics: 'full' })
assert(!invalid.result)
assert(invalid.diagnostics?.some(d => d.severity === 'error'))
compiler.addSource('/body.typ', 'Restored dependency')
await pdf('restored-import')
compiler.resetShadow()
compiler.addSource('/main.typ', '#set document(date: none)\n#image("image.svg")')
const image = color => encode(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="${color}"/></svg>`)
compiler.mapShadow('/image.svg', image('red'))
const red = await pdf('red-image')
compiler.mapShadow('/image.svg', image('blue'))
assert.notEqual(await pdf('blue-image'), red)
compiler.resetShadow()
compiler.addSource('/main.typ', '#set document(date: none)\n#sys.inputs.at("title")')
const firstInput = await pdf('first-input', { title: 'First input' })
assert.notEqual(await pdf('second-input', { title: 'Second input' }), firstInput)
const report = { hashes, missing_file_diagnostics: invalid.diagnostics }
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
