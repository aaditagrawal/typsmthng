interface LocalFontDescriptor {
  family: string
  blob: () => Promise<Blob>
}

interface DeclaredFontsOptions {
  systemFontsEnabled: boolean
  googleFontsEnabled: boolean
}

interface DeclaredFontDataResult {
  key: string
  data: Uint8Array[]
}

const FONT_CONFIG_SCAN_WINDOW = 240
const FONT_CONFIG_REGEX = /font\s*:\s*/g
const STRING_LITERAL_REGEX = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g
const GOOGLE_FONT_URL_REGEX = /url\(([^)]+)\)/g
const GOOGLE_FONT_VARIANTS = [
  '100', '100italic',
  '200', '200italic',
  '300', '300italic',
  '400', '400italic',
  '500', '500italic',
  '600', '600italic',
  '700', '700italic',
  '800', '800italic',
  '900', '900italic',
].join(',')
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'emoji',
  'math',
  'fangsong',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

let localFontsIndexPromise: Promise<Map<string, LocalFontDescriptor[]>> | null = null
const localFontFamilyCache = new Map<string, Promise<Uint8Array[]>>()
const googleFontFamilyCache = new Map<string, Promise<Uint8Array[]>>()

export function normalizeFontFamily(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function shouldIgnoreFontFamily(family: string): boolean {
  return GENERIC_FONT_FAMILIES.has(normalizeFontFamily(family))
}

export function extractTypstFontFamilies(
  source: string,
  extraFiles?: Array<{ path: string; content: string }>,
): string[] {
  const families = new Map<string, string>()
  const contents = [source, ...(extraFiles?.map((file) => file.content) ?? [])]

  for (const content of contents) {
    FONT_CONFIG_REGEX.lastIndex = 0
    let fontConfigMatch: RegExpExecArray | null = null
    while ((fontConfigMatch = FONT_CONFIG_REGEX.exec(content)) !== null) {
      const start = fontConfigMatch.index + fontConfigMatch[0].length
      const snippet = content.slice(start, start + FONT_CONFIG_SCAN_WINDOW)

      STRING_LITERAL_REGEX.lastIndex = 0
      let stringMatch: RegExpExecArray | null = null
      while ((stringMatch = STRING_LITERAL_REGEX.exec(snippet)) !== null) {
        const family = (stringMatch[1] ?? stringMatch[2] ?? '').trim()
        if (!family || shouldIgnoreFontFamily(family)) continue

        const normalized = normalizeFontFamily(family)
        if (!families.has(normalized)) {
          families.set(normalized, family)
        }
      }
    }
  }

  return [...families.values()]
}

async function getLocalFontsIndex(): Promise<Map<string, LocalFontDescriptor[]>> {
  if (localFontsIndexPromise) return localFontsIndexPromise

  localFontsIndexPromise = (async () => {
    const queryLocalFonts = typeof window !== 'undefined'
      ? (window as Window & { queryLocalFonts?: () => Promise<LocalFontDescriptor[]> }).queryLocalFonts
      : undefined
    if (typeof queryLocalFonts !== 'function') {
      return new Map<string, LocalFontDescriptor[]>()
    }

    try {
      const fonts = await queryLocalFonts()
      const byFamily = new Map<string, LocalFontDescriptor[]>()

      for (const font of fonts) {
        const key = normalizeFontFamily(font.family)
        const bucket = byFamily.get(key)
        if (bucket) {
          bucket.push(font)
        } else {
          byFamily.set(key, [font])
        }
      }

      return byFamily
    } catch (err) {
      console.warn('Local font access is unavailable:', err)
      return new Map<string, LocalFontDescriptor[]>()
    }
  })()

  return localFontsIndexPromise
}

async function loadSystemFontData(families: string[]): Promise<{
  key: string
  data: Uint8Array[]
  matchedFamilies: string[]
}> {
  if (families.length === 0) {
    return { key: '', data: [], matchedFamilies: [] }
  }

  const fontIndex = await getLocalFontsIndex()
  const matchedFamilies = families
    .map((family) => normalizeFontFamily(family))
    .filter((family, index, allFamilies) => fontIndex.has(family) && allFamilies.indexOf(family) === index)

  if (matchedFamilies.length === 0) {
    return { key: '', data: [], matchedFamilies: [] }
  }

  const dataChunks = await Promise.all(
    matchedFamilies.map(async (family) => {
      let cached = localFontFamilyCache.get(family)
      if (!cached) {
        const fonts = fontIndex.get(family) ?? []
        cached = Promise.all(
          fonts.map(async (font) => new Uint8Array(await (await font.blob()).arrayBuffer())),
        )
        localFontFamilyCache.set(family, cached)
      }
      return cached
    }),
  )

  return {
    key: matchedFamilies.sort().join('\n'),
    data: dataChunks.flat(),
    matchedFamilies,
  }
}

function buildGoogleFontCssUrl(family: string): string {
  const encodedFamily = encodeURIComponent(family.trim()).replace(/%20/g, '+')
  return `https://fonts.googleapis.com/css?family=${encodedFamily}:${GOOGLE_FONT_VARIANTS}&display=swap`
}

function extractGoogleFontUrls(css: string): string[] {
  const urls = new Set<string>()
  GOOGLE_FONT_URL_REGEX.lastIndex = 0

  let match: RegExpExecArray | null = null
  while ((match = GOOGLE_FONT_URL_REGEX.exec(css)) !== null) {
    const rawUrl = match[1]?.trim().replace(/^['"]|['"]$/g, '')
    if (rawUrl) {
      urls.add(rawUrl)
    }
  }

  return [...urls]
}

async function fetchGoogleFontData(family: string): Promise<Uint8Array[]> {
  const normalizedFamily = normalizeFontFamily(family)
  let cached = googleFontFamilyCache.get(normalizedFamily)
  if (!cached) {
    cached = (async () => {
      const cssResponse = await fetch(buildGoogleFontCssUrl(family))
      if (!cssResponse.ok) {
        throw new Error(`Google Fonts CSS request failed with ${cssResponse.status}`)
      }

      const css = await cssResponse.text()
      const fontUrls = extractGoogleFontUrls(css)
      if (fontUrls.length === 0) {
        return []
      }

      return Promise.all(
        fontUrls.map(async (fontUrl) => {
          const fontResponse = await fetch(fontUrl)
          if (!fontResponse.ok) {
            throw new Error(`Google Fonts asset request failed with ${fontResponse.status}`)
          }
          return new Uint8Array(await fontResponse.arrayBuffer())
        }),
      )
    })().catch((err) => {
      googleFontFamilyCache.delete(normalizedFamily)
      throw err
    })

    googleFontFamilyCache.set(normalizedFamily, cached)
  }

  return cached
}

async function loadGoogleFontData(families: string[]): Promise<{ key: string; data: Uint8Array[] }> {
  if (families.length === 0) {
    return { key: '', data: [] }
  }

  const uniqueFamilies = [...new Map(
    families.map((family) => [normalizeFontFamily(family), family]),
  ).values()]

  const results = await Promise.all(
    uniqueFamilies.map(async (family) => {
      try {
        return {
          family: normalizeFontFamily(family),
          data: await fetchGoogleFontData(family),
        }
      } catch (err) {
        console.warn(`Google Fonts import failed for "${family}":`, err)
        return {
          family: normalizeFontFamily(family),
          data: [] as Uint8Array[],
        }
      }
    }),
  )

  const loadedFamilies = results
    .filter((result) => result.data.length > 0)
    .map((result) => result.family)
    .sort()

  return {
    key: loadedFamilies.join('\n'),
    data: results.flatMap((result) => result.data),
  }
}

export async function loadDeclaredFontData(
  source: string,
  extraFiles: Array<{ path: string; content: string }> | undefined,
  options: DeclaredFontsOptions,
): Promise<DeclaredFontDataResult> {
  const families = extractTypstFontFamilies(source, extraFiles)
  if (families.length === 0) {
    return { key: '', data: [] }
  }

  const systemFonts = options.systemFontsEnabled
    ? await loadSystemFontData(families)
    : { key: '', data: [] as Uint8Array[], matchedFamilies: [] as string[] }
  const googleCandidates = families.filter(
    (family) => !systemFonts.matchedFamilies.includes(normalizeFontFamily(family)),
  )
  const googleFonts = options.googleFontsEnabled
    ? await loadGoogleFontData(googleCandidates)
    : { key: '', data: [] as Uint8Array[] }

  const keyParts = []
  if (systemFonts.key) keyParts.push(`system:${systemFonts.key}`)
  if (googleFonts.key) keyParts.push(`google:${googleFonts.key}`)

  return {
    key: keyParts.join('|'),
    data: [...systemFonts.data, ...googleFonts.data],
  }
}
