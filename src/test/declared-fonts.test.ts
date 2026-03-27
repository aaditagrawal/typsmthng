import { describe, expect, it } from 'vitest'
import { extractTypstFontFamilies } from '@/lib/declared-fonts'

describe('declared-fonts', () => {
  it('extracts only font families from the font expression', () => {
    const source = `
      #set text(font: ("Inter", "Source Serif 4"), size: 11pt)
      #image("mahelogo.png", width: 2cm)
      #set text(weight: "bold")
    `

    expect(extractTypstFontFamilies(source)).toEqual(['Inter', 'Source Serif 4'])
  })

  it('ignores keyword-like and filename-like string literals', () => {
    const source = `
      #set text(
        font: "bold",
        fallback: "mahelogo.png",
      )
    `

    expect(extractTypstFontFamilies(source)).toEqual([])
  })
})
