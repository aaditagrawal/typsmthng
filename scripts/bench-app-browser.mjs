// Run from a disposable browser profile on the Vite dev server:
// await (await import('/scripts/bench-app-browser.mjs')).run({ allowStorageReset: true })
// This resets local project storage. Never run in a profile with user data.
import { searchProjectContent } from '../src/lib/content-search.ts'
import { useProjectStore, resetProjectPersistStateForTests } from '../src/stores/project-store.ts'
import { useSettingsStore } from '../src/stores/settings-store.ts'
import { compileTypstClient, compileToPdfClient } from '../src/lib/compiler-client.ts'

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const assert = (condition, message) => { if (!condition) throw Error(message) }

export async function run({ samples = 31, warmup = 5, allowStorageReset = false } = {}) {
  assert(allowStorageReset, 'Use a disposable profile and explicitly allowStorageReset')
  assert(Number.isInteger(samples) && samples > 0, 'Invalid sample count')
  assert(Number.isInteger(warmup) && warmup >= 0, 'Invalid warmup count')
  const results = []
  async function measure(name, operation, prepare = () => {}) {
    const times = []
    for (let i = 0; i < warmup + samples; i++) {
      await prepare(i)
      const start = performance.now()
      const value = await operation(i)
      const elapsed = performance.now() - start
      if (i >= warmup) times.push(elapsed)
      if (typeof value === 'function') value()
    }
    results.push({ name, median_ms: median(times), samples_ms: times })
  }

  // Include both early-hit and scan-heavy cases; warm queries vary, as while typing.
  const lines = Array.from({ length: 50000 }, (_, i) => `Paragraph ${i} with *formatting* and ordinary content.`)
  lines[40000] += ' sparse-target'
  const files = [{ path: '/main.typ', content: lines.join('\n'), isBinary: false }]
  for (const [name, queries, count] of [
    ['early', ['Paragraph', 'paragraph', 'Paragrap'], 80],
    ['sparse', ['sparse-target', 'sparse-targe', 'SPARSE-TARGET'], 1],
    ['absent', ['not-present', 'not-presen', 'NOT-PRESENT'], 0],
  ]) {
    await measure(`search.${name}.warm`, i => {
      const hits = searchProjectContent(files, queries[i % queries.length])
      return () => assert(hits.length === count, `Wrong search count: ${name}`)
    })
    await measure(`search.${name}.cold`, i => {
      const hits = searchProjectContent(files.map(file => ({ ...file })), queries[i % queries.length])
      return () => assert(hits.length === count, `Wrong cold search count: ${name}`)
    })
  }

  const store = useProjectStore
  const project = { id: 'bench', name: 'Benchmark', mainFile: '/main.typ', createdAt: 1, updatedAt: 1,
    files: Array.from({ length: 2500 }, (_, i) => ({
      path: `/file-${i}.typ`, content: 'before', isBinary: false, lastModified: 1,
    })) }
  const entries = Array.from({ length: 2500 }, (_, i) => ({ path: `/file-${i + 1250}.typ`, content: 'after' }))
  await measure('files.batch-upsert.2500', async () => {
    await store.getState().createFilesBatch(entries)
    return () => {
      const files = store.getState().projects[0].files
      assert(files.length === 3750 && files[1250].content === 'after' && files[0].content === 'before', 'Wrong upsert')
    }
  }, () => {
    resetProjectPersistStateForTests()
    store.setState({ projects: [project], currentProjectId: project.id })
  })
  resetProjectPersistStateForTests()

  // Seed the real IndexedDB split-record format in one transaction, outside timing.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('typsmthng-projects')
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite')
    const table = tx.objectStore('projects')
    table.clear()
    for (let p = 0; p < 20; p++) {
      const id = `bench-${p}`
      const files = [{ path: '/main.typ', content: '= Benchmark', isBinary: false, lastModified: 1 }]
      for (let b = 0; b < 20; b++) {
        const path = `/asset-${b}.bin`
        files.push({ path, content: '', isBinary: true, lastModified: 1 })
        table.put(new Uint8Array(4096).fill(b), `bin:${id}:${path}`)
      }
      table.put({ ...project, id, files }, id)
    }
    // Avoid exercising the historical missing-home-store fallback on every load.
    table.put({ workspaces: [], projectWorkspaceAssignments: {}, selectedHomeWorkspaceId: null }, 'home-meta')
    tx.oncomplete = resolve
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
  await measure('storage.load.20-projects-400-assets', async () => {
    await store.getState().loadProjects()
    return () => {
      const projects = store.getState().projects
      assert(projects.length === 20 && projects.every(p => p.files.length === 21
        && p.files[20].binaryData[0] === 19), 'Wrong persisted asset data')
    }
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite')
    tx.objectStore('projects').clear()
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()

  useSettingsStore.setState({ systemFontsEnabled: false, googleFontsEnabled: false })
  for (const [name, source] of [
    ['small', '= A document\nHello, *Typst*. $x^2+y^2=z^2$'],
    ['long', '#set page(height: 280mm)\n' + Array.from({ length: 100 }, (_, i) =>
      `\n== Section ${i}\n${'A paragraph with *bold*, _italic_, and ordinary words. '.repeat(8)}\n`).join('')],
  ]) {
    const firstStart = performance.now()
    const first = await compileTypstClient(source)
    assert(first.success && first.vectorData?.length, 'Initial compile failed')
    results.push({ name: `compile.${name}.first-observation`, observation_ms: performance.now() - firstStart,
      vector_bytes: first.vectorData.length })
    await measure(`compile.${name}.edit`, async i => {
      const result = await compileTypstClient(`${source}\n\nUnique edit ${i}.`)
      return () => assert(result.success && result.vectorData?.length > 0 && result.pageDimensions.length > 0, 'Edit failed')
    })
    await measure(`pdf.${name}`, async i => {
      const result = await compileToPdfClient(`${source}\n\nPDF edit ${i}.`)
      return () => assert(new TextDecoder().decode(result.pdf?.subarray(0, 5)) === '%PDF-', 'Invalid PDF')
    })
  }
  return { userAgent: navigator.userAgent, samples, warmup, results,
    scope: 'Chromium in an orb, Vite development modules; real IndexedDB and compiler worker. Not production page-load or keystroke-to-paint latency. Validation and setup outside timings; cold search includes cache preparation.' }
}
