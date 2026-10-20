import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import {
  isQuotaExceededError,
  useProjectStore,
  type CreateProjectResult,
  type ProjectFile,
  type ProjectScaffold,
} from '@/stores/project-store'
import { useEditorStore } from '@/stores/editor-store'
import { isKnownTextPath, isLatexPath, shouldTreatUploadAsText } from '@/lib/file-classification'
import { convertLatexToTypst, type ConversionOptions, type ConversionResult, type ConversionWarning } from '@/lib/latex-converter'
import { downloadBlob } from '@/lib/download'
import { basename, dirname } from '@/lib/paths'

export interface LatexImportResult {
  projectName: string
  fileCount: number
  texFilesConverted: number
  warnings: ConversionWarning[]
  metadata: ConversionResult['metadata']
}

export interface ProjectImportResult {
  projectName: string
  fileCount: number
  texFilesConverted: number
  warnings: ConversionWarning[]
  metadata: ConversionResult['metadata']
}

interface ZipImportEntry {
  path: string
  data: Uint8Array
  text?: boolean
}

export interface BuiltProjectFiles {
  projectFiles: ProjectFile[]
  texFilesConverted: number
  warnings: ConversionWarning[]
  metadata: ConversionResult['metadata']
  mainFile: string | null
}

const PREFERRED_MAIN_NAME = /\/(main|paper|thesis|article|report)\.typ$/i
const PROJECT_MANIFEST_PATH = '.typsmthng/project.json'
const PROJECT_MANIFEST_FORMAT = 'typsmthng-project'
const PROJECT_MANIFEST_VERSION = 1
const PRESERVED_MANIFEST_PATH = /^\.typsmthng\/project\.user(?:-\d+)?\.json$/

function projectManifestBytes(mainFile: string, projectName: string, projectFiles: ProjectFile[], preservedManifestPath?: string): Uint8Array {
  return encodeTextForZip(JSON.stringify({
    format: PROJECT_MANIFEST_FORMAT,
    version: PROJECT_MANIFEST_VERSION,
    mainFile,
    projectName,
    fileTypes: Object.fromEntries(projectFiles.map((file) => [file.path, file.isBinary ? 'binary' : 'text'])),
    ...(preservedManifestPath ? { preservedManifestPath } : {}),
  }, null, 2))
}

function addProjectManifest(
  files: Record<string, Uint8Array>,
  mainFile: string,
  projectName: string,
  projectFiles: ProjectFile[],
  folderPrefix = '',
): void {
  const prefix = folderPrefix ? `${folderPrefix}/` : ''
  const manifestZipPath = `${prefix}${PROJECT_MANIFEST_PATH}`
  let preservedManifestPath: string | undefined

  if (Object.prototype.hasOwnProperty.call(files, manifestZipPath)) {
    let suffix = 1
    do {
      preservedManifestPath = suffix === 1
        ? '.typsmthng/project.user.json'
        : `.typsmthng/project.user-${suffix}.json`
      suffix++
    } while (Object.prototype.hasOwnProperty.call(files, `${prefix}${preservedManifestPath}`))

    files[`${prefix}${preservedManifestPath}`] = files[manifestZipPath]
  }

  files[manifestZipPath] = projectManifestBytes(mainFile, projectName, projectFiles, preservedManifestPath)
}

