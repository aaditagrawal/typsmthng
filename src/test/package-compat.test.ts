import { describe, expect, it } from 'vitest'
import { applyPackageImportCompatRewrites } from '@/lib/package-compat'

describe('package import compatibility rewrites', () => {
  it('upgrades known incompatible package spec imports', () => {
    const source = [
      '#import "@preview/ctheorems:1.1.2": *',
      '#import "@preview/gentle-clues:0.9.0": *',
      '= Document',
    ].join('\n')

    const rewritten = applyPackageImportCompatRewrites(source)
    expect(rewritten).toContain('@preview/ctheorems:1.1.3')
    expect(rewritten).not.toContain('@preview/ctheorems:1.1.2')
    expect(rewritten).toContain('@preview/gentle-clues:1.2.0')
    expect(rewritten).not.toContain('@preview/gentle-clues:0.9.0')
  })

  it('keeps source unchanged when no rewrite matches', () => {
    const source = '#import "@preview/ctheorems:1.1.3": *\n= Document'
    expect(applyPackageImportCompatRewrites(source)).toBe(source)
  })

  it('does not rewrite longer semver prefixes', () => {
    const source = '#import "@preview/ctheorems:1.1.20": *\n= Document'
    expect(applyPackageImportCompatRewrites(source)).toBe(source)
  })
})
