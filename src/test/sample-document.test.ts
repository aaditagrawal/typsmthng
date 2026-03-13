import { describe, it, expect } from 'vitest'
import { SAMPLE_DOCUMENT } from '@/lib/sample-document'

describe('Sample Document', () => {
  it('should not reference Linux Libertine font', () => {
    expect(SAMPLE_DOCUMENT).not.toContain('Linux Libertine')
  })

  it('should not reference any unavailable fonts', () => {
    // The WASM compiler has limited font support
    // Ensure we don't set a specific font that might not be available
    const fontRegex = /font:\s*"[^"]+"/g
    const matches = SAMPLE_DOCUMENT.match(fontRegex) ?? []
    for (const match of matches) {
      // These fonts are known to be unavailable in the WASM compiler
      expect(match).not.toContain('Linux Libertine')
      expect(match).not.toContain('Times New Roman')
    }
  })

  it('should contain valid Typst markup', () => {
    expect(SAMPLE_DOCUMENT).toContain('#set page')
    expect(SAMPLE_DOCUMENT).toContain('#set text')
    expect(SAMPLE_DOCUMENT).toContain('= ')
  })

  it('should have reasonable length', () => {
    expect(SAMPLE_DOCUMENT.length).toBeGreaterThan(100)
    expect(SAMPLE_DOCUMENT.length).toBeLessThan(5000)
  })
})
