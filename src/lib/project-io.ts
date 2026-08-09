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

function resolveImportedMainFile(projectFiles: ProjectFile[]): string {
  return projectFiles.find((f) => f.path === '/main.typ')?.path
    || projectFiles.find((f) => f.path.endsWith('/main.typ'))?.path
    || projectFiles.find((f) => f.path.endsWith('.typ'))?.path
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
      || normalizedPath.endsWith('.typ')
      || normalizedPath === '.typsmthng/template.json'
      // LaTeX: only root-level .tex files count. Nested ancillary .tex alone
      // must not unwrap an unrelated single top-level folder.
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

async function buildProjectFilesFromZipEntries(
  entries: ZipImportEntry[],
  options: { convertLatex: boolean },
): Promise<BuiltProjectFiles> {
  const projectFiles: ProjectFile[] = []
  const warnings: ConversionWarning[] = []
  let texFilesConverted = 0
  let metadata: ConversionResult['metadata'] = { packages: [] }

  for (const { path, data } of entries) {
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

      projectFiles.push({
        path: filePath,
        content,
        isBinary: false,
        lastModified: Date.now(),
      })
    } else {
      projectFiles.push({
        path: fullPath,
        content: '',
        isBinary: true,
        binaryData: data,
        lastModified: Date.now(),
      })
    }
  }

  return { projectFiles, texFilesConverted, warnings, metadata }
}

async function createImportedProject(projectName: string, projectFiles: ProjectFile[]): Promise<string> {
  const scaffold: ProjectScaffold = {
    files: projectFiles.map((file) => ({
      path: file.path,
      content: file.content,
      isBinary: file.isBinary,
      binaryData: file.binaryData,
    })),
    mainFile: resolveImportedMainFile(projectFiles),
  }

  return useProjectStore.getState().createProject(projectName, scaffold)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
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

  for (const file of project.files) {
    const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path
    if (zipPath.endsWith('.folder')) continue

    if (file.isBinary && file.binaryData) {
      files[zipPath] = toZipBytes(file.binaryData)
    } else {
      files[zipPath] = encodeTextForZip(file.content)
    }
  }

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
}

export async function exportAllProjects(): Promise<void> {
  const projects = useProjectStore.getState().projects
  if (projects.length === 0) return

  const files: Record<string, Uint8Array> = {}
  const folderNames = uniqueExportFolderNames(projects.map((project) => project.name))

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]
    const folderName = folderNames[i]
    for (const file of project.files) {
      const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path
      if (filePath.endsWith('.folder')) continue
      const zipPath = `${folderName}/${filePath}`
      if (file.isBinary && file.binaryData) {
        files[zipPath] = toZipBytes(file.binaryData)
      } else {
        files[zipPath] = encodeTextForZip(file.content)
      }
    }
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
    const { projectFiles } = await buildProjectFilesFromZipEntries(entries, { convertLatex: true })
    if (projectFiles.length === 0) continue

    const id = await createImportedProject(folderName, projectFiles)
    if (id) {
      imported++
    }
  }

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
  const built = await buildProjectFilesFromZipEntries(entries, { convertLatex: true })

  if (built.projectFiles.length === 0) return null

  // Toolbar/generic zip import keeps the archive/folder name. Dedicated LaTeX
  // importers may prefer \\title metadata instead.
  const projectName = folderName
  await createImportedProject(projectName, built.projectFiles)

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
export async function importLatexProject(
  files: Array<{ relativePath: string; file: File }>,
): Promise<LatexImportResult> {
  const allWarnings: ConversionWarning[] = []
  const projectFiles: ProjectFile[] = []
  let texCount = 0
  let lastMeta: ConversionResult['metadata'] = { packages: [] }

  for (const { relativePath, file } of files) {
    const path = toProjectPath(relativePath)

    if (isLatexPath(file.name)) {
      const source = await file.text()
      const typPath = path.replace(/\.tex$/i, '.typ')
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
      projectFiles.push({
        path,
        content,
        isBinary: false,
        lastModified: Date.now(),
      })
    } else {
      const fileBuffer = await file.arrayBuffer()
      projectFiles.push({
        path,
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
