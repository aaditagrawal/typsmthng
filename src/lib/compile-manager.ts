import { useCompileStore } from '@/stores/compile-store'
import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { PageSize } from '@/stores/settings-store'
import { initCompiler, compileTypst, ensurePackagesForCompile, isCompilerReady } from './compiler'
import { applyPackageImportCompatRewrites } from './package-compat'
import { buildCompileInputs } from './compile-inputs'
import { perfMark, perfMeasure, perfSample } from './perf'

const MIN_COMPILE_DELAY_MS = 120
const MAX_COMPILE_DELAY_MS = 900
const COMPILE_DELAY_MULTIPLIER = 1.35
const TYPING_IDLE_WINDOW_MS = 120
const MAX_RESULT_APPLY_DEFER_MS = 350
const APPLY_DEFER_POLL_MS = 24

interface CachedImportSpecs {
  hash: number
  specs: string[]
}

const previewImportRegex = /@preview\/[a-zA-Z][a-zA-Z0-9-]*(?::\d+\.\d+\.\d+)?/g
const previewSpecCache = new Map<string, CachedImportSpecs>()

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return hash >>> 0
}

function findPreviewImportSpecsFast(source: string): string[] {
  if (!source.includes('@preview/')) return []

  const found = new Set<string>()
  let match: RegExpExecArray | null = null
  previewImportRegex.lastIndex = 0
  while ((match = previewImportRegex.exec(source)) !== null) {
    found.add(match[0])
  }

  return [...found]
}

function collectPreviewSpecsCached(path: string, source: string, target: Set<string>): void {
  if (!source.includes('@preview/')) {
    previewSpecCache.delete(path)
    return
  }

  const hash = hashString(source)
  const cached = previewSpecCache.get(path)
  const specs = cached && cached.hash === hash
    ? cached.specs
    : findPreviewImportSpecsFast(source)

  if (!cached || cached.hash !== hash) {
    previewSpecCache.set(path, { hash, specs })
  }

  for (const spec of specs) {
    target.add(spec)
  }
}

function pruneSpecCache(activePaths: Set<string>): void {
  if (previewSpecCache.size <= activePaths.size + 48) return
  for (const path of previewSpecCache.keys()) {
    if (!activePaths.has(path)) {
      previewSpecCache.delete(path)
    }
  }
}

function currentProjectLayoutLocked(): boolean {
  const project = useProjectStore.getState().getCurrentProject()
  if (!project) return false
  if (project.templateMeta?.layoutLocked) return true

  const file = project.files.find((entry) => entry.path === '/.typsmthng/template.json' && !entry.isBinary)
  if (!file?.content) return false

  try {
    const parsed = JSON.parse(file.content) as { layoutLocked?: unknown }
    return parsed.layoutLocked === true
  } catch {
    return false
  }
}

