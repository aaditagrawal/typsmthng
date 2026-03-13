import { describe, it, expect } from 'vitest'
import { estimateFallbackLine, findApproxSourceLine, parseSourceSpanToRange } from '@/lib/preview-mapping'

describe('preview mapping', () => {
  it('estimates fallback line from y ratio', () => {
    expect(estimateFallbackLine(0, 100)).toBe(1)
    expect(estimateFallbackLine(0.5, 100)).toBe(51)
    expect(estimateFallbackLine(1, 100)).toBe(100)
  })

  it('maps obvious preview text to source line', () => {
    const source = [
      '= Intro',
      '',
      'This is a test document.',
      '',
      '== Mathematics',
      'Inline: $x^2 + y^2 = z^2$',
    ].join('\n')

    const line = findApproxSourceLine(source, 'This is a test document.', 2)
    expect(line).toBe(3)
  })

  it('uses fallback proximity when text is duplicated', () => {
    const source = [
      'Title',
      'Typst',
      'Body',
      'More body',
      'Typst',
      'Tail',
    ].join('\n')

    const nearTop = findApproxSourceLine(source, 'Typst', 2)
    const nearBottom = findApproxSourceLine(source, 'Typst', 5)

    expect(nearTop).toBe(2)
    expect(nearBottom).toBe(5)
  })

  it('returns null for non-meaningful unmatched text', () => {
    const source = [
      '= Intro',
      'Some content',
      'Another line',
    ].join('\n')

    const line = findApproxSourceLine(source, 'qzxv__404', 2)
    expect(line).toBeNull()
  })

  it('parses source span into line range', () => {
    const range = parseSourceSpanToRange('/main.typ:36:12-/main.typ:40:8', 200, 35, 1)
    expect(range?.fromLine).toBe(35)
    expect(range?.toLine).toBe(39)
  })
})
