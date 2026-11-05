import { wrap, releaseProxy } from 'baseline-comlink'
import { create as baselineCreate } from 'baseline-zustand'
import { useShallow as baselineShallow } from 'baseline-zustand/react/shallow'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLayoutEffect } from 'react'
import { createWorkerRpc } from '../src/lib/worker-rpc'
import { create as candidateCreate, useShallow as candidateShallow } from '../src/lib/external-store'

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const samples: Array<{ name: string; baseline_ms: number[]; candidate_ms: number[] }> = []
let rounds = 15
async function paired(name: string, baseline: () => unknown, candidate: () => unknown) {
  console.info(name)
  for (let warmup = 0; warmup < 3; warmup++) { await baseline(); await candidate() }
  const sample = { name, baseline_ms: [] as number[], candidate_ms: [] as number[] }
  for (let round = 0; round < rounds; round++) {
    for (const [label, run] of round % 2 ? [['candidate', candidate], ['baseline', baseline]] as const : [['baseline', baseline], ['candidate', candidate]] as const) {
      const start = performance.now()
      await run()
      sample[label === 'baseline' ? 'baseline_ms' : 'candidate_ms'].push(performance.now() - start)
    }
  }
  samples.push(sample)
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], min: sorted[0], max: sorted.at(-1) }
}

interface RpcApi { echo(value: unknown): Promise<unknown>; fail(): Promise<void>; wait(): Promise<void> }
async function rpcBenchmarks() {
  await paired('rpc worker startup/first reply', async () => {
    const worker = new Worker('worker.js')
    worker.postMessage({ kind: 'setup', baseline: true })
    const api = wrap<RpcApi>(worker)
    await api.echo(null)
    api[releaseProxy]()
    worker.terminate()
  }, async () => {
    const worker = new Worker('worker.js')
    worker.postMessage({ kind: 'setup', baseline: false })
    const rpc = createWorkerRpc<RpcApi>(worker)
    await rpc.call('echo', null)
    rpc.close()
    worker.terminate()
  })
  const start = performance.now()
  const baselineWorker = new Worker('worker.js')
  baselineWorker.postMessage({ kind: 'setup', baseline: true })
  const baseline = wrap<RpcApi>(baselineWorker)
  await baseline.echo(null)
  const baselineStartup = performance.now() - start
  const candidateStart = performance.now()
  const candidateWorker = new Worker('worker.js')
  candidateWorker.postMessage({ kind: 'setup', baseline: false })
  const candidate = createWorkerRpc<RpcApi>(candidateWorker)
  await candidate.call('echo', null)
  const candidateStartup = performance.now() - candidateStart
  for (const value of [undefined, 'source'.repeat(100), new Uint8Array(4194304).fill(42)]) {
    const result = await candidate.call('echo', value)
    if (value instanceof Uint8Array) {
      check(result instanceof Uint8Array && result.byteLength === value.byteLength && result[0] === 42 && value[0] === 42, 'RPC must clone buffers without detachment')
    } else check(result === value, 'RPC scalar result')
  }
  let failure: unknown
  try { await candidate.call('fail') } catch (error) { failure = error }
  check(failure instanceof Error && failure.name === 'TypeError' && failure.message === 'fixture failure', 'RPC error preservation')
  for (const bytes of [64, 65536, 4194304]) {
    const value = new Uint8Array(bytes).fill(13)
    const count = bytes === 4194304 ? 5 : 50
    await paired(`rpc clone ${bytes}B x${count}`, async () => { for (let i = 0; i < count; i++) await baseline.echo(value) }, async () => { for (let i = 0; i < count; i++) await candidate.call('echo', value) })
  }
  await paired('rpc concurrent 100 calls', () => Promise.all(Array.from({ length: 100 }, (_, i) => baseline.echo(i))), () => Promise.all(Array.from({ length: 100 }, (_, i) => candidate.call('echo', i))))
  await paired('rpc 25 errors', async () => { for (let i = 0; i < 25; i++) await baseline.fail().catch(() => {}) }, async () => { for (let i = 0; i < 25; i++) await candidate.call('fail').catch(() => {}) })
  const waiting = candidate.call('wait').catch((error: Error) => error)
  candidate.close()
  check((await waiting) instanceof Error, 'RPC teardown rejects pending calls')
  baseline[releaseProxy]()
  baselineWorker.terminate()
  candidateWorker.terminate()
  return { baseline_ms: baselineStartup, candidate_ms: candidateStartup, note: 'single cold worker start, descriptive only; steady-state comparisons above are repeated' }
}

