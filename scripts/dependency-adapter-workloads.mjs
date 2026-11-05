import { baselineStore, candidateStore, baselineRpc, candidateRpc } from './adapters.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function api() {
  return {
    async initCompiler() {},
    async compileTypst(source, files, main, binary, options) {
      if (source === 'error') throw new TypeError('layout failed')
      return { success: true, vectorData: binary?.[0]?.data ?? new Uint8Array([1]),
        svg: options?.wantSvg ? source : '', diagnostics: [], pageDimensions: [], main, files }
    },
    async resolveSourceLoc(vector, target) { return `${vector[0]}:${target[0]}` },
    async resolveSourceLocBatch(vector, targets) { return targets.map(target => `${vector[0]}:${target[0]}`) },
    async compileToPdf(source) { return { pdf: new TextEncoder().encode(source), diagnostics: [] } },
    async ensurePackagesForCompile() {},
    isCompilerReady() { return true },
  }
}

async function workerClient(kind) {
  const source = `import { baselineRpc, candidateRpc } from '${location.origin}/adapters.js';
const api = (${api.toString()})();
${kind === 'baseline' ? 'baselineRpc.expose(api)' : 'candidateRpc.exposeCompilerRpc(self, api)'}`
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url, { type: 'module' })
  const failed = new Promise((_, reject) => worker.addEventListener('error', event => reject(new Error(event.message))))
  failed.catch(() => {})
  const client = kind === 'baseline' ? baselineRpc.wrap(worker) : candidateRpc.createCompilerRpc(worker)
  return {
    call: (method, ...args) => Promise.race([failed, kind === 'baseline' ? client[method](...args) : client.call(method, ...args)]),
    close() {
      if (kind === 'candidate') client.dispose(new candidateRpc.WorkerTransportError('closed'))
      worker.terminate()
      URL.revokeObjectURL(url)
    },
  }
}

function parseSyntax(Parser, source) {
  const parser = new Parser(source)
  try {
    const before = { length: parser.length(), tree: parser.tree(), highlights: Array.from(parser.highlight()) }
    const ranges = Array.from(parser.edit_many([{ from: 0, to: 0, insert: '// probe\n' }]))
    return { before, ranges, length: parser.length(), tree: parser.tree(), highlights: Array.from(parser.highlight()),
      viewport: Array.from(parser.highlight_range(0, parser.length())), tags: Parser.get_highlight_tags() }
  } finally { parser.free() }
}

async function syntaxClient(kind) {
  const source = `import { TypstWasmParser } from '${location.origin}/wasm-${kind}/syntax.js';
onmessage = ({data}) => postMessage((${parseSyntax.toString()})(TypstWasmParser, data));
postMessage('ready');`
  // Same-origin workers give Vite's root-relative WASM URL its real HTTP base.
  const url = location.origin + '/__syntax-worker?source=' + encodeURIComponent(source)
  const worker = new Worker(url, { type: 'module' })
  const failed = new Promise((_, reject) => worker.addEventListener('error', event => reject(new Error(event.message))))
  failed.catch(() => {})
  const close = () => { worker.terminate(); URL.revokeObjectURL(url) }
  try {
    await Promise.race([failed, new Promise(resolve => worker.addEventListener('message', resolve, { once: true }))])
  } catch (error) { close(); throw error }
  return { close, parse(source) {
    return Promise.race([failed, new Promise(resolve => {
      worker.addEventListener('message', ({ data }) => resolve(data), { once: true })
      worker.postMessage(source)
    })])
  } }
}

async function editorClient(kind) {
  const frame = document.createElement('iframe')
  frame.srcdoc = '<!doctype html><body></body>'
  const loaded = new Promise(resolve => { frame.onload = resolve })
  document.body.append(frame)
  try {
    await loaded
    const module = await frame.contentWindow.eval(`import('${location.origin}/wasm-${kind}/editor.js')`)
    return { check: () => module.checkEditor(), close: () => frame.remove() }
  } catch (error) { frame.remove(); throw error }
}

