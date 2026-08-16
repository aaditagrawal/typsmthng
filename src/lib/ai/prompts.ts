/**
 * Prompt/context assembly for the inline AI editing panel.
 */

export const SELECTION_START_MARKER = '<<<SELECTION_START>>>'
export const SELECTION_END_MARKER = '<<<SELECTION_END>>>'
export const INSERTION_MARKER = '<<<INSERT_HERE>>>'

const CONTEXT_WINDOW_CHARS = 6000
const MAX_FILE_PATHS = 50
const MAX_DIAGNOSTICS = 10

export interface PromptDiagnostic {
  message: string
  /** Typst range string like "12:4-12:9" (line:col). May be empty. */
  range: string
}

export interface EditPromptContext {
  filePath: string | null
  instruction: string
  /** Selected text to replace; empty string means generate at the cursor. */
  selection: string
  /** Document text before the selection/cursor (will be windowed). */
  before: string
  /** Document text after the selection/cursor (will be windowed). */
  after: string
  /** All project file paths (will be capped). */
  filePaths: string[]
  /** Compile diagnostics for the current file (will be capped). */
  diagnostics: PromptDiagnostic[]
}

/**
 * Keep at most `maxChars` from the end of `text`, cutting at a line boundary
 * when possible so the window starts on a whole line.
 */
export function windowTail(text: string, maxChars: number = CONTEXT_WINDOW_CHARS): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(text.length - maxChars)
  const firstNewline = cut.indexOf('\n')
  if (firstNewline === -1 || firstNewline === cut.length - 1) return cut
  return cut.slice(firstNewline + 1)
}

/**
 * Keep at most `maxChars` from the start of `text`, cutting at a line boundary
 * when possible so the window ends on a whole line.
 */
export function windowHead(text: string, maxChars: number = CONTEXT_WINDOW_CHARS): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastNewline = cut.lastIndexOf('\n')
  if (lastNewline <= 0) return cut
  return cut.slice(0, lastNewline)
}

export function buildSystemPrompt(): string {
  return [
    'You are a Typst editing engine embedded inside a Typst editor. Typst is NOT LaTeX; never emit LaTeX commands.',
    '',
    'Typst syntax reminders:',
    '- Imports/definitions: #import "@preview/pkg:0.1.0": name — #let x = 1 — #set page(...) — #show rule',
    '- Markup: *bold*, _italic_, `code`, = Heading, == Subheading, - list item, + numbered item',
    '- Math: inline $x^2$, block $ sum_(i=1)^n i $ (no \\begin/\\end, no \\frac — use frac(a, b) or a/b)',
    '- Figures: #figure(image("f.png"), caption: [...]) — Tables: #table(columns: 3, [a], [b], [c])',
    '- Functions are called with #name(...) in markup; content blocks use [brackets].',
    '',
    'Output rules (strict):',
    '- Output ONLY the replacement or inserted Typst source text.',
    '- No markdown code fences, no explanations, no surrounding quotes, no commentary before or after.',
    '- Match the indentation and style of the surrounding document.',
  ].join('\n')
}

function formatFileList(filePaths: string[]): string {
  const capped = filePaths.slice(0, MAX_FILE_PATHS)
  const extra = filePaths.length - capped.length
  const lines = capped.map((p) => `- ${p}`)
  if (extra > 0) lines.push(`- … and ${extra} more file(s)`)
  return lines.join('\n')
}

function formatDiagnostics(diagnostics: PromptDiagnostic[]): string {
  return diagnostics
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => (d.range ? `- [${d.range}] ${d.message}` : `- ${d.message}`))
    .join('\n')
}

/**
 * Build the user prompt for a selection replacement or an at-cursor insertion
 * (when `ctx.selection` is empty).
 */
export function buildEditPrompt(ctx: EditPromptContext): string {
  const before = windowTail(ctx.before)
  const after = windowHead(ctx.after)
  const isInsertion = ctx.selection.length === 0

  const parts: string[] = []
  parts.push(`Current file: ${ctx.filePath ?? '(untitled)'}`)

  if (ctx.filePaths.length > 0) {
    parts.push(`\nProject files:\n${formatFileList(ctx.filePaths)}`)
  }

  if (ctx.diagnostics.length > 0) {
    parts.push(`\nCurrent compiler diagnostics for this file:\n${formatDiagnostics(ctx.diagnostics)}`)
  }

  if (isInsertion) {
    parts.push(
      `\nThe document below contains the marker ${INSERTION_MARKER} at the cursor position.`,
      'Write the Typst source that should be inserted at that exact position. Return ONLY the text to insert — do not repeat the surrounding document or the marker.',
    )
    parts.push(`\n--- DOCUMENT ---\n${before}${INSERTION_MARKER}${after}\n--- END DOCUMENT ---`)
  } else {
    parts.push(
      `\nThe document below delimits the selected region between ${SELECTION_START_MARKER} and ${SELECTION_END_MARKER}.`,
      'Rewrite ONLY that delimited region according to the instruction. Return ONLY the replacement for the delimited region — do not repeat the markers or the surrounding document.',
    )
    parts.push(
      `\n--- DOCUMENT ---\n${before}${SELECTION_START_MARKER}${ctx.selection}${SELECTION_END_MARKER}${after}\n--- END DOCUMENT ---`,
    )
  }

  parts.push(`\nInstruction: ${ctx.instruction}`)
  return parts.join('\n')
}

/**
 * Defensively remove a single wrapping ``` or ```typst fence pair that a model
 * may have added despite instructions. Interior fences are left alone.
 */
export function stripCodeFences(text: string): string {
  // Empty fenced block, e.g. "```typst\n```".
  const emptyMatch = /^\s*```[\w+-]*[ \t]*\r?\n[ \t]*```[ \t]*\r?\n?\s*$/.exec(text)
  if (emptyMatch) return ''
  // Greedy body match so the closing fence is the LAST fence — interior fences survive.
  const match = /^\s*```[\w+-]*[ \t]*\r?\n([\s\S]*)\r?\n[ \t]*```[ \t]*\r?\n?[ \t]*$/.exec(text)
  return match ? match[1] : text
}
