import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { useProjectStore, type ProjectFile, type ProjectScaffold } from '@/stores/project-store'
import { isKnownTextPath, isLatexPath, shouldTreatUploadAsText } from '@/lib/file-classification'
import { convertLatexToTypst, type ConversionResult, type ConversionWarning } from '@/lib/latex-converter'

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
}

interface BuiltProjectFiles {
  projectFiles: ProjectFile[]
  texFilesConverted: number
  warnings: ConversionWarning[]
  metadata: ConversionResult['metadata']
}

const PREFERRED_MAIN_NAME = /\/(main|paper|thesis|article|report)\.typ$/i
const PROJECT_MANIFEST_PATH = '.typsmthng/project.json'
const PROJECT_MANIFEST_VERSION = 1

function projectManifestBytes(mainFile: string): Uint8Array {
  return encodeTextForZip(JSON.stringify({ version: PROJECT_MANIFEST_VERSION, mainFile }, null, 2))
}

function takeManifestMainFile(entries: ZipImportEntry[]): {
  entries: ZipImportEntry[]
  manifestMainFile: string | null
} {
  const manifest = entries.find((entry) => entry.path === PROJECT_MANIFEST_PATH)
  const sourceEntries = entries.filter((entry) => entry.path !== PROJECT_MANIFEST_PATH)
  if (!manifest) return { entries: sourceEntries, manifestMainFile: null }

  try {
    const value: unknown = JSON.parse(strFromU8(manifest.data))
    if (!value || typeof value !== 'object') return { entries: sourceEntries, manifestMainFile: null }
    const { version, mainFile } = value as { version?: unknown; mainFile?: unknown }
    if (version !== PROJECT_MANIFEST_VERSION || typeof mainFile !== 'string' || !mainFile.startsWith('/')) {
      return { entries: sourceEntries, manifestMainFile: null }
    }
    const normalized = normalizeZipPath(mainFile)
    if (!normalized || `/${normalized}` !== mainFile) return { entries: sourceEntries, manifestMainFile: null }
    return { entries: sourceEntries, manifestMainFile: mainFile }
  } catch {
    return { entries: sourceEntries, manifestMainFile: null }
  }
}

function resolveImportedMainFile(projectFiles: ProjectFile[]): string {
  const typFiles = projectFiles.filter((f) => f.path.endsWith('.typ'))
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
  return path.endsWith('/') || path.includes('__MACOSX') || path.includes('.DS_Store')
}

function normalizeZipPath(path: string): string {
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
  return `// LaTeX conversion failed for this file.\n// Original .tex content preserved below:\n\n/* ${source.replace(/\*\//g, '* /')} */\n`
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
      || (isRootFile && normalizedPath.endsWith('.tex'))
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
): Promise<{ content: string; warnings: ConversionWarning[]; metadata: ConversionResult['metadata'] | null }> {
  try {
    const result = await convertLatexToTypst(source)
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

function dedupeProjectPath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path)
    return path
  }

  const lastDot = path.lastIndexOf('.')
  const lastSlash = path.lastIndexOf('/')
  const hasExt = lastDot > lastSlash
  const stem = hasExt ? path.slice(0, lastDot) : path
  const ext = hasExt ? path.slice(lastDot) : ''

  let suffix = 2
  let candidate = `${stem}-${suffix}${ext}`
  while (used.has(candidate)) {
    suffix++
    candidate = `${stem}-${suffix}${ext}`
  }
  used.add(candidate)
  return candidate
}

