import { createStore, del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval'
import type { ProjectScaffold, ProjectScaffoldFile, ProjectTemplateMeta } from '@/stores/project-store'
import {
  compareSemver,
  formatResolvedSpec,
  normalizeResolvedSpec,
  parsePackageSpec,
  toResolvedSpec,
  type ParsedSpec,
  type ResolvedSpec,
} from './universe-spec'
import { extractTarEntriesFromGzip } from './tar'
import { applyPackageImportCompatRewrites } from './package-compat'

const UNIVERSE_NAMESPACE = 'preview'
const INDEX_URL = `https://packages.typst.org/${UNIVERSE_NAMESPACE}/index.json`
const INDEX_KEY = `${UNIVERSE_NAMESPACE}:index`
const IDB_MAX_PACKAGES = 50
const INDEX_STALE_MS = 10 * 60 * 1000
const DEFAULT_MARKETPLACE_LIMIT = 80
export const MIN_MARKETPLACE_QUERY_LENGTH = 2
const ENSURE_PACKAGE_CONCURRENCY = 4

const universeStore = createStore('typsmthng-universe', 'cache')

interface UniverseIndexTemplateInfo {
  path: string
  entrypoint: string
  thumbnail?: string
}

interface UniverseIndexEntry {
  name: string
  version: string
  template?: UniverseIndexTemplateInfo
}

interface UniverseIndexCache {
  entries: UniverseIndexEntry[]
  fetchedAt: number
}

interface PackageArchiveCache {
  archive: Uint8Array
  fetchedAt: number
  lastAccessed: number
}

export interface PreparedPackageFile {
  path: string
  data: Uint8Array
  isText: boolean
  textContent?: string
  mtime: number
}

export interface PreparedPackage {
  spec: ResolvedSpec
  files: PreparedPackageFile[]
}

export interface UniverseMarketplacePackage {
  name: string
  latestVersion: string
  latestResolvedSpec: string
  initCommand: string
  isTemplate: boolean
  disabledReason?: string
  templateEntrypoint?: string
  templateThumbnail?: string
}

let inMemoryIndex: UniverseIndexCache | null = null
const inMemoryArchives = new Map<string, PackageArchiveCache>()
const inMemoryPrepared = new Map<string, PreparedPackage>()
const inMemoryRuntimeDeps = new Map<string, string[]>()
const inFlightEnsureDeps = new Map<string, Promise<string[]>>()

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const TEXT_EXTENSIONS = [
  '.typ', '.txt', '.md', '.tex', '.bib', '.bibtex', '.ris', '.csv', '.json',
  '.xml', '.html', '.css', '.js', '.ts', '.yaml', '.yml', '.toml', '.cfg',
  '.ini', '.log', '.sh', '.bat', '.ps1', '.py', '.rb', '.rs', '.svg',
]

interface ParsedManifest {
  packageName: string
  packageVersion: string
  packageEntrypoint?: string
  template?: {
    path: string
    entrypoint: string
    thumbnail?: string
  }
}

function packageCacheKey(spec: ResolvedSpec): string {
  return `${UNIVERSE_NAMESPACE}:pkg:${spec.name}:${spec.version}`
}

function inMemoryPreparedKey(spec: ResolvedSpec): string {
  return formatResolvedSpec(spec)
}

function normalizeSimplePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized) return ''
  if (normalized.startsWith('/')) {
    throw new Error(`unsafe path in template manifest: ${input}`)
  }

  const parts = normalized.split('/').filter(Boolean)
  for (const part of parts) {
    if (part === '..') {
      throw new Error(`unsafe path traversal in template manifest: ${input}`)
    }
  }

  return parts.join('/')
}

