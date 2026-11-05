// Run with Bun; CHROME_BIN selects a headless Chrome binary. BENCH_FILTER selects comma-separated workload names.
// Baseline packages are installed only in an automatically removed temp directory.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

const base = '28f671b5954804cd72728543eaae2df981a312fe'
const rounds = Number(process.env.BENCH_ROUNDS ?? 15)
const filter = process.env.BENCH_FILTER?.split(',') ?? []
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('BENCH_ROUNDS must be a positive integer')
let cancel
const cancelled = new Promise((_, reject) => { cancel = reject })
void cancelled.catch(() => {})
const interrupt = () => cancel(new Error('Benchmark interrupted'))
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
const deadline = setTimeout(() => cancel(new Error('Benchmark timed out')), 600000)
const root = path.resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(path.join(tmpdir(), 'byok-adapters-'))
let browser
let server
try {
  const lock = execFileSync('git', ['show', `${base}:bun.lock`], { cwd: root, encoding: 'utf8' })
  const versions = Object.fromEntries(['comlink', 'idb-keyval', 'vite', 'vite-plugin-wasm'].map(name => {
    const match = lock.match(new RegExp(`"${name}": \\["${name}@([^"\\s]+)"`))
    if (!match) throw new Error(`No committed resolution for ${name}`)
    return [name, match[1]]
  }))
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true, dependencies: versions }))
  execFileSync(process.execPath, ['install', '--ignore-scripts'], { cwd: temporary, stdio: 'pipe' })
  const viteVersion = (await Bun.file(path.join(root, 'node_modules/vite/package.json')).json()).version
  const syntaxVersion = (await Bun.file(path.join(root, 'node_modules/codemirror-lang-typst/package.json')).json()).version
  if (viteVersion !== versions.vite || !lock.includes('"codemirror-lang-typst@' + syntaxVersion + '"')) {
    throw new Error('WASM fixture dependencies differ from the committed baseline')
  }
  const fixture = path.join(temporary, 'syntax-entry.js')
  await writeFile(fixture, 'export { TypstWasmParser } from ' + JSON.stringify(path.join(root, 'node_modules/codemirror-lang-typst/wasm/typst_syntax.js')))
  const editorFixture = path.join(temporary, 'editor-entry.js')
  await writeFile(editorFixture, `import { EditorState } from ${JSON.stringify(path.join(root, 'node_modules/@codemirror/state/dist/index.js'))};
import { EditorView } from ${JSON.stringify(path.join(root, 'node_modules/@codemirror/view/dist/index.js'))};
import { typst } from ${JSON.stringify(path.join(root, 'node_modules/codemirror-lang-typst/dist/index.js'))};
export function checkEditor() {
  const initial = '= Title\\nHello 😀 $x^2$';
  const added = '\\n#let y = 2';
  const parent = document.createElement('div'); document.body.append(parent);
  const view = new EditorView({ state: EditorState.create({ doc: initial, extensions: [typst()] }), parent });
  try {
    view.dispatch({ changes: { from: initial.length, insert: added } });
    const result = { doc: view.state.doc.toString(), spans: view.dom.querySelectorAll('.cm-content span').length };
    if (result.doc !== initial + added || result.spans === 0) throw new Error('Editor parse/edit/highlight failed');
    return result;
  } finally { view.destroy(); parent.remove(); if (document.querySelector('.cm-editor')) throw new Error('Editor cleanup failed'); }
}`)
  const require = createRequire(import.meta.url)
  const wasmPlugin = require(path.join(temporary, 'node_modules/vite-plugin-wasm')).default
  const baselinePlugin = wasmPlugin()
  const originalLoad = baselinePlugin.load
  let wasmTransforms = 0
  baselinePlugin.load = async function(...args) {
    const result = await Reflect.apply(originalLoad, this, args)
    if (args[0].endsWith('.wasm') && result !== undefined) wasmTransforms += 1
    return result
  }
  const wasmHashes = {}
  for (const kind of ['baseline', 'candidate']) {
    await build({ configFile: false, root: temporary, base: '/wasm-' + kind + '/', logLevel: 'silent',
      plugins: kind === 'baseline' ? [baselinePlugin] : [wasmPlugin()],
      build: { target: 'es2022', minify: true, outDir: path.join(temporary, 'wasm-' + kind),
        rollupOptions: { input: { syntax: fixture, editor: editorFixture }, preserveEntrySignatures: 'strict', output: { entryFileNames: '[name].js' } },
      },
    })
    const directory = path.join(temporary, 'wasm-' + kind)
    const assets = [...new Bun.Glob('**/*.wasm').scanSync({ cwd: directory })]
    if (assets.length !== 1) throw new Error('Expected one emitted syntax WASM asset')
    wasmHashes[kind] = new Bun.CryptoHasher('sha256').update(await Bun.file(path.join(directory, assets[0])).arrayBuffer()).digest('hex')
  }
  if (wasmTransforms !== 1 || wasmHashes.baseline !== wasmHashes.candidate) throw new Error('WASM fixture transform/bytes mismatch')
  const entry = path.join(temporary, 'adapters.js')
  await writeFile(entry, `export * as baselineStore from './node_modules/idb-keyval/dist/index.js';
export * as baselineRpc from './node_modules/comlink/dist/esm/comlink.mjs';
export * as candidateStore from ${JSON.stringify(path.join(temporary, 'node_modules/idb-keyval/dist/index.js'))};
export * as candidateRpc from ${JSON.stringify(path.join(root, 'src/lib/compiler-rpc.ts'))};`)
  const bundle = await Bun.build({ entrypoints: [entry], target: 'browser', minify: true })
  if (!bundle.success) throw new AggregateError(bundle.logs, 'Adapter bundle failed')
  const adapters = await bundle.outputs[0].text()
  const runner = await Bun.file(path.join(import.meta.dirname, 'dependency-adapter-workloads.mjs')).text()
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const file = new URL(request.url).pathname
    if (file === '/__syntax-worker') return new Response(new URL(request.url).searchParams.get('source'), {
      headers: { 'content-type': 'text/javascript' },
    })
    if (file.startsWith('/wasm-baseline/') || file.startsWith('/wasm-candidate/')) {
      return new Response(Bun.file(path.join(temporary, file.slice(1))))
    }
    return new Response(file === '/adapters.js' ? adapters : file === '/runner.js' ? runner : '<!doctype html>', {
      headers: { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' },
    })
  } })
  browser = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${temporary}/chrome`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const websocketUrl = await Promise.race([cancelled, new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000)
    browser.stderr.on('data', chunk => {
      output += chunk
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    browser.on('error', reject)
  })])
  const socket = new WebSocket(websocketUrl)
  await Promise.race([cancelled, new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })])
  let id = 0
  const pending = new Map()
  let loaded
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Page.loadEventFired') loaded?.()
    if (message.method === 'Runtime.consoleAPICalled') console.error(message.params.args.map(arg => arg.value).join(' '))
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    if (message.error) call.reject(new Error(JSON.stringify(message.error)))
    else call.resolve(message.result)
  }
  function send(method, params = {}, sessionId) {
    console.error('CDP', method)
    let timer
    return Promise.race([cancelled, new Promise((resolve, reject) => {
      const requestId = ++id
      pending.set(requestId, { resolve, reject })
      timer = setTimeout(() => { pending.delete(requestId); reject(new Error(method + ' timed out')) }, method === 'Runtime.evaluate' ? 600000 : 10000)
      socket.send(JSON.stringify({ id: requestId, method, params, sessionId }))
    })]).finally(() => clearTimeout(timer))
  }
  console.error('Chrome ready')
  const version = await send('Browser.getVersion')
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  const pageLoaded = new Promise(resolve => { loaded = resolve })
  await send('Page.navigate', { url: `http://127.0.0.1:${server.port}` }, sessionId)
  await Promise.race([pageLoaded, cancelled])
  console.error('Page ready; running compatibility and workloads')
  const result = await send('Runtime.evaluate', {
    expression: `import('/runner.js').then(module => module.run(${rounds}, ${JSON.stringify(filter)}))`,
    awaitPromise: true, returnByValue: true, timeout: 180000,
  }, sessionId)
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  console.log(JSON.stringify({ base, versions, wasm_probe: { syntax_version: syntaxVersion, baseline_transforms: wasmTransforms, wasm_sha256: wasmHashes.baseline, builds: 'Matched Vite production fixtures both retain the original WASM plugin; compatibility only, outside storage/RPC timings' }, environment: {
    bun: Bun.version, browser: version.product, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, rounds,
  }, ...result.result.value }, null, 2))
  socket.close()
  clearTimeout(deadline)
} finally {
  clearTimeout(deadline)
  if (browser?.pid) {
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = new Promise(resolve => browser.once('exit', resolve))
      browser.kill('SIGTERM')
      await exited
    }
  }
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
  server?.stop(true)
  await rm(temporary, { recursive: true, force: true })
}
