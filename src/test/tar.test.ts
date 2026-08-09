import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractTarEntriesFromGzip } from '@/lib/tar'

const encoder = new TextEncoder()

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  const oct = value.toString(8)
  const padded = oct.padStart(length - 1, '0') + '\0'
  buf.set(encoder.encode(padded.slice(-length)), offset)
}

function writeString(buf: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value)
  buf.set(bytes.subarray(0, length), offset)
}

function checksum(header: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < header.length; i++) {
    sum += header[i]
  }
  return sum
}

function createTar(entries: Array<{ path: string; content?: string; type?: '0' | '5' }>): Uint8Array {
  const chunks: Uint8Array[] = []

  for (const entry of entries) {
    const type = entry.type ?? '0'
    const bodyContent = type === '5' ? '' : (entry.content ?? '')
    const data = encoder.encode(bodyContent)
    const header = new Uint8Array(512)

    writeString(header, 0, 100, entry.path)
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, data.length)
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
    header.fill(0x20, 148, 156)
    header[156] = type.charCodeAt(0)
    writeString(header, 257, 6, 'ustar\0')
    writeString(header, 263, 2, '00')

    writeOctal(header, 148, 8, checksum(header))

    chunks.push(header)
    chunks.push(data)

    const remainder = data.length % 512
    if (remainder > 0) {
      chunks.push(new Uint8Array(512 - remainder))
    }
  }

  chunks.push(new Uint8Array(1024))

  const total = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }

  return out
}

describe('tar extraction', () => {
  it('extracts file entries from tar.gz', () => {
    const tar = createTar([
      { path: 'typst.toml', content: '[package]\nname = "demo"\nversion = "0.1.0"\n' },
      { path: 'template/main.typ', content: '= Hello\n' },
    ])
    const gz = gzipSync(tar)

    const entries = extractTarEntriesFromGzip(gz)
    const paths = entries.map((e) => e.path)

    expect(paths).toContain('typst.toml')
    expect(paths).toContain('template/main.typ')

    const main = entries.find((e) => e.path === 'template/main.typ')
    expect(main?.type).toBe('file')
    expect(new TextDecoder().decode(main?.data)).toBe('= Hello\n')
  })

  it('rejects absolute paths', () => {
    const tar = createTar([{ path: '/etc/passwd', content: 'x' }])
    const gz = gzipSync(tar)
    expect(() => extractTarEntriesFromGzip(gz)).toThrow('unsafe tar path')
  })

  it('ignores root marker directory entries', () => {
    const tar = createTar([
      { path: '.', type: '5' },
      { path: 'template/main.typ', content: '= Hello\n' },
    ])
    const gz = gzipSync(tar)

    const entries = extractTarEntriesFromGzip(gz)
    expect(entries.map((entry) => entry.path)).toContain('template/main.typ')
  })

  it('returns copied entry bytes that callers can mutate safely', () => {
    const tar = createTar([
      { path: 'a.typ', content: 'AAAA' },
      { path: 'b.typ', content: 'BBBB' },
    ])
    const entries = extractTarEntriesFromGzip(gzipSync(tar))
    const a = entries.find((entry) => entry.path === 'a.typ')
    const b = entries.find((entry) => entry.path === 'b.typ')
    expect(a && b).toBeTruthy()
    a!.data[0] = 90
    expect(new TextDecoder().decode(b!.data)).toBe('BBBB')
  })
})
