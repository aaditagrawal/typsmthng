import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('google font negative caching', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const options = { systemFontsEnabled: false, googleFontsEnabled: true }

  it('does not retry a failed Google Font fetch until the TTL elapses', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { loadDeclaredFontData } = await import('@/lib/declared-fonts')
    const source = '#set text(font: "Totally Unknown Family")'

    const first = await loadDeclaredFontData(source, undefined, options)
    expect(first.data).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await loadDeclaredFontData(source, undefined, options)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:31Z'))
    await loadDeclaredFontData(source, undefined, options)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches missing families longer than transient network failures', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const { loadDeclaredFontData } = await import('@/lib/declared-fonts')
    const source = '#set text(font: "Missing Family")'

    await loadDeclaredFontData(source, undefined, options)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Past the network-error TTL but within the not-found TTL.
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
    await loadDeclaredFontData(source, undefined, options)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'))
    await loadDeclaredFontData(source, undefined, options)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
