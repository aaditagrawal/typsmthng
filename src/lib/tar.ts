import { gunzipSync } from 'fflate'

export interface TarEntry {
  path: string
  data: Uint8Array
  type: 'file' | 'directory'
  mtime: number
}

const SUPPORTED_TAR_ENTRY_TYPES = new Set(['', '0', '5'])

function readString(buf: Uint8Array, start: number, len: number): string {
  const slice = buf.subarray(start, start + len)
  const zero = slice.indexOf(0)
  const end = zero >= 0 ? zero : slice.length
  return new TextDecoder().decode(slice.subarray(0, end))
}

function parseOctal(input: string): number {
  const cleaned = input.trim().replace(/\0+$/, '')
  if (!cleaned) return 0
  const parsed = Number.parseInt(cleaned, 8)
  if (Number.isNaN(parsed)) {
    throw new Error(`invalid tar octal value: ${input}`)
  }
  return parsed
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== 0) return false
  }
  return true
}

function normalizeTarPath(path: string): string {
  let normalized = path.replace(/\\/g, '/').trim()
  if (!normalized) {
    throw new Error('empty tar entry path')
  }

  // Drop leading "./" segments commonly found in archives.
  normalized = normalized.replace(/^(\.\/)+/, '')
  // Root marker entries are valid in tar archives, but not useful to consumers.
  if (normalized === '.' || normalized === './' || normalized === '') {
    return ''
  }

  if (normalized.startsWith('/')) {
    throw new Error(`unsafe tar path (absolute): ${path}`)
  }

  const parts = normalized.split('/').filter((segment) => segment.length > 0)
  if (parts.length === 0) {
    throw new Error('invalid tar entry path')
  }

  for (const part of parts) {
    if (part === '..') {
      throw new Error(`unsafe tar path (traversal): ${path}`)
    }
    if (part.includes('\0')) {
      throw new Error(`unsafe tar path (nul byte): ${path}`)
    }
  }

  return parts.join('/')
}

export function extractTarEntriesFromGzip(archive: Uint8Array): TarEntry[] {
  const tar = gunzipSync(archive)
  const entries: TarEntry[] = []

  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (isZeroBlock(header)) {
      break
    }

    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = parseOctal(readString(header, 124, 12))
    const mtime = parseOctal(readString(header, 136, 12))
    const typeFlag = readString(header, 156, 1)

    const bodyStart = offset + 512
    const bodyEnd = bodyStart + size
    if (bodyEnd > tar.length) {
      throw new Error('malformed tar archive: truncated entry')
    }

    const paddedSize = Math.ceil(size / 512) * 512
    const nextOffset = bodyStart + paddedSize

    if (!SUPPORTED_TAR_ENTRY_TYPES.has(typeFlag)) {
      offset = nextOffset
      continue
    }

    const rawPath = fullName || name
    const normalizedPath = normalizeTarPath(rawPath)
    if (!normalizedPath) {
      offset = nextOffset
      continue
    }

    if (typeFlag === '5') {
      entries.push({ path: normalizedPath, data: new Uint8Array(0), type: 'directory', mtime })
    } else {
      const data = tar.subarray(bodyStart, bodyEnd)
      entries.push({ path: normalizedPath, data, type: 'file', mtime })
    }

    offset = nextOffset
  }

  return entries
}