function takeManifestMainFile(entries: ZipImportEntry[]): {
  entries: ZipImportEntry[]
  manifestMainFile: string | null
  projectName?: string
} {
  const manifest = entries.find((entry) => entry.path === PROJECT_MANIFEST_PATH)
  if (!manifest) return { entries, manifestMainFile: null }

  try {
    const value: unknown = JSON.parse(strFromU8(manifest.data))
    if (!value || typeof value !== 'object') return { entries, manifestMainFile: null }
    const { format, version, mainFile, preservedManifestPath, projectName, fileTypes } = value as {
      format?: unknown
      version?: unknown
      mainFile?: unknown
      preservedManifestPath?: unknown
      projectName?: unknown
      fileTypes?: unknown
    }
    if (
      format !== PROJECT_MANIFEST_FORMAT
      || version !== PROJECT_MANIFEST_VERSION
      || typeof mainFile !== 'string'
      || (mainFile !== '' && !mainFile.startsWith('/'))
    ) {
      return { entries, manifestMainFile: null }
    }
    const normalized = normalizeZipPath(mainFile)
    if (
      mainFile !== '' && (!normalized
      || `/${normalized}` !== mainFile
      || !entries.some((entry) => entry.path === normalized))
    ) {
      return { entries, manifestMainFile: null }
    }

    let sourceEntries = entries.filter((entry) => entry.path !== PROJECT_MANIFEST_PATH)
    if (typeof preservedManifestPath === 'string' && PRESERVED_MANIFEST_PATH.test(preservedManifestPath)) {
      const preservedEntry = sourceEntries.find((entry) => entry.path === preservedManifestPath)
      if (preservedEntry) {
        sourceEntries = sourceEntries.filter((entry) => entry.path !== preservedManifestPath)
        sourceEntries.push({ path: PROJECT_MANIFEST_PATH, data: preservedEntry.data })
      }
    }
    if (fileTypes && typeof fileTypes === 'object') {
      const types = new Map(Object.entries(fileTypes))
      sourceEntries = sourceEntries.map((entry) => ({
        ...entry,
        ...(types.get(`/${entry.path}`) === 'text' ? { text: true } : {}),
        ...(types.get(`/${entry.path}`) === 'binary' ? { text: false } : {}),
      }))
      for (const [path, type] of types) {
        const normalizedPath = normalizeZipPath(path)
        if (type === 'text' && path === `/${normalizedPath}` && basename(path) === '.folder'
          && !sourceEntries.some((entry) => entry.path === normalizedPath)) {
          sourceEntries.push({ path: normalizedPath, data: new Uint8Array(), text: true })
        }
      }
    }
    return {
      entries: sourceEntries,
      manifestMainFile: mainFile,
      ...(typeof projectName === 'string' && projectName.trim() ? { projectName } : {}),
    }
  } catch {
    return { entries, manifestMainFile: null }
  }
}

function resolveImportedMainFile(projectFiles: ProjectFile[]): string {
  const typFiles = projectFiles.filter((f) => !f.isBinary && /\.typ$/i.test(f.path))
  const rootTyp = typFiles.filter((f) => !f.path.slice(1).includes('/'))

  return typFiles.find((f) => f.path === '/main.typ')?.path
    || rootTyp.find((f) => PREFERRED_MAIN_NAME.test(f.path))?.path
    || rootTyp[0]?.path
    || typFiles.find((f) => PREFERRED_MAIN_NAME.test(f.path))?.path
    || typFiles.find((f) => f.path.endsWith('/main.typ'))?.path
    || [...typFiles].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0]?.path
    || projectFiles[0]?.path
    || '/main.typ'
}

function shouldSkipZipPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.endsWith('/') || normalized.split('/').some((part) => part === '__MACOSX' || part === '.DS_Store')
}

function normalizeZipPath(path: string): string {
  if (Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || /^[A-Za-z]:/.test(path) || path.startsWith('\\\\')) return ''
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.')
  // Reject zip-slip / traversal entries before they become project paths.
  if (parts.some((part) => part === '..')) return ''
  return parts.join('/')
}

function toProjectPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function latexFallbackContent(source: string): string {
  return `// LaTeX conversion failed for this file.\n// Original .tex content preserved below:\n\n/* ${source.replace(/\/\*/g, '/ *').replace(/\*\//g, '* /')} */\n`
}

/** True when a zip tree looks like a single Typst or LaTeX project root. */
export function looksLikeImportableProject(paths: string[]): boolean {
  return paths.some((path) => {
    const normalizedPath = path.toLowerCase()
    const isRootFile = !normalizedPath.includes('/')
    return normalizedPath === 'main.typ'
      || normalizedPath === 'main.tex'
      || normalizedPath === '.typsmthng/template.json'
      || normalizedPath === PROJECT_MANIFEST_PATH
      // Only root-level sources count. Nested ancillary .typ/.tex alone must
      // not unwrap an unrelated single top-level folder (e.g. photos + notes).
      || (isRootFile && normalizedPath.endsWith('.typ'))
      || (isRootFile && isLatexPath(normalizedPath))
  })
}

function collectZipEntries(unzipped: ReturnType<typeof unzipSync>): ZipImportEntry[] {
  return Object.entries(unzipped)
    .filter(([path]) => !shouldSkipZipPath(path))
    .map(([path, data]) => ({ path: normalizeZipPath(path), data }))
    .filter((entry) => entry.path.length > 0)
}

/**
 * If every entry lives under one top-level folder and that folder looks like a
 * project, strip the folder and use it as the project name.
 */
