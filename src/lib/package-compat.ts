interface PackageImportRewrite {
  from: string
  to: string
}

// Compatibility rewrites for package specs that fail with the current Typst runtime.
const PACKAGE_IMPORT_REWRITES: PackageImportRewrite[] = [
  {
    from: '@preview/ctheorems:1.1.2',
    to: '@preview/ctheorems:1.1.3',
  },
  {
    from: '@preview/gentle-clues:0.9.0',
    to: '@preview/gentle-clues:1.2.0',
  },
  {
    from: '@preview/gentle-clues:1.0.0',
    to: '@preview/gentle-clues:1.2.0',
  },
  {
    from: '@preview/gentle-clues:1.1.0',
    to: '@preview/gentle-clues:1.2.0',
  },
]

export function applyPackageImportCompatRewrites(source: string): string {
  let next = source
  for (const rewrite of PACKAGE_IMPORT_REWRITES) {
    if (!next.includes(rewrite.from)) continue
    next = next.split(rewrite.from).join(rewrite.to)
  }
  return next
}
