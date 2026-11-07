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

// File objects are retained across search keystrokes. Keep only the latest
// source (including the live buffer); deleted files are collectable.
const searchText = new WeakMap<ContentSearchFile, { source: string; lower: string; complete: boolean }>()

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
  if (!needle || needle.includes('\n')) return []

  const limit = options?.limit ?? CONTENT_SEARCH_LIMIT
  const hits: ContentSearchHit[] = []

  for (const file of files) {
    if (file.isBinary || isHiddenInternalPath(file.path) || file.path.endsWith('/.folder')) continue
    const content = options?.currentPath === file.path && options.currentSource !== undefined
      ? options.currentSource
      : file.content
    let cached = searchText.get(file)
    if (!cached || cached.source !== content) {
      // Common queries reach the hit limit near the top. Index a whole-line
      // prefix first so those queries need not process a multi-MB document.
      const newline = content.indexOf('\n', 8192)
      const end = newline < 0 ? content.length : newline + 1
      cached = { source: content, lower: content.slice(0, end).toLowerCase(), complete: end === content.length }
      searchText.set(file, cached)
    }
    let lower = cached.lower
    let lowerStart = 0
    let sourceStart = 0
    let lineNumber = 1
    let matchAt = lower.indexOf(needle)
    while (true) {
      if (matchAt < 0) {
        if (cached.complete) break
        cached.lower = lower = content.toLowerCase()
        cached.complete = true
        matchAt = lower.indexOf(needle, lowerStart)
        if (matchAt < 0) break
      }
      let newline = lower.indexOf('\n', lowerStart)
      while (newline >= 0 && newline < matchAt) {
        lowerStart = newline + 1
        sourceStart = content.indexOf('\n', sourceStart) + 1
        lineNumber += 1
        newline = lower.indexOf('\n', lowerStart)
      }
      const sourceEnd = content.indexOf('\n', sourceStart)
      const line = content.slice(sourceStart, sourceEnd < 0 ? content.length : sourceEnd)
      hits.push({
        path: file.path,
        line: lineNumber,
        column: Array.from(lower.slice(lowerStart, matchAt)).length + 1,
        preview: line.split(/\s+/).filter(Boolean).join(' '),
      })
      if (hits.length >= limit) return hits
      // At most one hit per line, as before. Original/lower offsets are kept
      // separate because lowercasing can expand Unicode characters (e.g. İ).
      if (newline < 0) break
      lowerStart = newline + 1
      sourceStart = sourceEnd + 1
      lineNumber += 1
      matchAt = lower.indexOf(needle, lowerStart)
    }
  }

  return hits
}
