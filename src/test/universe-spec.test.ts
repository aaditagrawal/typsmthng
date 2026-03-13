import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  formatResolvedSpec,
  parseInitCommand,
  parsePackageSpec,
} from '@/lib/universe-spec'

describe('universe spec parsing', () => {
  it('parses versioned preview spec', () => {
    expect(parsePackageSpec('@preview/aero-check:0.1.1')).toEqual({
      namespace: 'preview',
      name: 'aero-check',
      version: '0.1.1',
    })
  })

  it('parses versionless preview spec', () => {
    expect(parsePackageSpec('@preview/charged-ieee')).toEqual({
      namespace: 'preview',
      name: 'charged-ieee',
      version: undefined,
    })
  })

  it('rejects non-preview namespace', () => {
    expect(() => parsePackageSpec('@local/pkg:1.0.0')).toThrow("only the '@preview' namespace is supported")
  })

  it('compares semver values correctly', () => {
    expect(compareSemver('0.1.9', '0.2.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })

  it('formats resolved spec', () => {
    expect(formatResolvedSpec({ namespace: 'preview', name: 'aero-check', version: '0.1.1' }))
      .toBe('@preview/aero-check:0.1.1')
  })
})

describe('typst init command parsing', () => {
  it('parses strict typst init command', () => {
    expect(parseInitCommand('typst init @preview/aero-check:0.1.1')).toEqual({
      spec: {
        namespace: 'preview',
        name: 'aero-check',
        version: '0.1.1',
      },
      dir: undefined,
    })
  })

  it('parses init command with custom directory', () => {
    expect(parseInitCommand('typst init @preview/aero-check my-paper')).toEqual({
      spec: {
        namespace: 'preview',
        name: 'aero-check',
        version: undefined,
      },
      dir: 'my-paper',
    })
  })

  it('rejects malformed command shapes', () => {
    expect(() => parseInitCommand('typst init')).toThrow('expected command format: typst init <spec> [dir]')
    expect(() => parseInitCommand('typst init @preview/aero-check extra one')).toThrow(
      'expected command format: typst init <spec> [dir]',
    )
    expect(() => parseInitCommand('init @preview/aero-check')).toThrow(
      'expected command format: typst init <spec> [dir]',
    )
  })
})
