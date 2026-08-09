import { gunzipSync } from 'fflate'

export interface TarEntry {
  path: string
  data: Uint8Array
  type: 'file' | 'directory'
  mtime: number
}

const FILE_OR_DIR_TYPES = new Set(['', '0', '5'])
/** GNU long-name / long-link and pax extended headers — consume, don't emit. */
const METADATA_TYPES = new Set(['x', 'g', 'L', 'K'])

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

function readPaxPath(body: Uint8Array): string | null {
  const text = new TextDecoder().decode(body)
  for (const line of text.split('\n')) {
    const match = line.match(/^\d+\s+path=(.*)$/)
    if (match) return match[1]
  }
  return null
}

export function extractTarEntriesFromGzip(archive: Uint8Array): TarEntry[] {
  const tar = gunzipSync(archive)
  const entries: TarEntry[] = []

  let offset = 0
  let pendingLongName: string | null = null
  let pendingPaxPath: string | null = null

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
    // Copy bytes so callers cannot corrupt sibling entries via shared views.
    const body = tar.slice(bodyStart, bodyEnd)

    if (typeFlag === 'L') {
      pendingLongName = new TextDecoder().decode(body).replace(/\0+$/, '')
      offset = nextOffset
      continue
    }

    if (typeFlag === 'K') {
      // Long link name — unused for package scaffolds; skip.
      offset = nextOffset
      continue
    }

    if (typeFlag === 'x' || typeFlag === 'g') {
      pendingPaxPath = readPaxPath(body) ?? pendingPaxPath
      offset = nextOffset
      continue
    }

    if (!FILE_OR_DIR_TYPES.has(typeFlag)) {
      if (!METADATA_TYPES.has(typeFlag) && typeFlag !== '1' && typeFlag !== '2') {
        // Unknown type: skip body, keep going (Universe packages are ustar files).
      }
      offset = nextOffset
      continue
    }

    const rawPath = pendingPaxPath || pendingLongName || fullName || name
    pendingLongName = null
    pendingPaxPath = null

    const normalizedPath = normalizeTarPath(rawPath)
    if (!normalizedPath) {
      offset = nextOffset
      continue
    }

    if (typeFlag === '5') {
      entries.push({ path: normalizedPath, data: new Uint8Array(0), type: 'directory', mtime })
    } else {
      entries.push({ path: normalizedPath, data: body, type: 'file', mtime })
    }

    offset = nextOffset
  }

  return entries
}