async function storageCompatibility() {
  const name = 'compatibility'
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const original = baselineStore.createStore(name, 'projects')
  const replacement = candidateStore.createStore(name, 'projects')
  await baselineStore.set('existing', { bytes: new Uint8Array([3, 4]) }, original)
  const value = await candidateStore.get('existing', replacement)
  assert(value.bytes instanceof Uint8Array && value.bytes[1] === 4, 'existing binary schema')
  let readResolved = false
  const readCompleted = new Promise((resolve, reject) => {
    const reading = replacement('readonly', store => {
      store.transaction.addEventListener('complete', () => resolve(readResolved))
      return store.get('existing')
    })
    reading.then(() => { readResolved = true }, reject)
  })
  assert(await readCompleted, 'read promise resolves at request success')
  await replacement('readonly', store => {
    const request = store.get('existing')
    store.transaction.abort()
    return request
  }).then(() => { throw new Error('aborted read resolved') }, error => assert(error.name === 'AbortError', 'read abort error'))
  await candidateStore.set('new', { text: 'saved' }, replacement)
  assert((await baselineStore.get('new', original)).text === 'saved', 'compatible write')
  const ordered = [candidateStore.set('ordered', 1, replacement), candidateStore.del('ordered', replacement)]
  await Promise.all(ordered)
  assert(await candidateStore.get('ordered', replacement) === undefined, 'save/delete ordering')
  const missing = candidateStore.createStore(name, 'home')
  await candidateStore.get('home-meta', missing).then(() => { throw new Error('missing store accepted') },
    error => assert(error.name === 'NotFoundError', 'legacy missing store error'))
  await replacement('readwrite', store => {
    const request = store.put('aborted', 'abort')
    request.onsuccess = () => store.transaction.abort()
    return request
  }).then(() => { throw new Error('abort resolved') }, error => assert(error.name === 'AbortError', 'abort error'))
  assert(await candidateStore.get('abort', replacement) === undefined, 'abort rollback')
  await candidateStore.set('bad', () => {}, replacement).then(() => { throw new Error('clone resolved') },
    error => assert(error.name === 'DataCloneError', 'clone error'))
  await candidateStore.set('after-error', 1, replacement)
  assert(await candidateStore.get('after-error', replacement) === 1, 'write recovery')
  const defaultValue = new Uint8Array([5, 6])
  await baselineStore.set('legacy-default', defaultValue)
  assert((await candidateStore.get('legacy-default'))[0] === 5, 'implicit store schema')
  database.close()
  const upgradeName = 'upgrade-compatibility'
  const upgraded = candidateStore.createStore(upgradeName, 'data')
  await candidateStore.set('before', 1, upgraded)
  const newer = await new Promise((resolve, reject) => {
    const request = indexedDB.open(upgradeName, 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  assert(await candidateStore.get('before', upgraded) === 1, 'reopen after version change')
  newer.close()
  return ['existing schema and typed arrays', 'read request-success timing', 'save/delete ordering', 'legacy missing store',
    'transaction abort and rollback', 'clone failure and recovery', 'default keyval store', 'reopen after version change']
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median_ms: sorted[Math.floor(sorted.length / 2)], p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], samples_ms: values }
}

export async function run(rounds, filter = []) {
  console.log('Storage compatibility')
  const compatibility = filter.length > 0 && filter.every(name => name.startsWith('rpc-'))
    ? ['Original idb-keyval retained; owned private-store compatibility and storage timings excluded']
    : await storageCompatibility()
  console.log('Worker compatibility')
  const stores = { baseline: baselineStore, candidate: candidateStore }
  const handles = Object.fromEntries(Object.entries(stores).map(([kind, library]) => [kind, library.createStore(`bench-${kind}`, 'data')]))
  const clients = { baseline: await workerClient('baseline'), candidate: await workerClient('candidate') }
  const syntax = { baseline: await syntaxClient('baseline'), candidate: await syntaxClient('candidate') }
  const editors = { baseline: await editorClient('baseline'), candidate: await editorClient('candidate') }
  const measurements = []
  let coldSequence = 0
  try {
    for (const client of Object.values(clients)) {
      await client.call('initCompiler')
      const bytes = new Uint8Array([7, 8])
      const result = await client.call('compileTypst', '= hi', [], '/main.typ', [{ path: '/a', data: bytes }], { wantSvg: true })
      assert(result.vectorData[1] === 8 && bytes.byteLength === 2, 'worker binary clone ownership')
      assert(await client.call('resolveSourceLoc', bytes, new Uint32Array([2])) === '7:2', 'typed path')
      assert((await client.call('resolveSourceLocBatch', bytes, [new Uint32Array([3])]))[0] === '7:3', 'batch path')
      assert((await client.call('compileToPdf', 'pdf')).pdf[0] === 112, 'PDF byte response')
      await client.call('compileTypst', 'error').then(() => { throw new Error('error resolved') },
        error => assert(error.name === 'TypeError' && error.message === 'layout failed', 'application error identity'))
    }
    compatibility.push('real worker typed arrays, source paths, PDF, error identity')
    for (const source of ['= Title\nHello 😀 $x^2$\n#let msg = "ok"', '#[unterminated']) {
      const original = await syntax.baseline.parse(source), replacement = await syntax.candidate.parse(source)
      assert(original.before.length === source.length && original.length === source.length + '// probe\n'.length, 'syntax UTF-16 lengths')
      assert(JSON.stringify(original) === JSON.stringify(replacement), 'native WASM parse/edit/highlight identity')
    }
    compatibility.push('actual syntax WASM UTF-16 lengths, trees, edit_many ranges, full/viewport highlights and tags')
    assert(JSON.stringify(editors.baseline.check()) === JSON.stringify(editors.candidate.check()), 'actual EditorView+typst construct/edit/highlight/destroy identity')
    compatibility.push('actual EditorView+typst construction, editing, DOM highlights and destruction')
    // Load fixtures before timing so reads measure the initial/cache-load path.
    for (const [kind, library] of Object.entries(stores)) {
      for (const size of [64, 8192, 1048576]) {
        await library.set('read-' + size, { text: 'x'.repeat(size), bytes: new Uint8Array(size) }, handles[kind])
      }
    }
    const workloads = [
      { name: 'storage-cold-open', operations: 1, async run(kind) {
        const library = stores[kind], handle = library.createStore('cold-' + kind + (++coldSequence), 'data')
        await library.set('project', { text: 'x'.repeat(8192) }, handle)
        await library.get('project', handle)
      } },
      { name: 'rpc-cold-init', operations: 1, async run(kind) {
        const client = await workerClient(kind)
        try { await client.call('initCompiler', { fontData: [new Uint8Array(8192)] }) } finally { client.close() }
      } },
      ...[64, 8192, 1048576].flatMap(size => [
        { name: `storage-read-${size}`, operations: 30, async run(kind) {
          for (let i = 0; i < 30; i++) await stores[kind].get('read-' + size, handles[kind])
        } },
        { name: `storage-read-concurrent-${size}`, operations: 30, async run(kind) {
          await Promise.all(Array.from({ length: 30 }, () => stores[kind].get('read-' + size, handles[kind])))
        } },
      ]),
      ...[64, 8192, 1048576].map(size => ({ name: `storage-${size}`, operations: 30, async run(kind) {
        const library = stores[kind], handle = handles[kind], value = { text: 'x'.repeat(size), bytes: new Uint8Array(size) }
        for (let i = 0; i < 30; i++) { await library.set('project', value, handle); await library.get('project', handle) }
      } })),
      { name: 'storage-concurrent', operations: 30, async run(kind) {
        const library = stores[kind], handle = handles[kind]
        await Promise.all(Array.from({ length: 30 }, (_, i) => library.set(i, { text: 'x'.repeat(8192) }, handle)))
        await library.keys(handle)
        await Promise.all(Array.from({ length: 30 }, (_, i) => library.del(i, handle)))
      } },
      ...[64, 8192, 1048576].map(size => ({ name: `rpc-${size}`, operations: 100, async run(kind) {
        const data = new Uint8Array(size), source = '= hi\n' + 'x'.repeat(size)
        for (let i = 0; i < 100; i++) await clients[kind].call('compileTypst', source, [], '/main.typ', [{ path: '/a', data }], { wantSvg: false })
      } })),
      { name: 'rpc-concurrent', operations: 100, async run(kind) {
        await Promise.all(Array.from({ length: 100 }, () => clients[kind].call('resolveSourceLoc', new Uint8Array(8192), new Uint32Array([2]))))
      } },
      { name: 'rpc-errors', operations: 100, async run(kind) {
        for (let i = 0; i < 100; i++) await clients[kind].call('compileTypst', 'error').catch(() => {})
      } },
    ]
    assert(filter.every(name => workloads.some(workload => workload.name === name)), 'unknown benchmark workload')
    for (const workload of workloads.filter(workload => (filter.length === 0 || filter.includes(workload.name)))) {
      console.log(workload.name)
      for (let i = 0; i < 3; i++) { await workload.run('baseline'); await workload.run('candidate') }
      const samples = { baseline: [], candidate: [] }
      for (let i = 0; i < rounds; i++) {
        for (const kind of i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          const start = performance.now()
          await workload.run(kind)
          samples[kind].push(performance.now() - start)
        }
      }
      const baseline = summary(samples.baseline), candidate = summary(samples.candidate)
      measurements.push({ workload: workload.name, operations: workload.operations, baseline, candidate,
        median_ratio: candidate.median_ms / baseline.median_ms, p95_ratio: candidate.p95_ms / baseline.p95_ms })
    }
    return { compatibility, methodology: 'Three warmups per variant; alternating baseline/candidate order, same page and real workers/IndexedDB; timings are per complete batch. WASM fixture builds precede timing; fresh-worker and fresh-realm editor initialization use warm HTTP/WASM caches; parse/edit/highlight rows reuse initialized workers.', measurements }
  } finally { for (const client of [...Object.values(clients), ...Object.values(syntax), ...Object.values(editors)]) client.close() }
}
