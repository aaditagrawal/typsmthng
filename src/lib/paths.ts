/** Last path segment, e.g. `/docs/main.typ` → `main.typ`. Returns '' for empty/trailing-slash paths. */
export function basename(path: string): string {
  return path.split('/').pop() ?? ''
}

/** Parent directory without trailing slash, e.g. `/docs/main.typ` → `/docs`. Returns '' when there is no parent. */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '' : path.substring(0, idx)
}