export function normalizeSingleProjectZipEntries(
  unzipped: ReturnType<typeof unzipSync>,
  fallbackProjectName: string,
): { projectName: string; entries: ZipImportEntry[] } {
  const entries = collectZipEntries(unzipped)

  const rootFolder = entries.reduce<string | null | undefined>((root, entry) => {
    const slashIndex = entry.path.indexOf('/')
    if (slashIndex < 0) return null

    const candidate = entry.path.slice(0, slashIndex)
    if (root === undefined) return candidate
    return root === candidate ? root : null
  }, undefined)

  if (!rootFolder) {
    return { projectName: fallbackProjectName, entries }
  }

  const strippedEntries = entries
    .map((entry) => ({ path: entry.path.slice(rootFolder.length + 1), data: entry.data }))
    .filter((entry) => entry.path.length > 0)

  if (!looksLikeImportableProject(strippedEntries.map((entry) => entry.path))) {
    return { projectName: fallbackProjectName, entries }
  }

  return {
    projectName: rootFolder,
    entries: strippedEntries,
  }
}

async function convertLatexSource(
  source: string,
  sourceLabel: string,
  options?: ConversionOptions,
): Promise<{ content: string; warnings: ConversionWarning[]; metadata: ConversionResult['metadata'] | null }> {
  try {
    const result = await convertLatexToTypst(source, options)
    return {
      content: result.typst,
      warnings: result.warnings,
      metadata: result.metadata,
    }
  } catch (err) {
    console.warn(`LaTeX conversion failed for "${sourceLabel}":`, err)
    return {
      content: latexFallbackContent(source),
      warnings: [{
        message: `Conversion failed for ${sourceLabel}: ${err instanceof Error ? err.message : 'unknown error'}`,
        construct: sourceLabel,
      }],
      metadata: null,
    }
  }
}

/** Merge conversion metadata across multi-file imports without dropping earlier fields. */
function mergeConversionMetadata(
  current: ConversionResult['metadata'],
  next: ConversionResult['metadata'] | null,
): ConversionResult['metadata'] {
  if (!next) return current

  const packages = Array.from(new Set([...(current.packages ?? []), ...(next.packages ?? [])]))
  return {
    title: next.title || current.title,
    author: next.author || current.author,
    date: next.date || current.date,
    documentclass: next.documentclass || current.documentclass,
    packages,
  }
}

function dedupeProjectPath(path: string, used: Set<string>, reserved = new Set<string>()): string {
  if (!used.has(path)) {
    used.add(path)
    return path
  }

  const parent = dirname(path)
  const prefix = parent ? `${parent}/` : path.startsWith('/') ? '/' : ''
  const name = basename(path)
  const lastDot = name.lastIndexOf('.')
  const hasExt = lastDot > 0
  const stem = hasExt ? name.slice(0, lastDot) : name
  const ext = hasExt ? name.slice(lastDot) : ''

  let suffix = 2
  let candidate = `${prefix}${stem}-${suffix}${ext}`
  while (used.has(candidate) || reserved.has(candidate)) {
    suffix++
    candidate = `${prefix}${stem}-${suffix}${ext}`
  }
  used.add(candidate)
  return candidate
}

/** Resolve references inside the virtual project, without escaping its root. */
function resolveProjectReference(directory: string, reference: string): string | null {
  const segments = (reference.startsWith('/') ? reference : `${directory}/${reference}`).split('/')
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (normalized.length === 0) return null
      normalized.pop()
    } else {
      normalized.push(segment)
    }
  }
  return `/${normalized.join('/')}`
}

function relativeProjectReference(sourcePath: string, targetPath: string): string {
  const from = dirname(sourcePath).split('/').filter(Boolean)
  const to = targetPath.split('/').filter(Boolean)
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  return [...from.map(() => '..'), ...to].join('/')
}

/** Native Typst references retain their original target when that target moves. */
function rewriteNativeTypstPathRefs(content: string, sourcePath: string, outputPath: string, targets: Map<string, string>): string {
  return content.replace(
    /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|(#?\b(?:include|import)\s+|#?\b(?:image|bibliography)\(\s*\(?\s*)("(?:\\.|[^"\\])*"(?:\s*,\s*"(?:\\.|[^"\\])*")*)/g,
    (match, prefix: string | undefined, paths: string | undefined) => {
      if (!prefix || !paths) return match
      return prefix + paths.replace(/"(?:\\.|[^"\\])*"/g, (literal) => {
        let reference: string
        try { reference = JSON.parse(literal) } catch { return literal }
        const original = resolveProjectReference(dirname(sourcePath), reference)
        const target = original && targets.get(original)
        if (!target || target === original) return literal
        const replacement = reference.startsWith('/') ? target : relativeProjectReference(outputPath, target)
        return JSON.stringify(replacement)
      })
    },
  )
}

interface DecodedZipText {
  content: string
  encoding: 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be'
}

/**
 * Decode zip text strictly: non-fatal UTF-8 decoding would silently corrupt
 * legacy-encoded files with U+FFFD. Fall back to Windows-1252, then binary.
 */
