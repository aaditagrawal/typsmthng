import { describe, expect, it } from 'vitest'
import {
  BIBLIOGRAPHY_TEXT_EXTENSIONS,
  isBibliographyPath,
  isImagePath,
  isKnownTextPath,
  normalizeExtension,
  shouldTreatUploadAsText,
} from '@/lib/file-classification'

describe('file classification', () => {
  it('recognizes all bibliography extensions as text paths', () => {
    for (const ext of BIBLIOGRAPHY_TEXT_EXTENSIONS) {
      expect(isBibliographyPath(`/refs/library${ext}`)).toBe(true)
      expect(isKnownTextPath(`/refs/library${ext}`)).toBe(true)
    }
  })

  it('handles uppercase and mixed-case bibliography extensions', () => {
    expect(isBibliographyPath('/refs/RESEARCH.BIB')).toBe(true)
    expect(isKnownTextPath('/refs/archive.RiS')).toBe(true)
  })

  it('handles filenames with multiple dots', () => {
    expect(normalizeExtension('/refs/2026.02.dataset.final.BIBTEX')).toBe('.bibtex')
    expect(isKnownTextPath('/refs/2026.02.dataset.final.BIBTEX')).toBe(true)
  })

  it('falls back to MIME type for unknown extensions during upload', () => {
    const file = new File(['notes'], 'citations.unknownext', { type: 'text/plain' })
    expect(shouldTreatUploadAsText(file)).toBe(true)
  })

  it('rejects binary-like unknown files when MIME is non-text', () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'blob.unknownext', { type: 'application/octet-stream' })
    expect(shouldTreatUploadAsText(file)).toBe(false)
  })

  it('treats LaTeX .sty and .cls sources as text', () => {
    expect(isKnownTextPath('/macros/mypackage.sty')).toBe(true)
    expect(isKnownTextPath('/macros/MyClass.CLS')).toBe(true)
  })

  it('recognizes image paths for preview routing', () => {
    expect(isImagePath('/figs/photo.PNG')).toBe(true)
    expect(isImagePath('diagram.svg')).toBe(true)
    expect(isImagePath('/main.typ')).toBe(false)
  })
})
