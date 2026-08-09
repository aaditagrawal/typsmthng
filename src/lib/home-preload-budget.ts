/** Keep in sync with vite.config.ts modulePreload filters and scripts/check-bundle-budget.mjs. */
export const BLOCKED_HOME_PRELOAD_PATTERNS = [
  'vendor-',
  'editor-',
  'latex-',
  'typst',
  'workspace-',
  'project-io',
] as const

export function isBlockedHomePreload(file: string): boolean {
  return BLOCKED_HOME_PRELOAD_PATTERNS.some((pattern) => file.includes(pattern))
}

export function evaluateBundleBudget(input: {
  html: string
  assetSizes: Record<string, number>
  budgetBytes: number
}): {
  jsFiles: string[]
  totalBytes: number
  missing: string[]
  blockedPreloads: string[]
  overBudgetBy: number
  ok: boolean
} {
  const srcMatches = [...input.html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
  const preloadMatches = [...input.html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
  const jsFiles = [...new Set([...srcMatches, ...preloadMatches])]

  let totalBytes = 0
  const missing: string[] = []
  for (const file of jsFiles) {
    const size = input.assetSizes[file]
    if (size === undefined) {
      missing.push(file)
      continue
    }
    totalBytes += size
  }

  const blockedPreloads = jsFiles.filter((file) => isBlockedHomePreload(file))
  return {
    jsFiles,
    totalBytes,
    missing,
    blockedPreloads,
    overBudgetBy: Math.max(0, totalBytes - input.budgetBytes),
    ok: missing.length === 0 && blockedPreloads.length === 0 && totalBytes <= input.budgetBytes,
  }
}