function decodeZipText(data: Uint8Array): DecodedZipText | null {
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
    const encoding = data[0] === 0xff ? 'utf-16le' : 'utf-16be'
    try {
      return { content: new TextDecoder(encoding, { fatal: true }).decode(data), encoding }
    } catch {
      return null
    }
  }
  try {
    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(data),
      encoding: 'utf-8',
    }
  } catch {
    // Not valid UTF-8; try the most common legacy encoding.
  }
  try {
    return {
      content: new TextDecoder('windows-1252', { fatal: true }).decode(data),
      encoding: 'windows-1252',
    }
  } catch {
    return null
  }
}

async function buildProjectFilesFromZipEntries(
  entries: ZipImportEntry[],
  options: { convertLatex: boolean; existingPaths?: string[] },
): Promise<BuiltProjectFiles> {
  const projectFiles: ProjectFile[] = []
  const warnings: ConversionWarning[] = []
  let texFilesConverted = 0
  let metadata: ConversionResult['metadata'] = { packages: [] }
  const decodedEntries = entries.filter((entry) => !options.convertLatex || basename(entry.path) !== '.folder').map((entry) => ({
    ...entry,
    decoded: (entry.text ?? isKnownTextPath(entry.path)) ? decodeZipText(entry.data) : null,
  }))
  const texEntries = decodedEntries.filter((entry) => options.convertLatex && entry.decoded && isLatexPath(entry.path))
  const documentEntries = texEntries.filter((entry) => /\\(?:documentclass\b|begin\s*\{document\})/.test(
    entry.decoded!.content.replace(/(?<!\\)%[^\r\n]*/g, ''),
  ))
  const mainSource = resolveImportedMainFile((documentEntries.length ? documentEntries : texEntries).map((entry) => ({
    path: toProjectPath(entry.path).replace(/\.tex$/i, '.typ'), content: '', isBinary: false, lastModified: 0,
  })))
  const mainEntry = texEntries.find((entry) => toProjectPath(entry.path).replace(/\.tex$/i, '.typ') === mainSource)
  const mainDirectory = mainEntry ? dirname(toProjectPath(mainEntry.path)) : ''
  const usedPaths = new Set(options.existingPaths ?? [])
  const reserved = new Set(decodedEntries.flatMap((entry) => [
    toProjectPath(entry.path),
    ...(texEntries.includes(entry) ? [toProjectPath(entry.path).replace(/\.tex$/i, '.typ')] : []),
  ]))
  const convertedTargets = new Map<string, string>()
  const nativeTargets = new Map<string, string>()
  const bibliographyAliases = new Map<string, string>()
  const convertedOutput = new Map<typeof decodedEntries[number], string>()
  const originalOutput = new Map<typeof decodedEntries[number], string>()

  // Plan every output before converting so references can target renamed files.
  for (const entry of texEntries) {
    const sourcePath = toProjectPath(entry.path)
    const desired = sourcePath.replace(/\.tex$/i, '.typ')
    const output = dedupeProjectPath(desired, usedPaths, reserved)
    convertedOutput.set(entry, output)
    if (!convertedTargets.has(sourcePath)) convertedTargets.set(sourcePath, output)
    if (output !== desired) warnings.push({ message: `Renamed colliding import path ${desired} → ${output}`, construct: entry.path })
  }
  for (const entry of decodedEntries) {
    const sourcePath = toProjectPath(entry.path)
    const output = dedupeProjectPath(sourcePath, usedPaths, reserved)
    originalOutput.set(entry, output)
    if (!nativeTargets.has(sourcePath)) nativeTargets.set(sourcePath, output)
    if (output !== sourcePath) warnings.push({ message: `Renamed colliding import path ${sourcePath} → ${output}`, construct: entry.path })
  }
  for (const path of options.existingPaths ?? []) {
    if (!nativeTargets.has(path)) nativeTargets.set(path, path)
  }

  const reachableSources = new Set<typeof decodedEntries[number]>()
  const visitSource = (entry: typeof decodedEntries[number]): void => {
    if (reachableSources.has(entry)) return
    reachableSources.add(entry)
    const source = entry.decoded!.content.replace(/(?<!\\)%[^\r\n]*/g, '')
    for (const match of source.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) {
      const reference = match[1].trim()
      const filename = /\.[^/]+$/.test(reference) ? reference : `${reference}.tex`
      const target = [mainDirectory, dirname(toProjectPath(entry.path))]
        .map((directory) => resolveProjectReference(directory, filename))
        .map((path) => texEntries.find((candidate) => toProjectPath(candidate.path) === path))
        .find((candidate) => candidate !== undefined)
      if (target) visitSource(target)
    }
  }
  if (mainEntry) visitSource(mainEntry)
  const hasManualBibliography = [...reachableSources].some((entry) => /\\begin\s*\{thebibliography\}/.test(
    entry.decoded!.content.replace(/(?<!\\)%[^\r\n]*/g, ''),
  ))
  // Merge the chosen document's metadata last so auxiliary documents do not rename it.
  const orderedEntries = [...decodedEntries.filter((entry) => entry !== mainEntry), ...(mainEntry ? [mainEntry] : [])]
  for (const entry of orderedEntries) {
    const sourcePath = toProjectPath(entry.path)
    const originalPath = originalOutput.get(entry)!
    if (entry.decoded?.encoding === 'windows-1252') {
      warnings.push({ message: `${sourcePath} is not valid UTF-8; decoded it as Windows-1252.`, construct: entry.path })
    }
    const outputPath = convertedOutput.get(entry)
    if (outputPath && entry.decoded) {
      const resolvePath: NonNullable<ConversionOptions['resolvePath']> = (reference, kind) => {
        const variants = kind === 'include'
          ? /\.[^/]+$/.test(reference) ? [reference] : [`${reference}.tex`, reference]
          : kind === 'bibliography' && !/\.[^/]+$/.test(reference)
            ? [`${reference}.bib`, reference]
          : kind === 'image' && !/\.[^/]+$/.test(reference)
            ? [reference, ...['.png', '.jpg', '.jpeg', '.svg', '.pdf', '.webp'].map((extension) => `${reference}${extension}`)]
            : [reference]
        // TeX resolves paths from the compilation directory, even in nested inputs.
        for (const directory of [mainDirectory, dirname(sourcePath)]) {
          for (const variant of variants) {
            const original = resolveProjectReference(directory, variant)
            if (!original) continue
            let target = kind === 'include'
              ? convertedTargets.get(original) ?? nativeTargets.get(original)
              : nativeTargets.get(original)
            if (target && kind === 'bibliography' && /\.(bibtex|bib)$/i.test(target) && !target.endsWith('.bib')) {
              const bibliography = decodedEntries.find((candidate) => originalOutput.get(candidate) === target)
              if (bibliography?.decoded) {
                let alias = bibliographyAliases.get(target)
                if (!alias) {
                  alias = dedupeProjectPath(target.replace(/\.(bibtex|bib)$/i, '.bib'), usedPaths, reserved)
                  bibliographyAliases.set(target, alias)
                  projectFiles.push({ path: alias, content: bibliography.decoded.content, isBinary: false, lastModified: Date.now() })
                }
                target = alias
              }
            }
            if (target) return reference.startsWith('/') ? target : relativeProjectReference(outputPath, target)
          }
        }
        warnings.push({ message: `Could not find ${kind} file "${reference}" referenced by ${sourcePath}.`, construct: entry.path })
        return reference
      }
      const converted = await convertLatexSource(entry.decoded.content, entry.path, {
        resolvePath,
        ...(reachableSources.has(entry) ? { hasManualBibliography } : {}),
      })
      projectFiles.push({ path: outputPath, content: converted.content, isBinary: false, lastModified: Date.now() })
      warnings.push(...converted.warnings)
      metadata = mergeConversionMetadata(metadata, converted.metadata)
      texFilesConverted++
    }
    if (entry.decoded) {
      projectFiles.push({
        path: originalPath,
        content: /\.typ$/i.test(entry.path)
          ? rewriteNativeTypstPathRefs(entry.decoded.content, sourcePath, originalPath, nativeTargets)
          : entry.decoded.content,
        isBinary: false,
        lastModified: Date.now(),
      })
    } else {
      if (entry.text ?? isKnownTextPath(entry.path)) {
        warnings.push({ message: `${sourcePath} could not be decoded as text; preserved its original bytes as binary.`, construct: entry.path })
      }
      projectFiles.push({ path: originalPath, content: '', isBinary: true, binaryData: entry.data, lastModified: Date.now() })
    }
  }

  return {
    projectFiles, texFilesConverted, warnings, metadata,
    mainFile: mainEntry ? convertedTargets.get(toProjectPath(mainEntry.path)) ?? null : null,
  }
}