function escapeTomlString(input: string): string {
  return input
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

function parseManifestToml(content: string): ParsedManifest {
  let section = ''
  const manifest: ParsedManifest = {
    packageName: '',
    packageVersion: '',
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const sectionMatch = line.match(/^\[([a-zA-Z0-9_.-]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      continue
    }

    const keyValue = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/)
    if (!keyValue) continue

    const key = keyValue[1]
    const value = escapeTomlString(keyValue[2])

    if (section === 'package') {
      if (key === 'name') manifest.packageName = value
      if (key === 'version') manifest.packageVersion = value
      if (key === 'entrypoint') manifest.packageEntrypoint = value
      continue
    }

    if (section === 'template') {
      manifest.template ??= { path: '', entrypoint: '' }
      if (key === 'path') manifest.template.path = value
      if (key === 'entrypoint') manifest.template.entrypoint = value
      if (key === 'thumbnail') manifest.template.thumbnail = value
    }
  }

  if (!manifest.packageName || !manifest.packageVersion) {
    throw new Error('package manifest is malformed (missing package.name or package.version)')
  }

  return manifest
}

function isTextPath(path: string): boolean {
  const lower = path.toLowerCase()
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function normalizeImportSpec(raw: string): string {
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, '')
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`
}

function normalizePreviewImportSpec(raw: string): string | null {
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, '')
  if (cleaned.startsWith('@preview/')) return cleaned
  if (cleaned.startsWith('preview/')) return `@${cleaned}`
  return null
}

export function findPreviewImportSpecs(source: string): string[] {
  const found = new Set<string>()
  const re = /@preview\/[a-zA-Z][a-zA-Z0-9-]*(?::\d+\.\d+\.\d+)?/g
  let match: RegExpExecArray | null = null

  while ((match = re.exec(source)) !== null) {
    found.add(normalizeImportSpec(match[0]))
  }

  return [...found]
}

function isTypstFilePath(path: string): boolean {
  return path.toLowerCase().endsWith('.typ')
}

function parseTypstImportTargets(source: string): string[] {
  const targets: string[] = []
  // Matches:
  //   #import "foo.typ"
  //   #import("foo.typ")
  //   #include "foo.typ"
  const re = /#(?:import|include)\s*(?:\(\s*)?(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g
  let match: RegExpExecArray | null = null

  while ((match = re.exec(source)) !== null) {
    const raw = match[1] ?? match[2]
    if (!raw) continue
    targets.push(raw.trim())
  }

  return targets
}

function hasExtension(path: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(path)
}

function resolveExistingTypstPath(path: string, files: Map<string, PreparedPackageFile>): string | null {
  const clean = path.replace(/^\/+/, '')
  if (!clean) return null

  const candidates = [clean]
  if (!hasExtension(clean)) {
    candidates.push(`${clean}.typ`)
    candidates.push(`${clean}/main.typ`)
  }

  for (const candidate of candidates) {
    const file = files.get(candidate)
    if (file?.isText && file.textContent && isTypstFilePath(candidate)) {
      return candidate
    }
  }
  return null
}

const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

function resolveLocalImportPath(currentFilePath: string, target: string): string | null {
  const clean = target.trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')
  if (!clean) return null
  if (clean.startsWith('@')) return null
  if (URI_SCHEME_RE.test(clean)) return null

  const baseParts = currentFilePath.split('/').filter(Boolean)
  baseParts.pop()

  const rawParts = clean.startsWith('/')
    ? clean.split('/').filter(Boolean)
    : [...baseParts, ...clean.split('/').filter(Boolean)]

  const resolved: string[] = []
  for (const part of rawParts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
      continue
    }
    if (part.includes('\0')) return null
    resolved.push(part)
  }

  if (resolved.length === 0) return null
  return resolved.join('/')
}

function parseManifestFromPackage(pkg: PreparedPackage): ParsedManifest | null {
  const manifestFile = getFileFromPrepared(pkg, 'typst.toml')
  if (!manifestFile?.textContent) return null
  try {
    return parseManifestToml(manifestFile.textContent)
  } catch {
    return null
  }
}

function applyCompatToPreparedPackage(pkg: PreparedPackage): PreparedPackage {
  let changed = false
  const nextFiles = pkg.files.map((file) => {
    if (!file.isText || !file.textContent || !isTypstFilePath(file.path)) return file
    const compatText = applyPackageImportCompatRewrites(file.textContent)
    if (compatText === file.textContent) return file
    changed = true
    return {
      ...file,
      textContent: compatText,
      data: textEncoder.encode(compatText),
    }
  })

  if (!changed) return pkg
  return {
    ...pkg,
    files: nextFiles,
  }
}

function discoverRuntimeDependencies(pkg: PreparedPackage): string[] {
  const cacheKey = inMemoryPreparedKey(pkg.spec)
  const cached = inMemoryRuntimeDeps.get(cacheKey)
  if (cached) return cached

  const files = new Map<string, PreparedPackageFile>()
  for (const file of pkg.files) {
    files.set(file.path, file)
  }

  const manifest = parseManifestFromPackage(pkg)
  const seedCandidates: string[] = []

  if (manifest?.packageEntrypoint) {
    try {
      const normalized = normalizeSimplePath(manifest.packageEntrypoint)
      if (normalized) seedCandidates.push(normalized)
    } catch {
      // ignore malformed entrypoint for dependency traversal
    }
  }
  seedCandidates.push('lib.typ')

  const pending: string[] = []
  const visited = new Set<string>()
  const discovered = new Set<string>()

  const enqueue = (path: string | null) => {
    if (!path || visited.has(path)) return
    pending.push(path)
  }

  for (const candidate of seedCandidates) {
    const resolved = resolveExistingTypstPath(candidate, files)
    if (resolved) {
      enqueue(resolved)
      break
    }
  }

  if (pending.length === 0) {
    const fallback = [...files.keys()]
      .filter((path) => isTypstFilePath(path))
      .filter((path) => !path.startsWith('docs/') && !path.startsWith('examples/') && !path.startsWith('tests/'))
      .sort((a, b) => a.length - b.length)[0] ?? null
    enqueue(fallback)
  }

  while (pending.length > 0) {
    const currentPath = pending.shift()!
    if (visited.has(currentPath)) continue
    visited.add(currentPath)

    const current = files.get(currentPath)
    if (!current?.isText || !current.textContent || !isTypstFilePath(currentPath)) continue

    for (const target of parseTypstImportTargets(current.textContent)) {
      const previewImport = normalizePreviewImportSpec(target)
      if (previewImport) {
        discovered.add(previewImport)
        continue
      }

      const localImportPath = resolveLocalImportPath(currentPath, target)
      if (!localImportPath) continue
      enqueue(resolveExistingTypstPath(localImportPath, files))
    }
  }

  const deps = [...discovered]
  inMemoryRuntimeDeps.set(cacheKey, deps)
  return deps
}

function normalizeIndexEntries(input: unknown): UniverseIndexEntry[] {
  if (!Array.isArray(input)) {
    throw new Error('failed to parse package index: expected array')
  }

  const entries: UniverseIndexEntry[] = []
  for (const row of input) {
    if (!row || typeof row !== 'object') continue
    const obj = row as Record<string, unknown>

    if (typeof obj.name !== 'string' || typeof obj.version !== 'string') continue

    const item: UniverseIndexEntry = {
      name: obj.name,
      version: obj.version,
    }

    const template = obj.template
    if (template && typeof template === 'object') {
      const tpl = template as Record<string, unknown>
      if (typeof tpl.path === 'string' && typeof tpl.entrypoint === 'string') {
        item.template = {
          path: tpl.path,
          entrypoint: tpl.entrypoint,
          thumbnail: typeof tpl.thumbnail === 'string' ? tpl.thumbnail : undefined,
        }
      }
    }

    entries.push(item)
  }

  return entries
}

async function fetchLatestIndexFromNetwork(): Promise<UniverseIndexCache> {
  const response = await fetch(INDEX_URL)
  if (!response.ok) {
    throw new Error(`failed to fetch package index (${response.status})`)
  }

  const json = await response.json()
  const entries = normalizeIndexEntries(json)
  const cache: UniverseIndexCache = {
    entries,
    fetchedAt: Date.now(),
  }

  inMemoryIndex = cache
  await idbSet(INDEX_KEY, cache, universeStore)

  return cache
}

async function getIndexCache(): Promise<UniverseIndexCache> {
  const now = Date.now()

  if (inMemoryIndex) {
    if (now - inMemoryIndex.fetchedAt > INDEX_STALE_MS) {
      void fetchLatestIndexFromNetwork().catch(() => {
        // Non-fatal refresh path; stale cache remains usable.
      })
    }
    return inMemoryIndex
  }

  const persisted = await idbGet<UniverseIndexCache>(INDEX_KEY, universeStore)
  if (persisted && Array.isArray(persisted.entries)) {
    inMemoryIndex = persisted
    if (now - persisted.fetchedAt > INDEX_STALE_MS) {
      void fetchLatestIndexFromNetwork().catch(() => {
        // Non-fatal refresh path; stale cache remains usable.
      })
    }
    return persisted
  }

  return fetchLatestIndexFromNetwork()
}

function toLatestEntries(entries: UniverseIndexEntry[]): UniverseIndexEntry[] {
  const latestByName = new Map<string, UniverseIndexEntry>()

  for (const entry of entries) {
    const current = latestByName.get(entry.name)
    if (!current) {
      latestByName.set(entry.name, entry)
      continue
    }

    if (compareSemver(entry.version, current.version) > 0) {
      latestByName.set(entry.name, entry)
    }
  }

  return [...latestByName.values()]
}

function packageSearchRank(name: string, query: string): number {
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  return 3
}

export async function searchUniverseMarketplace(
  query: string,
  limit = DEFAULT_MARKETPLACE_LIMIT,
): Promise<UniverseMarketplacePackage[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length < MIN_MARKETPLACE_QUERY_LENGTH) {
    return []
  }

  const index = await getIndexCache()
  const latestEntries = toLatestEntries(index.entries)
  const filtered = latestEntries.filter((entry) => entry.name.toLowerCase().includes(normalizedQuery))

  filtered.sort((a, b) => {
    const aName = a.name.toLowerCase()
    const bName = b.name.toLowerCase()
    const rankDelta = packageSearchRank(aName, normalizedQuery) - packageSearchRank(bName, normalizedQuery)
    if (rankDelta !== 0) return rankDelta
    return aName.localeCompare(bName)
  })

  const maxResults = Math.max(1, Math.floor(limit))
  return filtered.slice(0, maxResults).map((entry) => ({
    name: entry.name,
    latestVersion: entry.version,
    latestResolvedSpec: `@${UNIVERSE_NAMESPACE}/${entry.name}:${entry.version}`,
    initCommand: `typst init @${UNIVERSE_NAMESPACE}/${entry.name}`,
    isTemplate: Boolean(entry.template),
    disabledReason: entry.template
      ? undefined
      : 'Package exists in Typst Universe, but it does not expose a template scaffold.',
    templateEntrypoint: entry.template?.entrypoint,
    templateThumbnail: entry.template?.thumbnail,
  }))
}

async function evictPackageCacheIfNeeded(): Promise<void> {
  const keys = await idbKeys(universeStore)
  const packageKeys = keys
    .map((key) => String(key))
    .filter((key) => key.startsWith(`${UNIVERSE_NAMESPACE}:pkg:`))

  if (packageKeys.length <= IDB_MAX_PACKAGES) return

  const records = await Promise.all(packageKeys.map(async (key) => {
    const value = await idbGet<PackageArchiveCache>(key, universeStore)
    return { key, value }
  }))

  records.sort((a, b) => {
    const aAccess = a.value?.lastAccessed ?? 0
    const bAccess = b.value?.lastAccessed ?? 0
    return aAccess - bAccess
  })

  const toDelete = records.slice(0, Math.max(0, records.length - IDB_MAX_PACKAGES))
  for (const row of toDelete) {
    await idbDel(row.key, universeStore)
    inMemoryArchives.delete(row.key)
  }
}

async function getPackageArchive(spec: ResolvedSpec): Promise<Uint8Array> {
  const cacheKey = packageCacheKey(spec)
  const now = Date.now()

  const inMemory = inMemoryArchives.get(cacheKey)
  if (inMemory) {
    inMemory.lastAccessed = now
    void idbSet(cacheKey, inMemory, universeStore)
    return inMemory.archive
  }

  const persisted = await idbGet<PackageArchiveCache>(cacheKey, universeStore)
  if (persisted?.archive) {
    persisted.lastAccessed = now
    inMemoryArchives.set(cacheKey, persisted)
    void idbSet(cacheKey, persisted, universeStore)
    return persisted.archive
  }

  const url = `https://packages.typst.org/${UNIVERSE_NAMESPACE}/${spec.name}-${spec.version}.tar.gz`
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new Error(`network error while downloading ${formatResolvedSpec(spec)}`)
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`package ${formatResolvedSpec(spec)} was not found in Typst Universe`)
    }
    throw new Error(`failed to download ${formatResolvedSpec(spec)} (${response.status})`)
  }

  const archive = new Uint8Array(await response.arrayBuffer())
  const record: PackageArchiveCache = {
    archive,
    fetchedAt: now,
    lastAccessed: now,
  }

  inMemoryArchives.set(cacheKey, record)
  await idbSet(cacheKey, record, universeStore)
  await evictPackageCacheIfNeeded()

  return archive
}

