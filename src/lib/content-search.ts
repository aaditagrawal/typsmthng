import { isHiddenInternalPath } from '@/lib/file-index'

export const CONTENT_SEARCH_LIMIT = 80

export interface ContentSearchFile {
  path: string
  content: string
  isBinary: boolean
}

export interface ContentSearchHit {
  path: string
  line: number
  column: number
  preview: string
}

export function searchProjectContent(
  files: readonly ContentSearchFile[],
  query: string,
  options?: {
    limit?: number
    currentPath?: string | null
    currentSource?: string
  },
): ContentSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const limit = options?.limit ?? CONTENT_SEARCH_LIMIT
  const hits: ContentSearchHit[] = []

  for (const file of files) {
    if (file.isBinary || isHiddenInternalPath(file.path) || file.path.endsWith('/.folder')) continue
    const content = options?.currentPath === file.path && options.currentSource !== undefined
      ? options.currentSource
      : file.content
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const lower = line.toLowerCase()
      const matchAt = lower.indexOf(needle)
      if (matchAt < 0) continue
      hits.push({
        path: file.path,
        line: index + 1,
        column: Array.from(lower.slice(0, matchAt)).length + 1,
        preview: line.split(/\s+/).filter(Boolean).join(' '),
      })
      if (hits.length >= limit) return hits
    }
  }

  return hits
}