async function createImportedProject(
  projectName: string,
  projectFiles: ProjectFile[],
  options?: { select?: boolean },
  manifestMainFile?: string | null,
): Promise<CreateProjectResult> {
  const validManifestMainFile = manifestMainFile === '' ? '' : manifestMainFile
    && projectFiles.some((file) => file.path === manifestMainFile && !file.isBinary)
    ? manifestMainFile
    : null
  const scaffold: ProjectScaffold = {
    files: projectFiles.map((file) => ({
      path: file.path,
      content: file.content,
      isBinary: file.isBinary,
      binaryData: file.binaryData,
    })),
    mainFile: validManifestMainFile ?? resolveImportedMainFile(projectFiles),
  }

  if (options) {
    return useProjectStore.getState().createProject(projectName, scaffold, options)
  }
  return useProjectStore.getState().createProject(projectName, scaffold)
}

function assertImportedProjectPersisted(result: CreateProjectResult): void {
  if (result.persisted) return
  const reason = isQuotaExceededError(result.persistError) ? ' Browser storage is full.' : ''
  throw new Error(`The imported project could not be saved.${reason} Export a backup before closing this tab.`)
}

/**
 * The project store can lag the live CodeMirror buffer by the editor sync
 * debounce; apply the buffer before exporting so zips include the latest typing.
 */