function decodeVersion(specVersion: unknown): string {
  if (specVersion === undefined || specVersion === null) return ''
  if (typeof specVersion === 'string') return specVersion

  if (specVersion && typeof specVersion === 'object') {
    const obj = specVersion as Record<string, unknown>
    if (
      typeof obj.major === 'number'
      && typeof obj.minor === 'number'
      && typeof obj.patch === 'number'
    ) {
      return `${obj.major}.${obj.minor}.${obj.patch}`
    }
  }

  return ''
}

function toResolvedFromUnknownSpec(spec: unknown): ResolvedSpec | null {
  if (!spec || typeof spec !== 'object') return null
  const obj = spec as Record<string, unknown>

  const namespace = String(obj.namespace ?? '')
  const name = String(obj.name ?? '')
  const version = decodeVersion(obj.version)

  if (!namespace || !name || !version) return null
  if (namespace !== UNIVERSE_NAMESPACE) return null

  return {
    namespace: 'preview',
    name,
    version,
  }
}

async function preparePackage(spec: ResolvedSpec): Promise<PreparedPackage> {
  const memoryKey = inMemoryPreparedKey(spec)
  const existing = inMemoryPrepared.get(memoryKey)
  if (existing) {
    const compatExisting = applyCompatToPreparedPackage(existing)
    if (compatExisting !== existing) {
      inMemoryPrepared.set(memoryKey, compatExisting)
    }
    return compatExisting
  }

  const archive = await getPackageArchive(spec)
  const entries = extractTarEntriesFromGzip(archive)

  const files: PreparedPackageFile[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue

    const isText = isTextPath(entry.path)
    const data = new Uint8Array(entry.data)
    const decoded = isText ? textDecoder.decode(data) : undefined
    const textContent = decoded && isTypstFilePath(entry.path)
      ? applyPackageImportCompatRewrites(decoded)
      : decoded

    files.push({
      path: entry.path,
      data: textContent && textContent !== decoded ? textEncoder.encode(textContent) : data,
      isText,
      textContent,
      mtime: entry.mtime,
    })
  }

  const prepared: PreparedPackage = applyCompatToPreparedPackage({ spec, files })
  inMemoryPrepared.set(memoryKey, prepared)
  return prepared
}

