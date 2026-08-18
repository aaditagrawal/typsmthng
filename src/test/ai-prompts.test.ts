import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  buildEditPrompt,
  stripCodeFences,
  windowTail,
  windowHead,
  SELECTION_START_MARKER,
  SELECTION_END_MARKER,
  INSERTION_MARKER,
} from '@/lib/ai/prompts'

function makeContext(overrides: Partial<Parameters<typeof buildEditPrompt>[0]> = {}) {
  return {
    filePath: '/main.typ',
    instruction: 'convert this to a table',
    selection: 'a, b, c',
    before: '= Intro\n\nSome text.\n',
    after: '\n= Outro\n',
    filePaths: ['/main.typ', '/refs.bib'],
    diagnostics: [],
    ...overrides,
  }
}

describe('buildSystemPrompt', () => {
  it('describes Typst (not LaTeX) and forbids fences', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('Typst')
    expect(prompt).toContain('NOT LaTeX')
    expect(prompt.toLowerCase()).toContain('no markdown code fences')
  })
})

describe('windowing', () => {
  it('windowTail keeps the end and cuts at a line boundary', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line number ${i} with padding text`)
    const text = lines.join('\n')
    const windowed = windowTail(text, 6000)
    expect(windowed.length).toBeLessThanOrEqual(6000)
    expect(text.endsWith(windowed)).toBe(true)
    // Starts on a whole line, not mid-line.
    expect(windowed.startsWith('line number ')).toBe(true)
  })

  it('windowHead keeps the start and cuts at a line boundary', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line number ${i} with padding text`)
    const text = lines.join('\n')
    const windowed = windowHead(text, 6000)
    expect(windowed.length).toBeLessThanOrEqual(6000)
    expect(text.startsWith(windowed)).toBe(true)
    expect(windowed.endsWith('padding text')).toBe(true)
  })

  it('returns short text unchanged', () => {
    expect(windowTail('short', 6000)).toBe('short')
    expect(windowHead('short', 6000)).toBe('short')
  })
})

describe('buildEditPrompt', () => {
  it('delimits the selection and includes the instruction and file path', () => {
    const prompt = buildEditPrompt(makeContext())
    expect(prompt).toContain(`${SELECTION_START_MARKER}a, b, c${SELECTION_END_MARKER}`)
    expect(prompt).toContain('Instruction: convert this to a table')
    expect(prompt).toContain('/main.typ')
    expect(prompt).toContain('/refs.bib')
  })

  it('uses the insertion marker when there is no selection', () => {
    const prompt = buildEditPrompt(makeContext({ selection: '' }))
    expect(prompt).toContain(INSERTION_MARKER)
    expect(prompt).not.toContain(SELECTION_START_MARKER)
  })

  it('windows before/after context to ~6000 chars each', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `padding line ${i}`).join('\n')
    const prompt = buildEditPrompt(makeContext({ before: big, after: big }))
    // Both windows capped: total prompt must be far below two full copies.
    expect(prompt.length).toBeLessThan(2 * 6000 + 3000)
    expect(prompt).toContain('padding line 1999') // tail of `before` survives
    expect(prompt).toContain('padding line 0') // head of `after` survives
  })

  it('caps the file list at 50 entries', () => {
    const filePaths = Array.from({ length: 80 }, (_, i) => `/file-${i}.typ`)
    const prompt = buildEditPrompt(makeContext({ filePaths }))
    expect(prompt).toContain('/file-49.typ')
    expect(prompt).not.toContain('/file-50.typ')
    expect(prompt).toContain('30 more file(s)')
  })

  it('includes diagnostics capped at 10', () => {
    const diagnostics = Array.from({ length: 15 }, (_, i) => ({
      message: `problem number ${i}`,
      range: `${i + 1}:1-${i + 1}:5`,
    }))
    const prompt = buildEditPrompt(makeContext({ diagnostics }))
    expect(prompt).toContain('[1:1-1:5] problem number 0')
    expect(prompt).toContain('problem number 9')
    expect(prompt).not.toContain('problem number 10')
  })
})

describe('stripCodeFences', () => {
  it('leaves unfenced text untouched', () => {
    expect(stripCodeFences('= Heading\n#table(columns: 2)')).toBe('= Heading\n#table(columns: 2)')
  })

  it('removes a plain wrapping fence pair', () => {
    expect(stripCodeFences('```\n= Heading\n```')).toBe('= Heading')
  })

  it('removes a ```typst fence pair with trailing newline', () => {
    expect(stripCodeFences('```typst\n#let x = 1\n```\n')).toBe('#let x = 1')
  })

  it('keeps interior fences', () => {
    const inner = 'text\n```\nraw block\n```\nmore'
    expect(stripCodeFences('```typst\n' + inner + '\n```')).toBe(inner)
  })

  it('handles an empty fenced block', () => {
    expect(stripCodeFences('```typst\n```')).toBe('')
  })

  it('does not strip a lone opening fence without a closing one', () => {
    expect(stripCodeFences('```typst\nunterminated')).toBe('```typst\nunterminated')
  })
})