function flushLiveEditorContent(): void {
  const projectState = useProjectStore.getState()
  const { currentFilePath } = projectState
  if (!currentFilePath) return
  const editor = useEditorStore.getState()
  if (!editor.isDirty) return
  // updateFileContent no-ops when the buffer already matches the stored content.
  projectState.updateFileContent(currentFilePath, editor.source)
}

/**
 * fflate uses `instanceof Uint8Array`. In jsdom (and some worker bridges)
 * bytes can come from another realm and fail that check, which makes zipSync
 * treat file contents as nested directories. Always copy into the local realm.
 */
function toZipBytes(data: Uint8Array): Uint8Array {
  return data.constructor === Uint8Array ? data : new Uint8Array(data)
}

function encodeTextForZip(content: string): Uint8Array {
  return toZipBytes(strToU8(content))
}

function sanitizeExportFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '_') || 'project'
}

/**
 * Unique folder names for multi-project export.
 * Reserves every final folder string (not just sanitized bases) so a generated
 * `A-2` cannot collide with a project whose sanitized name is literally `A-2`.
 */
export function uniqueExportFolderNames(projectNames: string[]): string[] {
  const used = new Set<string>()
  return projectNames.map((name) => {
    const base = sanitizeExportFolderName(name)
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix++
    }
    used.add(candidate)
    return candidate
  })
}

export async function exportProject(): Promise<void> {
  flushLiveEditorContent()
  const project = useProjectStore.getState().getCurrentProject()
  if (!project) return

  const files: Record<string, Uint8Array> = Object.create(null)
  let skippedMissingBinary = 0

  for (const file of project.files) {
    const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path
    if (basename(zipPath) === '.folder') continue

    if (file.isBinary) {
      if (!file.binaryData) {
        skippedMissingBinary++
        continue
      }
      // Preserve empty binaries as zero-byte zip entries for round-trip fidelity.
      files[zipPath] = toZipBytes(file.binaryData)
    } else {
      files[zipPath] = encodeTextForZip(file.content)
    }
  }
  addProjectManifest(files, project.mainFile, project.name, project.files)

  let zipped: Uint8Array
  try {
    zipped = zipSync(files)
  } catch (err) {
    console.error('Failed to export project:', err)
    window.alert('Failed to export project. Please try again.')
    return
  }
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
  downloadBlob(blob, `${project.name}.zip`)
  if (skippedMissingBinary > 0) {
    window.alert(
      `Export completed, but ${skippedMissingBinary} binary file(s) were skipped because their data was missing.`,
    )
  }
}

export async function exportAllProjects(): Promise<void> {
  flushLiveEditorContent()
  const projects = useProjectStore.getState().projects
  if (projects.length === 0) return

  const files: Record<string, Uint8Array> = Object.create(null)
  const folderNames = uniqueExportFolderNames(projects.map((project) => project.name))
  let skippedMissingBinary = 0

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    const folderName = folderNames[i]
    for (const file of project.files) {
      const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path
      if (basename(filePath) === '.folder') continue
      const zipPath = `${folderName}/${filePath}`
      if (file.isBinary) {
        if (!file.binaryData) {
          skippedMissingBinary++
          continue
        }
        files[zipPath] = toZipBytes(file.binaryData)
      } else {
        files[zipPath] = encodeTextForZip(file.content)
      }
    }
    addProjectManifest(files, project.mainFile, project.name, project.files, folderName)
  }

  let zipped: Uint8Array
  try {
    zipped = zipSync(files)
  } catch (err) {
    console.error('Failed to export all projects:', err)
    window.alert('Failed to export projects. Please try again.')
    return
  }
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
  downloadBlob(blob, 'typsmthng-all-projects.zip')
  if (skippedMissingBinary > 0) {
    window.alert(
      `Export completed, but ${skippedMissingBinary} binary file(s) were skipped because their data was missing.`,
    )
  }
}

