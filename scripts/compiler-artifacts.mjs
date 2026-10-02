// Compiler hash seeds can change with rustc. Preserve geometry, text, and
// reference relationships while canonicalizing opaque SVG identifiers.
export function normalizeCompilerSvg(svg) {
  const ids = new Map()
  const tids = new Map()
  return svg.replace(/( id| href)="(#?)([^"]+)"/g, (attribute, name, prefix, id) => {
    if (name === ' href' && !prefix) return attribute
    if (!ids.has(id)) ids.set(id, ids.size)
    return `${name}="${prefix}id${ids.get(id)}"`
  }).replace(/ data-tid="([^"]*)"/g, (_, id) => {
    if (!tids.has(id)) tids.set(id, tids.size)
    return ` data-tid="tid${tids.get(id)}"`
  })
}
