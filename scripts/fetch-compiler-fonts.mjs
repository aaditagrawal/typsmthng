// Cache the app's exact font inputs outside timed benchmark regions.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { _resolveAssets } from '../node_modules/@myriaddreamin/typst.ts/dist/esm/options.init.mjs'

const folder = path.resolve(import.meta.dirname, '../.compiler-perf/fonts')
const baseline = JSON.parse(readFileSync(path.resolve(import.meta.dirname,
  '../docs/benchmarks/compiler-2026-10-01/round1-baseline.json'), 'utf8'))
const expected = new Map(baseline.font_hashes.map(font => [font.name, font.sha256]))
mkdirSync(folder, { recursive: true })
for (const url of _resolveAssets({ assets: ['text'] })) {
  const name = url.split('/').pop()
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  assert(response.ok, `Cannot fetch ${name}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.get(name), `Font changed: ${name}`)
  writeFileSync(path.join(folder, name), bytes)
}
console.log(`Cached and verified ${expected.size} app fonts in ${folder}`)
