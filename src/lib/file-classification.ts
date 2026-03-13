export const BIBLIOGRAPHY_TEXT_EXTENSIONS: readonly string[] = [
  '.bib',
  '.bibtex',
  '.bbl',
  '.ris',
  '.enw',
  '.nbib',
  '.cff',
  '.biblatex',
  '.csl',
  '.yaml',
  '.yml',
] as const

export const GENERAL_TEXT_EXTENSIONS: readonly string[] = [
  '.typ',
  '.txt',
  '.md',
  '.tex',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.toml',
  '.cfg',
  '.ini',
  '.log',
  '.sh',
  '.bat',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.svg',
] as const

export const ALL_TEXT_EXTENSIONS = Array.from(
  new Set([...GENERAL_TEXT_EXTENSIONS, ...BIBLIOGRAPHY_TEXT_EXTENSIONS])
)

const ALL_TEXT_EXTENSION_SET = new Set(ALL_TEXT_EXTENSIONS)
const BIBLIOGRAPHY_EXTENSION_SET = new Set(BIBLIOGRAPHY_TEXT_EXTENSIONS)

export function normalizeExtension(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName
  const sanitized = base.split(/[?#]/)[0]
  const lastDot = sanitized.lastIndexOf('.')

  if (lastDot <= 0 || lastDot === sanitized.length - 1) return ''
  return sanitized.slice(lastDot).toLowerCase()
}

export function isKnownTextPath(pathOrName: string): boolean {
  const extension = normalizeExtension(pathOrName)
  return extension !== '' && ALL_TEXT_EXTENSION_SET.has(extension)
}

export function isBibliographyPath(pathOrName: string): boolean {
  const extension = normalizeExtension(pathOrName)
  return extension !== '' && BIBLIOGRAPHY_EXTENSION_SET.has(extension)
}

export function isLatexPath(pathOrName: string): boolean {
  return normalizeExtension(pathOrName) === '.tex'
}

export function shouldTreatUploadAsText(file: File): boolean {
  if (isKnownTextPath(file.name)) return true
  return file.type.startsWith('text/')
}