function buildPagePreamble(pageSize: PageSize, source: string, layoutLocked: boolean): string {
  if (layoutLocked) return ''
  if (pageSize === 'auto') return ''
  if (/^#set\s+page\s*\(/m.test(source)) return ''

  if (pageSize === 'presentation-16-9') {
    return '#set page(width: 25.4cm, height: 14.29cm, margin: 2cm)\n'
  }
  return `#set page(paper: "${pageSize}")\n`
}

export function getInjectedPreambleLineCount(source: string): number {
  const { pageSize } = useSettingsStore.getState()
  const preamble = buildPagePreamble(pageSize, source, currentProjectLayoutLocked())
  if (!preamble) return 0
  return preamble.split('\n').length - 1
}

export function applyPagePreamble(source: string): string {
  const { pageSize } = useSettingsStore.getState()
  const preamble = buildPagePreamble(pageSize, source, currentProjectLayoutLocked())
  return preamble ? preamble + source : source
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
interface CompileRequest {
  source: string
  sourcePath?: string | null
  urgent: boolean
  requestId: number
}

let pendingRequest: CompileRequest | null = null
let compiling = false
let initPromise: Promise<void> | null = null
let lastEnsuredPackagesKey: string | null = null
let smoothedCompileTimeMs = 0
let nextCompileRequestId = 0
let latestRequestedCompileId = 0

function nextRequestId(): number {
  nextCompileRequestId += 1
  latestRequestedCompileId = nextCompileRequestId
  return nextCompileRequestId
}

function applyPackageCompatIfNeeded(source: string): string {
  if (!source.includes('@preview/')) return source
  return applyPackageImportCompatRewrites(source)
}

function effectiveCompileDelay(baseDelay: number): number {
  const adaptiveDelay = smoothedCompileTimeMs > 0
    ? Math.round(smoothedCompileTimeMs * COMPILE_DELAY_MULTIPLIER)
    : 0
  const floor = Math.min(MAX_COMPILE_DELAY_MS, Math.max(MIN_COMPILE_DELAY_MS, adaptiveDelay))
  return Math.max(baseDelay, floor)
}

export async function ensureCompilerReady(): Promise<void> {
  const store = useCompileStore.getState()
  if (isCompilerReady()) {
    store.setCompilerReady(true)
    return
  }
  if (initPromise) return initPromise

  store.setCompilerReady(false)
  initPromise = initCompiler().catch((err) => {
    store.setCompilerReady(false)
    initPromise = null
    throw err
  })
  return initPromise.then(() => {
    useCompileStore.getState().setCompilerReady(true)
  })
}

function scheduleDeferredCompile(request: CompileRequest): void {
  const { autoCompile, compileDelay } = useSettingsStore.getState()
  if (!autoCompile && !request.urgent) return

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  const delay = request.urgent ? 0 : effectiveCompileDelay(compileDelay)
  debounceTimer = setTimeout(() => {
    void doCompile(request)
  }, delay)
}

function isStaleRequest(requestId: number): boolean {
  return requestId < latestRequestedCompileId
}

async function waitForEditorIdle(requestId: number): Promise<number> {
  const start = Date.now()

  while (true) {
    if (isStaleRequest(requestId)) {
      return Date.now() - start
    }

    const now = Date.now()
    const elapsed = now - start
    if (elapsed >= MAX_RESULT_APPLY_DEFER_MS) {
      return elapsed
    }

    const lastUserEditAt = useEditorStore.getState().lastUserEditAt
    const idleFor = now - lastUserEditAt
    if (lastUserEditAt === 0 || idleFor >= TYPING_IDLE_WINDOW_MS) {
      return elapsed
    }

    const remainingIdle = TYPING_IDLE_WINDOW_MS - idleFor
    const remainingBudget = MAX_RESULT_APPLY_DEFER_MS - elapsed
    const waitMs = Math.max(8, Math.min(APPLY_DEFER_POLL_MS, remainingIdle, remainingBudget))
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
}

async function doCompile(request: CompileRequest): Promise<void> {
  if (compiling) {
    pendingRequest = request
    return
  }

  compiling = true
  const store = useCompileStore.getState()
  store.setStatus('compiling')

  const totalStart = perfMark()

  try {
    await ensureCompilerReady()

    const inputStart = perfMark()
    const project = useProjectStore.getState().getCurrentProject()
    const sourcePath = request.sourcePath ?? useProjectStore.getState().currentFilePath
    const compileInputs = buildCompileInputs({
      project,
      currentFilePath: sourcePath,
      liveSource: request.source,
      transformText: (_path, content) => applyPackageCompatIfNeeded(content),
    })
    perfMeasure('compile.input-build', inputStart, {
      files: compileInputs.textFiles.length + compileInputs.extraBinaryFiles.length,
      requestId: request.requestId,
    })

    const packageStart = perfMark()
    const packageSpecs = new Set<string>()
    const activePaths = new Set<string>()

    for (const file of compileInputs.textFiles) {
      activePaths.add(file.path)
      collectPreviewSpecsCached(file.path, file.content, packageSpecs)
    }
    pruneSpecCache(activePaths)

    if (packageSpecs.size > 0) {
      const specList = [...packageSpecs].sort()
      const ensureKey = specList.join('|')
      if (ensureKey !== lastEnsuredPackagesKey) {
        if (isStaleRequest(request.requestId)) return
        try {
          await ensurePackagesForCompile(specList)
          lastEnsuredPackagesKey = ensureKey
        } catch (err) {
          lastEnsuredPackagesKey = null
          if (!isStaleRequest(request.requestId)) {
            store.setStatus('error')
            store.setDiagnostics([{
              severity: 'error',
              path: '',
              range: '',
              message: `Failed to resolve package dependencies: ${
                err instanceof Error ? err.message : 'unknown package resolution error'
              }. Retry compilation when network is available.`,
            }])
          }
          return
        }
      }
    } else {
      lastEnsuredPackagesKey = ''
    }

    perfMeasure('compile.package-resolve', packageStart, {
      packages: packageSpecs.size,
      requestId: request.requestId,
    })

    const { pageSize } = useSettingsStore.getState()
    const preamble = buildPagePreamble(pageSize, compileInputs.mainSource, currentProjectLayoutLocked())
    const finalSource = preamble ? preamble + compileInputs.mainSource : compileInputs.mainSource

    const compileStageStart = perfMark()
    const result = await compileTypst(
      finalSource,
      compileInputs.extraFiles,
      compileInputs.mainPath,
      compileInputs.extraBinaryFiles,
    )
    perfMeasure('compile.run', compileStageStart, {
      requestId: request.requestId,
      success: result.success ? 1 : 0,
      diagnostics: result.diagnostics.length,
    })

    if (isStaleRequest(request.requestId)) {
      return
    }

    const totalSample = perfMeasure('compile.total', totalStart, {
      requestId: request.requestId,
      files: compileInputs.textFiles.length + compileInputs.extraBinaryFiles.length,
    })

    smoothedCompileTimeMs = smoothedCompileTimeMs > 0
      ? (smoothedCompileTimeMs * 0.75) + (totalSample.ms * 0.25)
      : totalSample.ms

    const applyWaitMs = await waitForEditorIdle(request.requestId)
    if (applyWaitMs > 1) {
      perfSample('compile.apply-wait', applyWaitMs, {
        requestId: request.requestId,
      })
    }

    if (isStaleRequest(request.requestId)) {
      return
    }

    store.setCompileTime(Math.round(totalSample.ms))
    store.setDiagnostics(result.diagnostics)

    if (result.timings) {
      perfSample('compile.engine.compile', result.timings.compileMs, {
        requestId: request.requestId,
      })
      perfSample('compile.engine.render', result.timings.renderMs, {
        requestId: request.requestId,
      })
    }

    if (result.success && result.svg && result.vectorData) {
      store.setSvgResult(result.svg, result.vectorData, result.pageDimensions)
      const hasErrors = result.diagnostics.some((d) => d.severity === 'error')
      store.setStatus(hasErrors ? 'error' : 'success')
    } else {
      store.setStatus('error')
    }
  } catch (err) {
    if (!isStaleRequest(request.requestId)) {
      console.error('Compilation failed:', err)
      store.setStatus('error')
      store.setDiagnostics([{
        severity: 'error',
        path: '',
        range: '',
        message: err instanceof Error ? err.message : 'Unknown compilation error',
      }])
    }
  } finally {
    compiling = false

    if (pendingRequest !== null) {
      const next = pendingRequest
      pendingRequest = null
      scheduleDeferredCompile(next)
    }
  }
}

export function requestCompile(source: string, sourcePath?: string | null): void {
  const { autoCompile, compileDelay } = useSettingsStore.getState()
  if (!autoCompile) return

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  const delay = effectiveCompileDelay(compileDelay)
  const request: CompileRequest = {
    source,
    sourcePath,
    urgent: false,
    requestId: nextRequestId(),
  }
  debounceTimer = setTimeout(() => {
    void doCompile(request)
  }, delay)
}

export function forceCompile(source: string, sourcePath?: string | null): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  return doCompile({ source, sourcePath, urgent: true, requestId: nextRequestId() })
}
