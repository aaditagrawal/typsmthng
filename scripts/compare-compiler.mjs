import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const [baselinePath, candidatePath] = process.argv.slice(2)
assert(baselinePath && candidatePath, 'Usage: bun scripts/compare-compiler.mjs baseline/report.json candidate/report.json')
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'))
assert(candidate.wasm_bytes < 25_000_000, 'Compiler must be strictly under 25 MB uncompressed')
for (const key of ['runtime', 'platform', 'arch', 'samples', 'warmup', 'font_hashes']) {
  assert.deepEqual(candidate[key], baseline[key], `Incomparable benchmark configuration: ${key}`)
}
assert.equal(candidate.artifacts.length, baseline.artifacts.length)
for (let i = 0; i < baseline.artifacts.length; i++) {
  for (const key of ['fixture', 'normalized_svg_sha256', 'pdf_sha256', 'pages', 'diagnostics', 'edit_hashes']) {
    assert.deepEqual(candidate.artifacts[i][key], baseline.artifacts[i][key],
      `${baseline.artifacts[i].fixture}: changed ${key}`)
  }
}
const comparisons = baseline.results.map((before, i) => {
  const after = candidate.results[i]
  assert.equal(after.fixture, before.fixture)
  return { fixture: before.fixture,
    unchanged_ratio: after.unchanged.median_ms / before.unchanged.median_ms,
    edit_ratio: after.edits.median_ms / before.edits.median_ms }
})
console.log(JSON.stringify({ parity: 'PDF bytes, normalized preview SVG, page dimensions, diagnostics, and every edited preview match',
  bytes: candidate.wasm_bytes, init_ratio: candidate.init_ms / baseline.init_ms, comparisons }, null, 2))
