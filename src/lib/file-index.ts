import type { Project, ProjectFile } from '@/stores/project-store'

export interface SearchablePathEntry {
  path: string
  lowerPath: string
}

export interface ProjectFileIndex {
  treeFiles: ProjectFile[]
  searchablePaths: string[]
  searchablePathEntries: SearchablePathEntry[]
}

const EMPTY_INDEX: ProjectFileIndex = {
  treeFiles: [],
  searchablePaths: [],
  searchablePathEntries: [],
}

// Keyed on project object identity: every store mutation replaces the project
// object, so identity is a precise change signal (unlike millisecond updatedAt,
// which collides when two mutations land in the same ms), and WeakMap lets
// deleted projects — including their binaryData — be garbage collected.
const indexCache = new WeakMap<Project, ProjectFileIndex>()

export function isHiddenInternalPath(path: string): boolean {
  return path.startsWith('/.typsmthng/')
}

export function getProjectFileIndex(project?: Project | null): ProjectFileIndex {
  if (!project) return EMPTY_INDEX

  const cached = indexCache.get(project)
  if (cached) {
    return cached
  }

  const treeFiles = project.files.filter((file) => !isHiddenInternalPath(file.path))
  const searchablePathEntries = treeFiles
    .filter((file) => !file.path.endsWith('/.folder'))
    .map((file) => ({
      path: file.path,
      lowerPath: file.path.toLowerCase(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  const index: ProjectFileIndex = {
    treeFiles,
    searchablePathEntries,
    searchablePaths: searchablePathEntries.map((entry) => entry.path),
  }

  indexCache.set(project, index)
  return index
}
