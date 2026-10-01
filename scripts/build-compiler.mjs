// Rebuild the pinned compiler with all original web,misc capabilities.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const root = path.resolve(import.meta.dirname, '..')
const commit = 'af2047eb986155ca5171a2370db359e5f4aa1404'
const version = '0.7.0-rc2'
const { values } = parseArgs({ options: {
  'opt-level': { type: 'string', default: '3' },
  optimizer: { type: 'string', default: '-Oz' },
  out: { type: 'string', default: 'vendor/typst-compiler' },
} })
assert(['3', 's', 'z'].includes(values['opt-level']))
assert(['-O3', '-Os', '-Oz', 'none'].includes(values.optimizer))
const source = path.join(root, '.compiler-perf/typst-ts')
const target = path.join(root, '.compiler-perf', `build-${values['opt-level']}`)
const output = path.resolve(root, values.out)
const sha256 = data => createHash('sha256').update(data).digest('hex')
const patchFolder = path.join(root, 'scripts/compiler-patches')
const patches = readdirSync(patchFolder).filter(name => name.endsWith('.patch')).sort()
  .map(name => ({ name, sha256: sha256(readFileSync(path.join(patchFolder, name))) }))
const patchPaths = patches.map(patch => path.join(patchFolder, patch.name))
assert(patchPaths.length > 0, 'Missing compiler source patches')
const env = { ...process.env, RUSTUP_TOOLCHAIN: process.env.COMPILER_RUST_TOOLCHAIN ?? 'stable', RUSTFLAGS: '',
  CARGO_PROFILE_RELEASE_OPT_LEVEL: values['opt-level'], CARGO_PROFILE_RELEASE_LTO: 'fat',
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '1', CARGO_PROFILE_RELEASE_PANIC: 'abort',
  CARGO_TARGET_DIR: target }
delete env.CARGO_ENCODED_RUSTFLAGS
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} failed: ${result.stderr ?? ''}`)
  return result.stdout?.trim()
}
const rustc = run('rustc', ['--version'], root, true)
assert(rustc.startsWith('rustc 1.98.1 '), `Expected rustc 1.98.1, got ${rustc}`)
const bindgen = process.env.WASM_BINDGEN ?? 'wasm-bindgen'
assert.equal(run(bindgen, ['--version'], root, true), 'wasm-bindgen 0.2.106')
const optimizer = process.env.WASM_OPT ?? 'wasm-opt'
const optimizerVersion = values.optimizer === 'none' ? null : run(optimizer, ['--version'], root, true)
assert(!optimizerVersion || optimizerVersion === 'wasm-opt version 133 (version_133)', optimizerVersion)
assert.equal(JSON.parse(readFileSync(path.join(root, 'node_modules/@myriaddreamin/typst-ts-web-compiler/package.json'))).version, version)
if (!existsSync(source)) {
  mkdirSync(path.dirname(source), { recursive: true })
  run('git', ['clone', '--depth', '1', '--branch', `v${version}`, 'https://github.com/Myriad-Dreamin/typst.ts.git', source])
}
assert.equal(run('git', ['rev-parse', 'HEAD'], source, true), commit)
assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no'], source, true), '', 'Compiler source has changes')
const command = ['build', '--locked', '-p', 'typst-ts-web-compiler', '--target', 'wasm32-unknown-unknown',
  '--release', '--no-default-features', '--features', 'web,misc']
run('git', ['apply', '--check', ...patchPaths], source)
run('git', ['apply', ...patchPaths], source)
try {
  run('cargo', command, source)
} finally {
  // Restore only our patches, even after a failed build. Never reset the checkout.
  run('git', ['apply', '--reverse', ...[...patchPaths].reverse()], source)
}
// Bindings and WASM always ship as one matched pair.
const staged = path.join(target, 'bindings')
run(bindgen, [path.join(target, 'wasm32-unknown-unknown/release/typst_ts_web_compiler.wasm'),
  '--target', 'web', '--out-dir', staged, '--out-name', 'compiler'])
const module = path.join(staged, 'compiler_bg.wasm')
const optimizerFlags = ['--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--enable-sign-ext',
  '--enable-reference-types', '--enable-multivalue', '--strip-debug', '--strip-producers']
if (values.optimizer !== 'none') {
  run(optimizer, [module, values.optimizer, ...optimizerFlags, '-o', path.join(staged, 'optimized.wasm')])
  copyFileSync(path.join(staged, 'optimized.wasm'), module)
}
const bytes = readFileSync(module)
assert(bytes.length < 25_000_000, `Raw compiler exceeds 25 MB: ${bytes.length} bytes`)
assert(WebAssembly.validate(bytes), 'Compiler is invalid for this runtime')
mkdirSync(output, { recursive: true })
const files = ['compiler.js', 'compiler.d.ts', 'compiler_bg.wasm', 'compiler_bg.wasm.d.ts']
for (const name of files) copyFileSync(path.join(staged, name), path.join(output, name))
copyFileSync(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'))
const packageBytes = [...files, 'LICENSE'].reduce((total, name) => total + readFileSync(path.join(output, name)).length, 0)
assert(packageBytes < 25_000_000, `Compiler and bindings exceed 25 MB: ${packageBytes} bytes`)
const manifest = { version, source: 'https://github.com/Myriad-Dreamin/typst.ts', commit,
  patches,
  rustc, bindings: 'wasm-bindgen 0.2.106', features: ['web', 'misc'],
  profile: { optLevel: values['opt-level'], lto: 'fat', codegenUnits: 1, panic: 'abort' },
  optimizer: optimizerVersion, optimizerFlags: values.optimizer === 'none' ? [] : [values.optimizer, ...optimizerFlags],
  sizeLimitBytes: 25_000_000, wasmBytes: bytes.length, wasmSha256: sha256(bytes),
  wrapperSha256: sha256(readFileSync(path.join(output, 'compiler.js'))),
  packageBytes,
  cargoCommand: ['cargo', ...command] }
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