function getFileFromPrepared(pkg: PreparedPackage, path: string): PreparedPackageFile | undefined {
  return pkg.files.find((file) => file.path === path)
}

function isPathWithin(path: string, baseDir: string): boolean {
  if (!baseDir) return false
  return path === baseDir || path.startsWith(`${baseDir}/`)
}

function toScaffoldFile(file: PreparedPackageFile, newPath: string): ProjectScaffoldFile {
  if (file.isText) {
    return {
      path: newPath,
      content: file.textContent ?? textDecoder.decode(file.data),
      isBinary: false,
    }
  }

  return {
    path: newPath,
    content: '',
    isBinary: true,
    binaryData: new Uint8Array(file.data),
  }
}

function buildTemplateMetadata(spec: ResolvedSpec, entrypoint: string): ProjectTemplateMeta {
  return {
    source: 'typst-universe',
    resolvedSpec: formatResolvedSpec(spec),
    templateEntrypoint: entrypoint,
    layoutLocked: true,
    createdAt: Date.now(),
  }
}

export async function resolveSpec(inputSpec: string): Promise<ResolvedSpec> {
  const parsed = parsePackageSpec(inputSpec)

  if (parsed.version) {
    return toResolvedSpec(parsed)
  }

  const index = await getIndexCache()
  const matches = index.entries
    .filter((entry) => entry.name === parsed.name)
    .map((entry) => entry.version)

  if (matches.length === 0) {
    throw new Error(`failed to find package @preview/${parsed.name}`)
  }

  matches.sort(compareSemver)
  const latest = matches[matches.length - 1]
  return normalizeResolvedSpec(parsed, latest)
}

