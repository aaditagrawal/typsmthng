// Run with: bun scripts/benchmark-dependencies.ts [--quick] [--output=/tmp/results.json]
// Baseline packages are isolated in a temporary directory, never the app manifest.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { join, resolve } from 'node:path'

const project = resolve(import.meta.dir, '..')
const temporary = await mkdtemp(join(tmpdir(), 'typsmthng-dependencies-'))
const baseline = join(temporary, 'baseline')
const quick = process.argv.includes('--quick')
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length)
let chrome: ReturnType<typeof Bun.spawn> | undefined
try {
  await Bun.write(join(baseline, 'package.json'), JSON.stringify({ private: true, dependencies: {
    'idb-keyval': '6.3.0', comlink: '4.4.2', zustand: '5.0.15', react: '19.3.1',
  } }))
  const install = Bun.spawn(['bun', 'install', '--cwd', baseline, '--ignore-scripts'], { stdout: 'ignore', stderr: 'inherit' })
  if (await install.exited) throw new Error('Baseline install failed')
  const build = async (entry: string, name: string) => {
    const result = await Bun.build({
      entrypoints: [join(project, 'scripts', entry)], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      plugins: [{ name: 'baseline-packages', setup(build) {
        build.onResolve({ filter: /^baseline-/ }, ({ path }) => ({ path: Bun.resolveSync(path.slice('baseline-'.length), baseline) }))
        build.onResolve({ filter: /^react(?:\/|$)/ }, ({ path }) => ({ path: Bun.resolveSync(path, project) }))
      } }],
    })
    if (!result.success) throw new Error(result.logs.map(String).join('\n'))
    await writeFile(join(temporary, name), await result.outputs[0].text())
  }
  await build('dependency-bench.worker.ts', 'worker.js')
  await build('dependency-bench.browser.tsx', 'browser.js')
  await writeFile(join(temporary, 'index.html'), '<!doctype html><div id="root"></div><script src="browser.js"></script>')
  chrome = Bun.spawn([process.env.CHROME_BIN ?? '/usr/bin/google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'profile')}`, 'about:blank'], { stdout: 'ignore', stderr: 'ignore' })
  let port: string | undefined
  for (let attempt = 0; attempt < 2400; attempt++) {
    try { port = (await readFile(join(temporary, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await Bun.sleep(50) }
  }
  if (!port) throw new Error('Chrome debugging endpoint unavailable')
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>
  const socket = new WebSocket(tabs.find((tab) => tab.type === 'page')!.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = reject })
  let id = 0
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: unknown) => void }>()
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) { if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') console.error(JSON.stringify(message.params)); return }
    const call = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) call?.reject(message.error)
    else call?.resolve(message.result)
  }
  const send = (method: string, params = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: `file://${join(temporary, 'index.html')}` })
  for (let attempt = 0; attempt < 2400; attempt++) {
    const result = await send('Runtime.evaluate', { expression: 'typeof runDependencyBenchmarks', returnByValue: true })
    if ((result.result as { value?: string })?.value === 'function') break
    await Bun.sleep(50)
  }
  const result = await send('Runtime.evaluate', { expression: `runDependencyBenchmarks(${quick ? 5 : 15})`, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  const data = { environment: { bun: Bun.version, bunNodeCompatibilityVersion: process.version, node: (await new Response(Bun.spawn(['node', '--version'], { stdout: 'pipe' }).stdout).text()).trim(), chrome: await send('Browser.getVersion'), cpu: cpus()[0].model, baseline_head: '9b501ec14b8116f9e5b5b696eb4145d6f39f73b1' }, ...(result.result as { value: object }).value }
  const json = JSON.stringify(data, null, 2)
  if (output) await writeFile(output, json + '\n')
  console.log(json)
  socket.close()
} finally {
  chrome?.kill()
  if (chrome) await chrome.exited
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