async function storeBenchmarks() {
  for (const subscribers of [0, 1, 25]) {
    const baseline = baselineCreate(() => ({ value: 0, other: 0 }))
    const candidate = candidateCreate(() => ({ value: 0, other: 0 }))
    const counters = [0, 0]
    for (let i = 0; i < subscribers; i++) {
      baseline.subscribe(() => counters[0]++)
      candidate.subscribe(() => counters[1]++)
    }
    await paired(`store 100000 updates/${subscribers} subscribers`, () => { for (let i = 0; i < 100000; i++) baseline.setState({ value: i }) }, () => { for (let i = 0; i < 100000; i++) candidate.setState({ value: i }) })
    check(counters[0] === counters[1], 'subscriber count parity')
  }
  const baseline = baselineCreate(() => ({ value: 0, other: 0 }))
  const candidate = candidateCreate(() => ({ value: 0, other: 0 }))
  let baselineRenders = 0
  let candidateRenders = 0
  function Baseline() { baselineRenders++; const value = baseline(baselineShallow((state: { value: number }) => ({ value: state.value }))); return <span>{value.value}</span> }
  function Candidate() { candidateRenders++; const value = candidate(candidateShallow((state) => ({ value: state.value }))); return <span>{value.value}</span> }
  const root = createRoot(document.getElementById('root')!)
  flushSync(() => root.render(<><Baseline /><Candidate /></>))
  const before = [baselineRenders, candidateRenders]
  flushSync(() => { baseline.setState({ other: 1 }); candidate.setState({ other: 1 }) })
  check(before[0] === baselineRenders && before[1] === candidateRenders, 'shallow selector skips unrelated renders')
  await paired('store React 200 selector renders', () => { for (let i = 0; i < 200; i++) flushSync(() => baseline.setState({ value: i })) }, () => { for (let i = 0; i < 200; i++) flushSync(() => candidate.setState({ value: i })) })
  check(baselineRenders === candidateRenders, 'React render count parity')
  flushSync(() => root.unmount())

  const effects = [0, 0]
  const renders = [0, 0]
  function BaselineParent({ tick }: { tick: number }) {
    renders[0]++
    const selection = baseline(baselineShallow((state: { value: number }) => ({ value: state.value })))
    useLayoutEffect(() => { effects[0]++ }, [selection])
    return <span data-tick={tick}>{selection.value}</span>
  }
  function CandidateParent({ tick }: { tick: number }) {
    renders[1]++
    const selection = candidate(candidateShallow((state) => ({ value: state.value })))
    useLayoutEffect(() => { effects[1]++ }, [selection])
    return <span data-tick={tick}>{selection.value}</span>
  }
  const baselineElement = document.createElement('div')
  const candidateElement = document.createElement('div')
  document.body.append(baselineElement, candidateElement)
  const baselineRoot = createRoot(baselineElement)
  const candidateRoot = createRoot(candidateElement)
  flushSync(() => { baselineRoot.render(<BaselineParent tick={-1} />); candidateRoot.render(<CandidateParent tick={-1} />) })
  await paired('store React 200 parent rerenders/unrelated updates', () => {
    for (let tick = 0; tick < 200; tick++) flushSync(() => { baseline.setState({ other: tick }); baselineRoot.render(<BaselineParent tick={tick} />) })
  }, () => {
    for (let tick = 0; tick < 200; tick++) flushSync(() => { candidate.setState({ other: tick }); candidateRoot.render(<CandidateParent tick={tick} />) })
  })
  check(renders[0] === renders[1] && effects[0] === 1 && effects[1] === 1, 'parent rerender selection identity/effect parity')
  flushSync(() => { baselineRoot.unmount(); candidateRoot.unmount() })
  baselineElement.remove()
  candidateElement.remove()
}

Object.assign(globalThis, { runDependencyBenchmarks: async (count: number) => {
  rounds = count
  const startup = await rpcBenchmarks()
  await storeBenchmarks()
  return { checks: 'Worker cloning/errors/teardown and subscription/render/parent-effect parity passed', methodology: { rounds, warmups: 3, order: 'alternating baseline/candidate pairs', baseline_versions: { comlink: '4.4.2', zustand: '5.0.15' }, react: '19.3.1 production, shared renderer', units: 'milliseconds per named batch', clock: 'performance.now', browser: navigator.userAgent, caveat: 'Worker fixture bundles both adapters, so startup measures protocol setup with shared script parsing, not shipped bundle startup. Concurrent host workloads can broaden tails. No application speed claim follows from a microbenchmark.' }, startup, performance: samples.map((sample) => ({ ...sample, baseline: summarize(sample.baseline_ms), candidate: summarize(sample.candidate_ms) })) }
} })