export async function importAllProjects(file: File): Promise<number> {
  const buffer = await file.arrayBuffer()
  let unzipped: ReturnType<typeof unzipSync>
  try {
    unzipped = unzipSync(new Uint8Array(buffer))
  } catch {
    throw new Error('The file does not appear to be a valid zip archive.')
  }

  const projectFolders = new Map<string, ZipImportEntry[]>()
  let skippedRootEntries = 0

  for (const entry of collectZipEntries(unzipped)) {
    const slashIndex = entry.path.indexOf('/')
    if (slashIndex < 0) {
      // Bulk archives are one folder per project; loose root files have no home.
      skippedRootEntries++
      continue
    }
    const folderName = entry.path.slice(0, slashIndex)
    const filePath = entry.path.slice(slashIndex + 1)
    if (!filePath) continue
    if (!projectFolders.has(folderName)) {
      projectFolders.set(folderName, [])
    }
    projectFolders.get(folderName)!.push({ path: filePath, data: entry.data })
  }

  if (projectFolders.size === 0) {
    throw new Error('No project folders found in the archive.')
  }

  let imported = 0
  let failed = 0
  let quotaFailure = false

  for (const [folderName, entries] of projectFolders) {
    const manifest = takeManifestMainFile(entries)
    const { projectFiles, mainFile } = await buildProjectFilesFromZipEntries(manifest.entries, { convertLatex: manifest.manifestMainFile === null })
    if (projectFiles.length === 0 && manifest.manifestMainFile === null) continue

    const result = await createImportedProject(
      manifest.projectName || folderName,
      projectFiles,
      { select: false },
      manifest.manifestMainFile ?? mainFile,
    )
    if (result.persisted) {
      imported++
    } else {
      failed++
      if (isQuotaExceededError(result.persistError)) {
        quotaFailure = true
      }
    }
  }

  // Stay on the home picker after bulk import; do not leave a prior selection.
  useProjectStore.setState({ hasSelectedProject: false, currentProjectId: null, currentFilePath: null })

  const quotaNote = quotaFailure ? ' — storage is full' : ''
  if (imported === 0 && failed > 0) {
    throw new Error(`No projects could be saved${quotaNote}. Free up space and try again.`)
  }

  const notes: string[] = []
  if (failed > 0) {
    notes.push(`${failed} project${failed === 1 ? '' : 's'} could not be saved${quotaNote}`)
  }
  if (skippedRootEntries > 0) {
    notes.push(`${skippedRootEntries} root-level file${skippedRootEntries === 1 ? ' was' : 's were'} skipped (bulk archives contain one folder per project)`)
  }
  if (notes.length > 0) {
    window.alert(`Imported ${imported} project${imported === 1 ? '' : 's'}, but ${notes.join('; ')}.`)
  }

  return imported
}

export async function importProject(file: File): Promise<ProjectImportResult | null> {
  const buffer = await file.arrayBuffer()
  let unzipped: ReturnType<typeof unzipSync>
  try {
    unzipped = unzipSync(new Uint8Array(buffer))
  } catch (err) {
    window.alert('Failed to import project: the file does not appear to be a valid zip archive.')
    console.error('Import failed:', err)
    return null
  }

  const fallbackProjectName = file.name.replace(/\.zip$/i, '')
  const { projectName: folderName, entries } = normalizeSingleProjectZipEntries(unzipped, fallbackProjectName)
  const manifest = takeManifestMainFile(entries)
  const built = await buildProjectFilesFromZipEntries(manifest.entries, { convertLatex: manifest.manifestMainFile === null })

  if (built.projectFiles.length === 0 && manifest.manifestMainFile === null) return null

  // Toolbar/generic zip import keeps the archive/folder name. Dedicated LaTeX
  // importers may prefer \\title metadata instead.
  const projectName = manifest.projectName || folderName
  const created = await createImportedProject(projectName, built.projectFiles, undefined, manifest.manifestMainFile ?? built.mainFile)
  assertImportedProjectPersisted(created)

  return {
    projectName,
    fileCount: built.projectFiles.length,
    texFilesConverted: built.texFilesConverted,
    warnings: built.warnings,
    metadata: built.metadata,
  }
}

/** Import a LaTeX project from .tex files, a .zip, or a folder of files.
 *  .tex files are converted to .typ; other files are passed through. */
