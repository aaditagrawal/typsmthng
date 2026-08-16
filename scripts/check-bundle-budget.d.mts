export declare const HOME_PRELOAD_FILTER_PATTERNS: string[]
export declare function isBlockedHomeChunk(file: string): boolean
export declare function extractEntryFiles(html: string): string[]
export declare function evaluateBundleBudget(input: {
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
}
