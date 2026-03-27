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

function resolveImportedMainFile(projectFiles: ProjectFile[]): string {
  return projectFiles.find((f) => f.path === '/main.typ')?.path
    || projectFiles.find((f) => f.path.endsWith('.typ'))?.path
    || projectFiles[0]?.path
    || '/main.typ'
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

export async function exportProject(): Promise<void> {
  const project = useProjectStore.getState().getCurrentProject()
  if (!project) return

  // Build zip file data
  const files: Record<string, Uint8Array> = {}

  for (const file of project.files) {
    // Strip leading slash for zip paths
    const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path

    // Skip .folder placeholder files
    if (zipPath.endsWith('.folder')) continue

    if (file.isBinary && file.binaryData) {
      files[zipPath] = file.binaryData
    } else {
      files[zipPath] = strToU8(file.content)
    }
  }

  let zipped: Uint8Array
  try {
    zipped = zipSync(files)
  } catch (err) {
    console.error('Failed to export project:', err)
    return
  }
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${project.name}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportAllProjects(): Promise<void> {
  const projects = useProjectStore.getState().projects
  if (projects.length === 0) return

  const files: Record<string, Uint8Array> = {}

  for (const project of projects) {
    const folderName = project.name.replace(/[/\\:*?"<>|]/g, '_')
    for (const file of project.files) {
      const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path
      if (filePath.endsWith('.folder')) continue
      const zipPath = `${folderName}/${filePath}`
      if (file.isBinary && file.binaryData) {
        files[zipPath] = file.binaryData
      } else {
        files[zipPath] = strToU8(file.content)
      }
    }
  }

  let zipped: Uint8Array
  try {
    zipped = zipSync(files)
  } catch (err) {
    console.error('Failed to export all projects:', err)
    return
  }
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'typsmthng-all-projects.zip'
  a.click()
  URL.revokeObjectURL(url)
}

export async function importAllProjects(file: File): Promise<number> {
  const buffer = await file.arrayBuffer()
  let unzipped: ReturnType<typeof unzipSync>
  try {
    unzipped = unzipSync(new Uint8Array(buffer))
  } catch {
    throw new Error('The file does not appear to be a valid zip archive.')
  }

  // Group files by top-level folder (each folder = one project)
  const projectFolders = new Map<string, Array<{ path: string; data: Uint8Array }>>()

  for (const [path, data] of Object.entries(unzipped)) {
    if (path.endsWith('/') || path.includes('__MACOSX') || path.includes('.DS_Store')) continue
    const slashIndex = path.indexOf('/')
    if (slashIndex < 0) continue // skip files not in a folder
    const folderName = path.slice(0, slashIndex)
    const filePath = path.slice(slashIndex) // keeps leading slash
    if (!projectFolders.has(folderName)) {
      projectFolders.set(folderName, [])
    }
    projectFolders.get(folderName)!.push({ path: filePath, data })
  }

  if (projectFolders.size === 0) {
    throw new Error('No project folders found in the archive.')
  }

  const store = useProjectStore.getState()
  let imported = 0

  for (const [folderName, entries] of projectFolders) {
    const projectFiles: ProjectFile[] = []

    for (const { path, data } of entries) {
      if (path.endsWith('.folder')) continue
      const isText = isKnownTextPath(path)
      if (isText) {
        projectFiles.push({
          path,
          content: strFromU8(data),
          isBinary: false,
          lastModified: Date.now(),
        })
      } else {
        projectFiles.push({
          path,
          content: '',
          isBinary: true,
          binaryData: data,
          lastModified: Date.now(),
        })
      }
    }

    if (projectFiles.length === 0) continue

    const id = await store.createProject(folderName, {
      files: projectFiles.map((projectFile) => ({
        path: projectFile.path,
        content: projectFile.content,
        isBinary: projectFile.isBinary,
        binaryData: projectFile.binaryData,
      })),
      mainFile: resolveImportedMainFile(projectFiles),
    })
    if (id) {
      imported++
    }
  }

  // Go back to home after import
  useProjectStore.setState({ hasSelectedProject: false, currentProjectId: null, currentFilePath: null })

  return imported
}

export async function importProject(file: File): Promise<void> {
  const buffer = await file.arrayBuffer()
  let unzipped: ReturnType<typeof unzipSync>
  try {
    unzipped = unzipSync(new Uint8Array(buffer))
  } catch (err) {
    window.alert('Failed to import project: the file does not appear to be a valid zip archive.')
    console.error('Import failed:', err)
    return
  }

  // Determine project name from zip filename
  const projectName = file.name.replace(/\.zip$/i, '')

  const projectFiles: ProjectFile[] = []

  for (const [path, data] of Object.entries(unzipped)) {
    // Skip directories (they end with /) and macOS resource forks
    if (path.endsWith('/') || path.includes('__MACOSX') || path.includes('.DS_Store')) continue

    const fullPath = path.startsWith('/') ? path : `/${path}`

    // Detect if file is text or binary
    const isText = isKnownTextPath(path)

    if (isText) {
      let content = strFromU8(data)
      let filePath = fullPath

      if (isLatexPath(path)) {
        try {
          const result = await convertLatexToTypst(content)
          content = result.typst
          filePath = fullPath.replace(/\.tex$/i, '.typ')
        } catch (err) {
          console.warn(`LaTeX conversion failed for "${path}":`, err)
          filePath = fullPath.replace(/\.tex$/i, '.typ')
          content = `// LaTeX conversion failed for this file.\n// Original .tex content preserved below:\n\n/* ${content.replace(/\*\//g, '* /')} */\n`
        }
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

  if (projectFiles.length === 0) return

  await createImportedProject(projectName, projectFiles)
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
    const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`

    if (isLatexPath(file.name)) {
      const source = await file.text()
      const typPath = path.replace(/\.tex$/i, '.typ')
      try {
        const result = await convertLatexToTypst(source)
        projectFiles.push({
          path: typPath,
          content: result.typst,
          isBinary: false,
          lastModified: Date.now(),
        })
        allWarnings.push(...result.warnings)
        if (result.metadata.title || result.metadata.author) lastMeta = result.metadata
      } catch (err) {
        console.warn(`LaTeX conversion failed for "${file.name}":`, err)
        allWarnings.push({
          message: `Conversion failed for ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`,
          construct: file.name,
        })
        projectFiles.push({
          path: typPath,
          content: `// LaTeX conversion failed for this file.\n// Original .tex content preserved below:\n\n/* ${source.replace(/\*\//g, '* /')} */\n`,
          isBinary: false,
          lastModified: Date.now(),
        })
      }
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
      const buffer = await file.arrayBuffer()
      projectFiles.push({
        path,
        content: '',
        isBinary: true,
        binaryData: new Uint8Array(buffer),
        lastModified: Date.now(),
      })
    }
  }

  if (projectFiles.length === 0) {
    throw new Error('No files found to import')
  }

  // Determine project name: metadata title > first .tex filename > generic
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

  const allWarnings: ConversionWarning[] = []
  const projectFiles: ProjectFile[] = []
  let texCount = 0
  let lastMeta: ConversionResult['metadata'] = { packages: [] }

  for (const [path, data] of Object.entries(unzipped)) {
    if (path.endsWith('/') || path.includes('__MACOSX') || path.includes('.DS_Store')) continue

    const fullPath = path.startsWith('/') ? path : `/${path}`
    const isText = isKnownTextPath(path)

    if (isText) {
      let content = strFromU8(data)
      let filePath = fullPath

      if (isLatexPath(path)) {
        try {
          const result = await convertLatexToTypst(content)
          content = result.typst
          filePath = fullPath.replace(/\.tex$/i, '.typ')
          allWarnings.push(...result.warnings)
          if (result.metadata.title || result.metadata.author) lastMeta = result.metadata
          texCount++
        } catch (err) {
          console.warn(`LaTeX conversion failed for "${path}":`, err)
          allWarnings.push({
            message: `Conversion failed for ${path}: ${err instanceof Error ? err.message : 'unknown error'}`,
            construct: path,
          })
          filePath = fullPath.replace(/\.tex$/i, '.typ')
          content = `// LaTeX conversion failed for this file.\n// Original .tex content preserved below:\n\n/* ${content.replace(/\*\//g, '* /')} */\n`
          texCount++
        }
      }

      projectFiles.push({ path: filePath, content, isBinary: false, lastModified: Date.now() })
    } else {
      projectFiles.push({ path: fullPath, content: '', isBinary: true, binaryData: data, lastModified: Date.now() })
    }
  }

  if (projectFiles.length === 0) {
    throw new Error('The zip archive contains no importable files.')
  }

  const projectName = lastMeta.title
    || file.name.replace(/\.zip$/i, '')

  await createImportedProject(projectName, projectFiles)

  return {
    projectName,
    fileCount: projectFiles.length,
    texFilesConverted: texCount,
    warnings: allWarnings,
    metadata: lastMeta,
  }
}
