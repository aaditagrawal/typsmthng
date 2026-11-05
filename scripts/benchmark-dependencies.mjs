// Run with Bun. Baseline packages live outside the project and never enter its lockfile.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir, cpus, totalmem, loadavg, platform, release } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const baselineDir = join(tmpdir(), 'typsmthng-app-maintenance-baseline-6.3.0-4.4.2')
await mkdir(baselineDir, { recursive: true })
await writeFile(join(baselineDir, 'package.json'), JSON.stringify({ private: true, dependencies: { 'idb-keyval': '6.3.0', comlink: '4.4.2' } }))
execFileSync(process.execPath, ['install', '--cwd', baselineDir, '--ignore-scripts', ...(await Bun.file(join(baselineDir, 'bun.lock')).exists() ? ['--frozen-lockfile'] : [])], { stdio: 'inherit' })
const lock = execFileSync('git', ['show', '34e26debaa014b789f034808c2d539d311a1698a:bun.lock'], { cwd: root, encoding: 'utf8' })
const lockedBaseline = Bun.JSON5.parse(lock)
const installedLock = Bun.JSON5.parse(await readFile(join(baselineDir, 'bun.lock'), 'utf8'))
const integrity = {}
for (const [name, version] of [['idb-keyval', '6.3.0'], ['comlink', '4.4.2']]) {
  if (!lock.includes(`"${name}@${version}"`)) throw new Error(`Baseline version mismatch: ${name}`)
  const expected = lockedBaseline.packages[name]
  const actual = installedLock.packages[name]
  if (expected?.[0] !== actual?.[0] || expected?.at(-1) !== actual?.at(-1)) throw new Error(`Baseline integrity mismatch: ${name}`)
  integrity[name] = expected.at(-1)
  const installed = JSON.parse(await readFile(join(baselineDir, 'node_modules', name, 'package.json'), 'utf8'))
  if (installed.version !== version) throw new Error(`Installed baseline version mismatch: ${name}`)
}
const fixtureDir = await mkdtemp(join(tmpdir(), 'typsmthng-app-maintenance-bench-'))
const imports = `import * as baselineIdb from ${JSON.stringify(join(baselineDir, 'node_modules/idb-keyval/dist/index.js'))};
import * as candidateIdb from ${JSON.stringify(join(root, 'src/lib/indexed-db.ts'))};
import * as baselineRpc from ${JSON.stringify(join(baselineDir, 'node_modules/comlink/dist/esm/comlink.mjs'))};
import * as candidateRpc from ${JSON.stringify(join(root, 'src/lib/compiler-rpc.ts'))};`
const workerPath = join(fixtureDir, 'worker.js')
await writeFile(workerPath, imports + `
const api = {
  initCompiler: async () => undefined,
  compileTypst: async (source, extras, path, binaries) => {
    if (source === 'error') throw new TypeError('fixture compile error');
    if (source === 'throw-value') throw { reason: 'fixture rejection', code: 17 };
    return { success: true, svg: source, vectorData: binaries?.[0]?.data ?? new Uint8Array(), pageDimensions: [], diagnostics: [] };
  },
  compileTypstIncremental: async (request) => ({ kind: 'result', result: { success: true, svg: request.textPayloads[0]?.content, vectorData: request.binaryPayloads[0]?.data ?? new Uint8Array(), diagnostics: [], pageDimensions: [] } }),
  resolveSourceLoc: async () => undefined,
  resolveSourceLocBatch: async () => [],
  compileToPdf: async () => ({ pdf: new Uint8Array([37,80,68,70]), diagnostics: [] }),
  ensurePackagesForCompile: async () => undefined,
  isCompilerReady: () => true,
};
self.addEventListener('message', function setup(event) {
  if (event.data?.setup !== true) return;
  self.removeEventListener('message', setup);
  if (event.data.mode === 'baseline') baselineRpc.expose(api, self);
  else candidateRpc.exposeCompilerRpc(api, self);
  self.postMessage({ ready: true });
});`)
async function bundle(path) {
  const result = await Bun.build({ entrypoints: [path], target: 'browser', format: 'iife', minify: false })
  if (!result.success) throw new Error(result.logs.join('\n'))
  return result.outputs[0].text()
}
const workerCode = await bundle(workerPath)
const browserPath = join(fixtureDir, 'browser.js')
await writeFile(browserPath, imports + `
const assert = (value, message) => { if (!value) throw new Error(message); };
const databaseName = 'dependency-bench-' + Date.now();
const stores = { baseline: baselineIdb.createStore(databaseName, 'records'), candidate: candidateIdb.createStore(databaseName, 'records') };
const idbs = { baseline: baselineIdb, candidate: candidateIdb };
const workers = {};
const clients = {};
const disposal = {};
const startup = {};
for (const mode of ['baseline', 'candidate']) {
  const start = performance.now();
  const url = URL.createObjectURL(new Blob([${JSON.stringify(workerCode)}], { type: 'text/javascript' }));
  const worker = workers[mode] = new Worker(url);
  await new Promise((resolve, reject) => {
    worker.onerror = reject;
    worker.onmessage = (event) => { if (event.data?.ready) resolve(); };
    worker.postMessage({ setup: true, mode });
  });
  worker.onmessage = null;
  URL.revokeObjectURL(url);
  if (mode === 'baseline') clients[mode] = baselineRpc.wrap(worker);
  else { const rpc = candidateRpc.createCompilerRpcClient(worker); clients[mode] = rpc.api; disposal[mode] = rpc.dispose; }
  await clients[mode].initCompiler();
  startup[mode] = performance.now() - start;
}
for (const mode of ['baseline', 'candidate']) {
  await idbs[mode].set('warmup', 'ready', stores[mode]);
}
const sizes = { incremental: 128 * 1024, 'incremental-large': 4 * 1024 * 1024, read: 128 * 1024, small: 256, typical: 128 * 1024, large: 4 * 1024 * 1024, concurrent: 4096, errors: 0 };
const payloads = {};
for (const [name, size] of Object.entries(sizes)) {
  const bytes = new Uint8Array(size);
  for (let i=0; i<size; i++) bytes[i] = i % 251;
  payloads[name] = { text: 'document '.repeat(Math.min(size, 65536) / 9), bytes };
}
await baselineIdb.set('read-hot', payloads.read, stores.baseline);
async function idbWorkload(mode, name, iterations) {
  const api = idbs[mode], store = stores[mode], payload = payloads[name];
  if (name === 'read') {
    for (let i=0; i<iterations; i++) { const loaded = await api.get('read-hot', store); assert(loaded.bytes.length === payload.bytes.length, 'hot read mismatch'); }
    return;
  }
  if (name === 'errors') {
    for (let i=0; i<iterations; i++) {
      let failed = false;
      try { await api.set('bad', () => {}, store); } catch (error) { failed = error.name === 'DataCloneError'; }
      assert(failed, 'structured clone failure must reject');
      failed = false;
      try { await api.get(NaN, store); } catch (error) { failed = error.name === 'DataError'; }
      assert(failed, 'invalid key must reject');
    }
    return;
  }
  for (let i=0; i<iterations; i++) {
    const count = name === 'concurrent' ? 16 : 1;
    await Promise.all(Array.from({ length: count }, async (_, index) => {
      const key = 'payload-' + index;
      await api.set(key, payload, store);
      const loaded = await api.get(key, store);
      assert(loaded.text === payload.text && loaded.bytes.length === payload.bytes.length && loaded.bytes.at(-1) === payload.bytes.at(-1), 'IDB payload mismatch');
    }));
    const keys = await api.keys(store);
    assert(keys.includes('payload-0'), 'enumeration mismatch');
  }
}
async function rpcWorkload(mode, name, iterations) {
  const api = clients[mode], payload = payloads[name];
  for (let i=0; i<iterations; i++) {
    if (name.startsWith('incremental')) {
      const request = {
        mainFilePath: '/main.typ',
        manifest: Array.from({ length: name === 'incremental' ? 50 : 500 }, (_, index) => ({ path: '/chapter-' + index + '.typ', digest: 'text:document-digest-' + index })),
        textPayloads: [{ path: '/main.typ', content: payload.text }],
        binaryPayloads: [{ path: '/image.bin', data: payload.bytes }],
        options: { wantSvg: false },
      };
      const response = await api.compileTypstIncremental(request);
      assert(response.kind === 'result' && response.result.svg === payload.text && response.result.vectorData.length === payload.bytes.length && response.result.vectorData.at(-1) === payload.bytes.at(-1), 'incremental payload mismatch');
      assert(payload.bytes.byteLength === sizes[name], 'incremental live binary detached');
      continue;
    }
    if (name === 'errors') {
      let failed = false;
      try { await api.compileTypst('error'); } catch (error) { failed = error.name === 'TypeError' && error.message === 'fixture compile error'; }
      assert(failed, 'RPC Error mismatch');
      failed = false;
      try { await api.compileTypst('throw-value'); } catch (error) { failed = error.code === 17; }
      assert(failed, 'RPC thrown value mismatch');
      continue;
    }
    const count = name === 'concurrent' ? 32 : 1;
    await Promise.all(Array.from({ length: count }, async () => {
      const result = await api.compileTypst(payload.text, undefined, '/main.typ', [{ path: '/image.bin', data: payload.bytes }]);
      assert(result.svg === payload.text && result.vectorData.length === payload.bytes.length && result.vectorData.at(-1) === payload.bytes.at(-1), 'RPC payload mismatch');
      assert(payload.bytes.byteLength === sizes[name], 'live project buffer detached');
    }));
  }
}
async function compatibility() {
  const api = candidateIdb, store = stores.candidate;
  const legacy = { files: [{ path: '/main.typ', content: 'legacy document' }], bytes: new Uint8Array([13, 42]) };
  await baselineIdb.set('legacy', legacy, stores.baseline);
  const migrated = await api.get('legacy', store);
  assert(migrated.files[0].content === legacy.files[0].content && migrated.bytes[1] === 42, 'baseline persisted records must load');
  await api.set('legacy', { ...legacy, changed: true }, store);
  assert((await baselineIdb.get('legacy', stores.baseline)).changed === true, 'baseline must read candidate records');
  await api.set('default-store', 'default');
  assert(await baselineIdb.get('default-store') === 'default', 'default database and store names');
  for (const method of ['put', 'delete']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
    let aborted = false;
    try {
      if (method === 'put') await api.set('aborted', 'must not commit', store);
      else await api.del('legacy', store);
    } catch (error) { aborted = error.name === 'AbortError'; }
    finally { IDBObjectStore.prototype[method] = original; }
    assert(aborted, method + ' must reject after successful request but failed commit');
  }
  assert(await api.get('aborted', store) === undefined && (await api.get('legacy', store)).changed, 'aborted transactions must roll back');
  const retryStore = api.createStore(databaseName + '-retry', 'records');
  const originalOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function () { throw new DOMException('temporary denial', 'SecurityError'); };
  let denied = false;
  try { await api.get('retry', retryStore); } catch (error) { denied = error.name === 'SecurityError'; }
  finally { IDBFactory.prototype.open = originalOpen; }
  assert(denied, 'open denial must reject');
  await api.set('retry', 42, retryStore);
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName + '-retry', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  assert(await api.get('retry', retryStore) === 42, 'versionchange closes and reopens connection');
  await api.set('binary', new Uint8Array([0,255,128]), store);
  const binary = await api.get('binary', store);
  assert(binary instanceof Uint8Array && binary[1] === 255, 'typed array persistence');
  binary[1] = 0;
  assert((await api.get('binary', store))[1] === 255, 'values must be cloned');
  await api.del('binary', store);
  assert(await api.get('binary', store) === undefined, 'delete must commit');
  const missing = api.createStore(databaseName, 'home');
  let failed = false;
  try { await api.get('home-meta', missing); } catch (error) { failed = error.name === 'NotFoundError'; }
  assert(failed, 'legacy missing store must not alter schema');
  const original = clients.candidate;
  assert(await original.isCompilerReady() === true, 'sync worker result');
  assert(await original.resolveSourceLoc(new Uint8Array([1]), new Uint32Array([2])) === undefined, 'undefined worker result');
  let serializeFailed = false;
  try { await original.initCompiler({ invalid: () => {} }); } catch (error) { serializeFailed = error.name === 'DataCloneError'; }
  assert(serializeFailed, 'postMessage serialization failure');
  // Malformed and prototype methods must be refused by the fixed worker allowlist.
  const invalid = await new Promise(resolve => {
    const listener = event => { if (event.data.id === 90001) { workers.candidate.removeEventListener('message', listener); resolve(event.data); } };
    workers.candidate.addEventListener('message', listener);
    workers.candidate.postMessage({ protocol: 'typsmthng-compiler-v1', kind: 'call', id: 90001, method: 'constructor', args: [] });
  });
  assert(invalid.ok === false && invalid.error.name === 'TypeError', 'method allowlist');
  // Pending calls and all later calls reject after disposal; no live listener remains.
  const endpoint = { postMessage() {}, addEventListener() {}, removeEventListener() {} };
  const dead = candidateRpc.createCompilerRpcClient(endpoint);
  const pending = dead.api.initCompiler().then(() => false, error => error.name === 'WorkerTransportError');
  dead.dispose(new candidateRpc.WorkerTransportError('terminated'));
  assert(await pending, 'pending call must reject on disposal');
  assert(await dead.api.initCompiler().then(() => false, error => error.name === 'WorkerTransportError'), 'calls after disposal');
  return 'passed';
}
globalThis.dependencyBench = {
  startup,
  compatibility,
  async measure(kind, mode, name, iterations) {
    const start = performance.now();
    await (kind === 'idb' ? idbWorkload : rpcWorkload)(mode, name, iterations);
    return (performance.now() - start) / iterations;
  },
  close() { for (const worker of Object.values(workers)) worker.terminate(); },
};`)
// Bun's IIFE output has no top-level await. Wrap initialization inside an async function.
let browserSource = await readFile(browserPath, 'utf8')
const split = browserSource.indexOf('const assert')
browserSource = browserSource.slice(0, split) + '\nglobalThis.dependencyBenchReady = (async () => {\n' + browserSource.slice(split) + '\n})();\n'
await writeFile(browserPath, browserSource)
const htmlPath = join(fixtureDir, 'index.html')
await writeFile(htmlPath, '<!doctype html><title>Dependency benchmark</title>')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.on('console', message => console.error('browser:', message.text()))
  page.on('pageerror', error => console.error('browser error:', error.message))
  console.log('Browser launched')
  await page.goto('file://' + htmlPath)
  await page.addScriptTag({ content: await bundle(browserPath) })
  await page.evaluate(() => globalThis.dependencyBenchReady)
  console.log('Fixtures initialized')
  const compatibility = await page.evaluate(() => globalThis.dependencyBench.compatibility())
  console.log('Compatibility: '+compatibility)
  const selected = (process.env.BENCH_WORKLOADS || 'small,typical,large,concurrent,errors,read,incremental,incremental-large').split(',')
  const samples = Number(process.env.BENCH_SAMPLES || 9)
  const warmups = Number(process.env.BENCH_WARMUPS || 3)
  const kinds = (process.env.BENCH_KINDS || 'idb,rpc').split(',')
  const results = []
  const percentile = (values, fraction) => [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.ceil(values.length*fraction)-1)]
  for (const kind of kinds) for (const name of selected) {
    if ((kind === 'rpc' && name === 'read') || (kind === 'idb' && name.startsWith('incremental'))) continue;
    const iterations = Number(process.env.BENCH_ITERATIONS || (name === 'large' || name === 'incremental-large' ? 5 : name === 'concurrent' ? 8 : 20))
    const raw = []
    for (let sample = -warmups; sample < samples; sample++) {
      const order = sample % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
      const pair = {}
      for (const mode of order) pair[mode] = await page.evaluate(({kind,mode,name,iterations}) => globalThis.dependencyBench.measure(kind,mode,name,iterations), {kind,mode,name,iterations})
      if (sample >= 0) raw.push(pair)
    }
    const baseline = raw.map(pair=>pair.baseline), candidate = raw.map(pair=>pair.candidate)
    const result = {kind,name,iterations,samples,median_ms:{baseline:percentile(baseline,.5),candidate:percentile(candidate,.5)},p90_ms:{baseline:percentile(baseline,.9),candidate:percentile(candidate,.9)},raw}
    results.push(result)
    console.log(JSON.stringify(result))
  }
  const output = { environment:{date:new Date().toISOString(), bun:Bun.version,node:process.version,os:platform()+' '+release(),cpu:cpus()[0].model,logicalCpus:cpus().length,memoryBytes:totalmem(),loadavg:loadavg(),browser:browser.version()}, baseline:{head:'34e26debaa014b789f034808c2d539d311a1698a',packages:{'idb-keyval':'6.3.0',comlink:'4.4.2'},integrity}, warmups, compatibility, startup_note:'Single descriptive warm-module worker startup per side, not a performance comparison or gate.', startup_ms:await page.evaluate(()=>globalThis.dependencyBench.startup),results }
  const outputPath = process.env.BENCH_OUTPUT || join(fixtureDir, 'results.json')
  await writeFile(outputPath, JSON.stringify(output,null,2)+'\n')
  console.log('Results: '+outputPath)
} finally { await browser.close() }