/** Strip a shared top-level folder from folder-picked LaTeX imports (webkitRelativePath). */
function stripSharedRootFolder(relativePaths: string[]): string[] {
  const normalized = relativePaths.map((path) => normalizeZipPath(path))
  // Rejected paths become ''; detect/strip shared root on the remainder only.
  const valid = normalized.filter((path) => path.length > 0)
  if (valid.length === 0) return normalized

  const rootFolder = valid.reduce<string | null | undefined>((root, path) => {
    const slashIndex = path.indexOf('/')
    if (slashIndex < 0) return null
    const candidate = path.slice(0, slashIndex)
    if (root === undefined) return candidate
    return root === candidate ? root : null
  }, undefined)

  if (!rootFolder) return normalized

  const prefix = `${rootFolder}/`
  const strippedValid = valid.map((path) => (
    path.startsWith(prefix) ? path.slice(prefix.length) : path
  ))
  if (strippedValid.some((path) => !path) || !looksLikeImportableProject(strippedValid)) {
    return normalized
  }

  return normalized.map((path) => (
    path.startsWith(prefix) ? path.slice(prefix.length) : path
  ))
}

export async function importLatexProject(
  files: Array<{ relativePath: string; file: File }>,
): Promise<LatexImportResult> {
  const relativePaths = stripSharedRootFolder(files.map((entry) => entry.relativePath))
  const built = await prepareUploadedFiles(files.map((entry, index) => ({ ...entry, relativePath: relativePaths[index] })))
  if (built.projectFiles.length === 0) throw new Error('No files found to import')
  if (built.texFilesConverted === 0) throw new Error('No .tex files found to convert')

  const sourceFile = relativePaths.find((path) => isLatexPath(path))
  const projectName = built.metadata.title
    || (built.texFilesConverted === 1 && sourceFile
      ? basename(sourceFile).replace(/\.tex$/i, '')
      : `LaTeX Import (${built.texFilesConverted} files)`)
  const created = await createImportedProject(projectName, built.projectFiles, undefined, built.mainFile)
  assertImportedProjectPersisted(created)
  return {
    projectName,
    fileCount: built.projectFiles.length,
    texFilesConverted: built.texFilesConverted,
    warnings: built.warnings,
    metadata: built.metadata,
  }
}

/** Prepare a file upload without creating a project or replacing existing paths. */
export async function prepareUploadedFiles(
  files: Array<{ relativePath: string; file: File }>,
  existingPaths: string[] = [],
): Promise<BuiltProjectFiles> {
  const entries: ZipImportEntry[] = []
  for (const { relativePath, file } of files) {
    const path = normalizeZipPath(relativePath)
    if (!path || shouldSkipZipPath(path)) continue
    const text = shouldTreatUploadAsText(file)
    const data = typeof file.arrayBuffer === 'function'
      ? new Uint8Array(await file.arrayBuffer())
      : encodeTextForZip(await file.text())
    entries.push({ path, data, text })
  }
  return buildProjectFilesFromZipEntries(entries, { convertLatex: true, existingPaths })
}

/** Import a LaTeX project from a .zip file containing .tex files. */
export async function importLatexZip(file: File): Promise<LatexImportResult> {
  const buffer = await file.arrayBuffer()
  let unzipped: ReturnType<typeof unzipSync>
  try {
    unzipped = unzipSync(new Uint8Array(buffer))
  } catch {
    throw new Error('The file does not appear to be a valid zip archive.')
  }

  const fallbackProjectName = file.name.replace(/\.zip$/i, '')
  const { projectName: folderName, entries } = normalizeSingleProjectZipEntries(unzipped, fallbackProjectName)
  const built = await buildProjectFilesFromZipEntries(entries, { convertLatex: true })

  if (built.projectFiles.length === 0) {
    throw new Error('The zip archive contains no importable files.')
  }
  if (built.texFilesConverted === 0) {
    throw new Error('The zip archive contains no .tex files to convert.')
  }

  const projectName = built.metadata.title || folderName
  const created = await createImportedProject(projectName, built.projectFiles, undefined, built.mainFile)
  assertImportedProjectPersisted(created)

  return {
    projectName,
    fileCount: built.projectFiles.length,
    texFilesConverted: built.texFilesConverted,
    warnings: built.warnings,
    metadata: built.metadata,
  }
}

/** Convert a single uploaded .tex file for in-project ingest. Never throws. */
export async function convertUploadedLatexFile(
  source: string,
  sourceLabel: string,
): Promise<{ content: string; warnings: ConversionWarning[] }> {
  const converted = await convertLatexSource(source, sourceLabel)
  return { content: converted.content, warnings: converted.warnings }
}