/** Rewrite Typst path literals after import path collisions rename files. */
function rewriteTypstPathRefs(content: string, renames: Map<string, string>): string {
  if (renames.size === 0) return content

  const resolveRename = (rawPath: string): string | null => {
    const absolute = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    const renamed = renames.get(absolute) ?? renames.get(rawPath)
    if (!renamed) return null
    return rawPath.startsWith('/') ? renamed : renamed.replace(/^\//, '')
  }

  let next = content.replace(
    /#include\s+"([^"]+)"/g,
    (match, path: string) => {
      const renamed = resolveRename(path)
      return renamed ? `#include "${renamed}"` : match
    },
  )
  next = next.replace(
    /#image\("([^"]+)"/g,
    (match, path: string) => {
      const renamed = resolveRename(path)
      return renamed ? `#image("${renamed}"` : match
    },
  )
  next = next.replace(
    /#bibliography\("([^"]+)"\)/g,
    (match, path: string) => {
      const renamed = resolveRename(path)
      return renamed ? `#bibliography("${renamed}")` : match
    },
  )
  return next
}

function applyPathRenames(projectFiles: ProjectFile[], renames: Map<string, string>): void {
  if (renames.size === 0) return
  for (const file of projectFiles) {
    if (file.isBinary) continue
    file.content = rewriteTypstPathRefs(file.content, renames)
  }
}

async function buildProjectFilesFromZipEntries(
  entries: ZipImportEntry[],
  options: { convertLatex: boolean },
): Promise<BuiltProjectFiles> {
  const projectFiles: ProjectFile[] = []
  const warnings: ConversionWarning[] = []
  const usedPaths = new Set<string>()
  const renames = new Map<string, string>()
  let texFilesConverted = 0
  let metadata: ConversionResult['metadata'] = { packages: [] }

  // Prefer converted .tex → .typ for the canonical path when both exist.
  const orderedEntries = [...entries].sort((a, b) => {
    const aTex = options.convertLatex && isLatexPath(a.path) ? 0 : 1
    const bTex = options.convertLatex && isLatexPath(b.path) ? 0 : 1
    return aTex - bTex
  })

  for (const { path, data } of orderedEntries) {
    if (path.endsWith('.folder')) continue

    const fullPath = toProjectPath(path)
    const isText = isKnownTextPath(path)

    if (isText) {
      let content = strFromU8(data)
      let filePath = fullPath

      if (options.convertLatex && isLatexPath(path)) {
        const converted = await convertLatexSource(content, path)
        content = converted.content
        filePath = fullPath.replace(/\.tex$/i, '.typ')
        warnings.push(...converted.warnings)
        metadata = mergeConversionMetadata(metadata, converted.metadata)
        texFilesConverted++
      }

      const uniquePath = dedupeProjectPath(filePath, usedPaths)
      if (uniquePath !== filePath) {
        warnings.push({
          message: `Renamed colliding import path ${filePath} → ${uniquePath}`,
          construct: path,
        })
        // If a native .typ lost to a converted .tex already at filePath, keep
        // refs on filePath (the winner). Otherwise retarget refs to uniquePath.
        const displacedByConvertedTex = options.convertLatex
          && !isLatexPath(path)
          && filePath.endsWith('.typ')
          && projectFiles.some((f) => f.path === filePath)
        if (!displacedByConvertedTex) {
          renames.set(filePath, uniquePath)
        }
      }

      projectFiles.push({
        path: uniquePath,
        content,
        isBinary: false,
        lastModified: Date.now(),
      })
    } else {
      const uniquePath = dedupeProjectPath(fullPath, usedPaths)
      if (uniquePath !== fullPath) {
        renames.set(fullPath, uniquePath)
        warnings.push({
          message: `Renamed colliding import path ${fullPath} → ${uniquePath}`,
          construct: path,
        })
      }
      projectFiles.push({
        path: uniquePath,
        content: '',
        isBinary: true,
        binaryData: data,
        lastModified: Date.now(),
      })
    }
  }

  applyPathRenames(projectFiles, renames)

  return { projectFiles, texFilesConverted, warnings, metadata }
}

async function createImportedProject(
  projectName: string,
  projectFiles: ProjectFile[],
  options?: { select?: boolean },
  manifestMainFile?: string | null,
): Promise<string> {
  const validManifestMainFile = manifestMainFile
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
    mainFile: validManifestMainFile || resolveImportedMainFile(projectFiles),
  }

  if (options) {
    return useProjectStore.getState().createProject(projectName, scaffold, options)
  }
  return useProjectStore.getState().createProject(projectName, scaffold)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Delay revoke so browsers that download asynchronously still have the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
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
  const project = useProjectStore.getState().getCurrentProject()
  if (!project) return

  const files: Record<string, Uint8Array> = {}
  let skippedMissingBinary = 0

  for (const file of project.files) {
    const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path
    if (zipPath.endsWith('.folder')) continue

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
  files[PROJECT_MANIFEST_PATH] = projectManifestBytes(project.mainFile)

  let zipped: Uint8Array
  try {
    zipped = zipSync(files)
  } catch (err) {
    console.error('Failed to export project:', err)
    window.alert('Failed to export project. Please try again.')
    return
  }
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
  triggerDownload(blob, `${project.name}.zip`)
  if (skippedMissingBinary > 0) {
    window.alert(
      `Export completed, but ${skippedMissingBinary} binary file(s) were skipped because their data was missing.`,
    )
  }
}

export async function exportAllProjects(): Promise<void> {
  const projects = useProjectStore.getState().projects
  if (projects.length === 0) return

  const files: Record<string, Uint8Array> = {}
  const folderNames = uniqueExportFolderNames(projects.map((project) => project.name))
  let skippedMissingBinary = 0

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    const folderName = folderNames[i]
    for (const file of project.files) {
      const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path
      if (filePath.endsWith('.folder')) continue
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
    files[`${folderName}/${PROJECT_MANIFEST_PATH}`] = projectManifestBytes(project.mainFile)
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
  triggerDownload(blob, 'typsmthng-all-projects.zip')
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

  for (const entry of collectZipEntries(unzipped)) {
    const slashIndex = entry.path.indexOf('/')
    if (slashIndex < 0) continue
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

  for (const [folderName, entries] of projectFolders) {
    const manifest = takeManifestMainFile(entries)
    const { projectFiles } = await buildProjectFilesFromZipEntries(manifest.entries, { convertLatex: true })
    if (projectFiles.length === 0) continue

    const id = await createImportedProject(
      folderName,
      projectFiles,
      { select: false },
      manifest.manifestMainFile,
    )
    if (id) {
      imported++
    }
  }

  // Stay on the home picker after bulk import; do not leave a prior selection.
  useProjectStore.setState({ hasSelectedProject: false, currentProjectId: null, currentFilePath: null })

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
  const built = await buildProjectFilesFromZipEntries(manifest.entries, { convertLatex: true })

  if (built.projectFiles.length === 0) return null

  // Toolbar/generic zip import keeps the archive/folder name. Dedicated LaTeX
  // importers may prefer \\title metadata instead.
  const projectName = folderName
  await createImportedProject(projectName, built.projectFiles, undefined, manifest.manifestMainFile)

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
  const allWarnings: ConversionWarning[] = []
  const projectFiles: ProjectFile[] = []
  const usedPaths = new Set<string>()
  const renames = new Map<string, string>()
  let texCount = 0
  let lastMeta: ConversionResult['metadata'] = { packages: [] }

  const relativePaths = stripSharedRootFolder(files.map((entry) => entry.relativePath))
  const indexed = files.map((entry, index) => ({
    entry,
    relativePath: relativePaths[index],
    index,
  }))
  // Prefer converted .tex for canonical .typ paths when both exist.
  indexed.sort((a, b) => {
    const aTex = a.relativePath && isLatexPath(a.entry.file.name) ? 0 : 1
    const bTex = b.relativePath && isLatexPath(b.entry.file.name) ? 0 : 1
    return aTex - bTex
  })

  for (const { entry, relativePath } of indexed) {
    const { file } = entry
    if (!relativePath) continue
    const path = toProjectPath(relativePath)

    if (isLatexPath(file.name)) {
      const source = await file.text()
      const desiredPath = path.replace(/\.tex$/i, '.typ')
      const typPath = dedupeProjectPath(desiredPath, usedPaths)
      if (typPath !== desiredPath) {
        renames.set(desiredPath, typPath)
        allWarnings.push({
          message: `Renamed colliding import path ${desiredPath} → ${typPath}`,
          construct: file.name,
        })
      }
      const converted = await convertLatexSource(source, file.name)
      projectFiles.push({
        path: typPath,
        content: converted.content,
        isBinary: false,
        lastModified: Date.now(),
      })
      allWarnings.push(...converted.warnings)
      lastMeta = mergeConversionMetadata(lastMeta, converted.metadata)
      texCount++
    } else if (shouldTreatUploadAsText(file)) {
      const content = await file.text()
      const uniquePath = dedupeProjectPath(path, usedPaths)
      if (uniquePath !== path) {
        allWarnings.push({
          message: `Renamed colliding import path ${path} → ${uniquePath}`,
          construct: file.name,
        })
        const displacedByConvertedTex = path.endsWith('.typ')
          && projectFiles.some((f) => f.path === path)
        if (!displacedByConvertedTex) {
          renames.set(path, uniquePath)
        }
      }
      projectFiles.push({
        path: uniquePath,
        content,
        isBinary: false,
        lastModified: Date.now(),
      })
    } else {
      const fileBuffer = await file.arrayBuffer()
      const uniquePath = dedupeProjectPath(path, usedPaths)
      if (uniquePath !== path) {
        renames.set(path, uniquePath)
        allWarnings.push({
          message: `Renamed colliding import path ${path} → ${uniquePath}`,
          construct: file.name,
        })
      }
      projectFiles.push({
        path: uniquePath,
        content: '',
        isBinary: true,
        binaryData: new Uint8Array(fileBuffer),
        lastModified: Date.now(),
      })
    }
  }

  if (projectFiles.length === 0) {
    throw new Error('No files found to import')
  }

  applyPathRenames(projectFiles, renames)

  const projectName = lastMeta.title
    || (texCount === 1
      ? files.find((f) => isLatexPath(f.file.name))!.file.name.replace(/\.tex$/i, '')
      : `LaTeX Import (${texCount} files)`)

  await createImportedProject(projectName, projectFiles)

  return {
    projectName,
    fileCount: projectFiles.length,
    texFilesConverted: texCount,
    warnings: allWarnings,
    metadata: lastMeta,
  }
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
  await createImportedProject(projectName, built.projectFiles)

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
