function clampLine(line: number, totalLines: number): number {
  return Math.max(1, Math.min(line, totalLines))
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]{}()<>#.+,:;!?'"|/\\=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 3)
}

export interface SourceLineRange {
  fromLine: number
  toLine: number
}

/**
 * Build a best-effort source line estimate from click position in preview.
 */
export function estimateFallbackLine(yRatio: number, totalLines: number): number {
  const ratio = Math.max(0, Math.min(1, yRatio))
  return Math.max(1, clampLine(Math.round(ratio * (totalLines - 1)) + 1, totalLines))
}

/**
 * Roughly map visible preview text to a source line.
 *
 * This intentionally optimizes for "general area" only, not exact char-level
 * mapping.
 */
export function findApproxSourceLine(
  source: string,
  previewText: string,
  fallbackLine: number,
): number | null {
  const query = normalizeText(previewText)
  if (!query) return null

  const lines = source.split('\n')
  if (lines.length === 0) return null

  const queryWords = tokenize(query)
  let bestLine: number | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const norm = normalizeText(lines[i])
    if (!norm) continue

    let score = 0

    if (query.length >= 6 && norm.includes(query)) {
      score += 16
    }

    if (queryWords.length > 0) {
      let overlap = 0
      for (const w of queryWords) {
        if (norm.includes(w)) overlap++
      }
      score += overlap * 2.5
      if (overlap === queryWords.length && queryWords.length >= 2) {
        score += 5
      }
    }

    // Bias ties toward click geometry in the preview.
    score -= Math.abs(lineNum - fallbackLine) * 0.12

    if (score > bestScore) {
      bestScore = score
      bestLine = lineNum
    }
  }

  return bestScore >= 2 ? bestLine : null
}

/**
 * Parse a typst source span into a source line range.
 *
 * Supports both `line:col` and `col:line` interpretations and picks the one
 * closer to fallback geometry.
 */
export function parseSourceSpanToRange(
  span: string,
  totalLines: number,
  fallbackLine: number,
  injectedPreambleLines = 0,
): SourceLineRange | null {
  const pairs = Array.from(span.matchAll(/(\d+):(\d+)/g)).map((m) => [
    parseInt(m[1], 10),
    parseInt(m[2], 10),
  ] as const)
  if (pairs.length === 0) return null

  const first = pairs[0]
  const last = pairs[pairs.length - 1]
  const candidates: SourceLineRange[] = [
    { fromLine: first[0], toLine: last[0] },
    { fromLine: first[1], toLine: last[1] },
  ]

  let best: SourceLineRange | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const c of candidates) {
    let from = c.fromLine - injectedPreambleLines
    let to = c.toLine - injectedPreambleLines
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (from > to) [from, to] = [to, from]

    const clamped: SourceLineRange = {
      fromLine: clampLine(from, totalLines),
      toLine: clampLine(to, totalLines),
    }
    const mid = Math.round((clamped.fromLine + clamped.toLine) / 2)
    const distance = Math.abs(mid - fallbackLine)
    if (distance < bestDistance) {
      bestDistance = distance
      best = clamped
    }
  }

  return best
}