export function getPreparedPackageForResolver(spec: unknown): PreparedPackage | undefined {
  const resolved = toResolvedFromUnknownSpec(spec)
  if (!resolved) return undefined
  return inMemoryPrepared.get(inMemoryPreparedKey(resolved))
}

export async function fetchTemplateScaffold(spec: ResolvedSpec): Promise<ProjectScaffold> {
  const pkg = await preparePackage(spec)

  const manifestFile = getFileFromPrepared(pkg, 'typst.toml')
  if (!manifestFile || !manifestFile.textContent) {
    throw new Error('failed to read package manifest (typst.toml not found)')
  }

  const manifest = parseManifestToml(manifestFile.textContent)
  if (manifest.packageName !== spec.name) {
    throw new Error(`package manifest contains mismatched name \`${manifest.packageName}\``)
  }
  if (manifest.packageVersion !== spec.version) {
    throw new Error(`package manifest contains mismatched version ${manifest.packageVersion}`)
  }

  const template = manifest.template
  if (!template) {
    throw new Error(`package ${formatResolvedSpec(spec)} is not a template`)
  }

  const templatePath = normalizeSimplePath(template.path)
  if (!templatePath) {
    throw new Error('package template path is empty')
  }

  const templateEntry = normalizeSimplePath(template.entrypoint)
  if (!templateEntry) {
    throw new Error('package template entrypoint is empty')
  }

  const templateEntrypointPath = normalizeSimplePath(`${templatePath}/${templateEntry}`)

  const scaffoldFiles: ProjectScaffoldFile[] = []

  for (const file of pkg.files) {
    const normalizedPath = normalizeSimplePath(file.path)
    if (!normalizedPath) continue
    const scaffoldFile = toScaffoldFile(file, `/${normalizedPath}`)
    if (!scaffoldFile.isBinary && scaffoldFile.path.toLowerCase().endsWith('.typ')) {
      const compatContent = applyPackageImportCompatRewrites(scaffoldFile.content)
      scaffoldFiles.push(compatContent === scaffoldFile.content ? scaffoldFile : {
        ...scaffoldFile,
        content: compatContent,
      })
      continue
    }
    scaffoldFiles.push(scaffoldFile)
  }

  if (!scaffoldFiles.some((file) => isPathWithin(file.path.replace(/^\//, ''), templatePath))) {
    throw new Error(`template directory does not contain scaffold files (at ${templatePath})`)
  }

  const mainFile = `/${templateEntrypointPath}`
  const hasMain = scaffoldFiles.some((file) => file.path === mainFile)
  if (!hasMain) {
    throw new Error(`template entrypoint does not exist in template directory (at ${mainFile})`)
  }

  const templateMeta = buildTemplateMetadata(spec, templateEntrypointPath)
  const metadataFile: ProjectScaffoldFile = {
    path: '/.typsmthng/template.json',
    content: `${JSON.stringify(templateMeta, null, 2)}\n`,
    isBinary: false,
  }

  const files = scaffoldFiles.filter((file) => file.path !== metadataFile.path)
  files.push(metadataFile)

  return {
    files,
    mainFile,
    templateMeta,
  }
}

async function resolveMaybeVersionless(spec: ParsedSpec): Promise<ResolvedSpec> {
  if (spec.version) return toResolvedSpec(spec)
  return resolveSpec(`@${spec.namespace}/${spec.name}`)
}

async function mapLimit<T, U>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) return []

  const output = new Array<U>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) break
      output[current] = await run(items[current])
    }
  })
  await Promise.all(workers)
  return output
}

