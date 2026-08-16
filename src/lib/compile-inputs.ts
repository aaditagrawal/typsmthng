import type { Project } from '@/stores/project-store'

export interface CompileTextFile {
  path: string
  content: string
}

export interface CompileBinaryFile {
  path: string
  data: Uint8Array
}

export interface CompileInputs {
  mainPath: string
  mainSource: string
  textFiles: CompileTextFile[]
  extraFiles: CompileTextFile[]
  extraBinaryFiles: CompileBinaryFile[]
}

interface BuildCompileInputsOptions {
  project?: Project
  currentFilePath?: string | null
  liveSource: string
  defaultMainPath?: string
  transformText?: (path: string, content: string) => string
}

export function buildCompileInputs({
  project,
  currentFilePath,
  liveSource,
  defaultMainPath = '/main.typ',
  transformText,
}: BuildCompileInputsOptions): CompileInputs {
  const transform = transformText ?? ((_path: string, content: string) => content)

  if (!project) {
    const mainSource = transform(defaultMainPath, liveSource)
    return {
      mainPath: defaultMainPath,
      mainSource,
      textFiles: [{ path: defaultMainPath, content: mainSource }],
      extraFiles: [],
      extraBinaryFiles: [],
    }
  }

  // deleteFolder can leave mainFile as '' — treat empty as unset.
  const mainPath = project.mainFile || defaultMainPath
  const textFiles: CompileTextFile[] = []
  const extraFiles: CompileTextFile[] = []
  const extraBinaryFiles: CompileBinaryFile[] = []

  let mainSource: string | null = null

  for (const file of project.files) {
    if (!file.isBinary) {
      const content = currentFilePath && file.path === currentFilePath
        ? liveSource
        : file.content
      const normalized = transform(file.path, content)
      const entry: CompileTextFile = { path: file.path, content: normalized }
      textFiles.push(entry)

      if (file.path === mainPath) {
        mainSource = normalized
      } else {
        extraFiles.push(entry)
      }
      continue
    }

    if (file.path !== mainPath && file.binaryData) {
      extraBinaryFiles.push({ path: file.path, data: file.binaryData })
    }
  }

  if (mainSource === null) {
    // Missing main: only use the live buffer when it is actually the main file.
    // Never compile an arbitrary open buffer as main after a broken rename/import.
    if (currentFilePath === mainPath) {
      mainSource = transform(mainPath, liveSource)
    } else {
      mainSource = transform(mainPath, '')
    }
    if (!textFiles.some((file) => file.path === mainPath)) {
      textFiles.push({ path: mainPath, content: mainSource })
    }
  }

  return {
    mainPath,
    mainSource,
    textFiles,
    extraFiles,
    extraBinaryFiles,
  }
}
