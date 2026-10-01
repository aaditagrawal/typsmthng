import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const folder = path.resolve(import.meta.dirname, '../vendor/typst-compiler')
const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'))
const installed = JSON.parse(readFileSync(path.resolve(import.meta.dirname,
  '../node_modules/@myriaddreamin/typst-ts-web-compiler/package.json'), 'utf8'))
const bytes = readFileSync(path.join(folder, 'compiler_bg.wasm'))
const hash = data => createHash('sha256').update(data).digest('hex')
assert(bytes.length < 25_000_000, `Compiler exceeds strict 25 MB cap: ${bytes.length}`)
assert.equal(bytes.length, manifest.wasmBytes)
assert.equal(hash(bytes), manifest.wasmSha256, 'Compiler binary differs from its manifest')
assert.equal(hash(readFileSync(path.join(folder, 'compiler.js'))), manifest.wrapperSha256,
  'Compiler bindings differ from their manifest')
assert.equal(installed.version, manifest.version, 'Compiler package upgrade requires rebuilding the local WASM')
const packageBytes = ['compiler_bg.wasm', 'compiler.js', 'compiler.d.ts', 'compiler_bg.wasm.d.ts', 'LICENSE']
  .reduce((total, name) => total + readFileSync(path.join(folder, name)).length, 0)
assert.equal(packageBytes, manifest.packageBytes)
assert(packageBytes < 25_000_000, 'Compiler and bindings exceed the 25 MB budget')
assert(WebAssembly.validate(bytes), 'Invalid compiler WASM')
if (process.argv.includes('--dist')) {
  const assets = path.resolve(import.meta.dirname, '../dist/assets')
  const modules = readdirSync(assets).filter(name => /^compiler_bg-.*\.wasm$/.test(name))
  assert.equal(modules.length, 1, 'Expected exactly one local compiler asset')
  assert.equal(hash(readFileSync(path.join(assets, modules[0]))), manifest.wasmSha256,
    'Production compiler differs from the verified module')
  const sw = readFileSync(path.resolve(import.meta.dirname, '../dist/sw.js'), 'utf8')
  const precache = sw.match(/precacheAndRoute\(\[([\s\S]*?)\]/)?.[1]
  assert(precache, 'Service worker precache was not found')
  assert(!precache.includes(modules[0]), 'Compiler must stay out of the home precache')
  assert(sw.includes('typst-compiler-local-wasm'), 'Missing offline compiler runtime cache')
}
console.log(`Compiler verified: ${bytes.length.toLocaleString('en-US')} bytes, under 25,000,000`)