function parseSpecSafe(input: string): ParsedSpec | null {
  try {
    return parsePackageSpec(input)
  } catch {
    return null
  }
}

async function ensureResolvedPackageDependencies(resolved: ResolvedSpec): Promise<string[]> {
  const key = formatResolvedSpec(resolved)
  const existing = inFlightEnsureDeps.get(key)
  if (existing) return existing

  const task = (async () => {
    const pkg = await preparePackage(resolved)
    return discoverRuntimeDependencies(pkg)
  })()

  inFlightEnsureDeps.set(key, task)
  try {
    return await task
  } finally {
    inFlightEnsureDeps.delete(key)
  }
}

export async function ensurePackagesForCompile(specs: string[]): Promise<void> {
  let frontier = specs
    .map((spec) => parseSpecSafe(spec))
    .filter((spec): spec is ParsedSpec => spec !== null)

  const visited = new Set<string>()

  while (frontier.length > 0) {
    const resolvedEntries = await mapLimit(frontier, ENSURE_PACKAGE_CONCURRENCY, async (parsed) => {
      try {
        return await resolveMaybeVersionless(parsed)
      } catch {
        return null
      }
    })

    const toProcess: ResolvedSpec[] = []
    for (const resolved of resolvedEntries) {
      if (!resolved) continue
      const key = formatResolvedSpec(resolved)
      if (visited.has(key)) continue
      visited.add(key)
      toProcess.push(resolved)
    }

    const discoveredDeps = await mapLimit(
      toProcess,
      ENSURE_PACKAGE_CONCURRENCY,
      ensureResolvedPackageDependencies,
    )

    const nextFrontier: ParsedSpec[] = []
    for (const deps of discoveredDeps) {
      for (const dep of deps) {
        const parsed = parseSpecSafe(dep)
        if (parsed) nextFrontier.push(parsed)
      }
    }
    frontier = nextFrontier
  }
}

export function withInitCommandInScaffold(
  scaffold: ProjectScaffold,
  command: string,
): ProjectScaffold {
  if (!scaffold.templateMeta) return scaffold

  const templateMeta: ProjectTemplateMeta = {
    ...scaffold.templateMeta,
    initCommand: command,
  }

  const files = scaffold.files.map((file) => {
    if (file.path !== '/.typsmthng/template.json') return file
    return {
      ...file,
      content: `${JSON.stringify(templateMeta, null, 2)}\n`,
    }
  })

  return {
    ...scaffold,
    files,
    templateMeta,
  }
}
