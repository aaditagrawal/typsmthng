export interface ParsedSpec {
  namespace: 'preview'
  name: string
  version?: string
}

export interface ResolvedSpec {
  namespace: 'preview'
  name: string
  version: string
}

export interface ParsedInitCommand {
  spec: ParsedSpec
  dir?: string
}

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/

function parseNamespace(input: string): string {
  if (!input.startsWith('@')) {
    throw new Error("package specification must start with '@'")
  }

  const slash = input.indexOf('/')
  if (slash < 0) {
    throw new Error('package specification is missing name')
  }

  const namespace = input.slice(1, slash)
  if (!namespace) {
    throw new Error('package specification is missing namespace')
  }
  if (!IDENT_RE.test(namespace)) {
    throw new Error(`\`${namespace}\` is not a valid package namespace`)
  }
  return namespace
}

function parseNameAndVersion(input: string): { name: string; version?: string } {
  const slash = input.indexOf('/')
  const rest = input.slice(slash + 1)

  if (!rest) {
    throw new Error('package specification is missing name')
  }

  const colon = rest.indexOf(':')
  const name = colon >= 0 ? rest.slice(0, colon) : rest
  const version = colon >= 0 ? rest.slice(colon + 1) : undefined

  if (!name) {
    throw new Error('package specification is missing name')
  }
  if (!IDENT_RE.test(name)) {
    throw new Error(`\`${name}\` is not a valid package name`)
  }

  if (version !== undefined) {
    if (!version) {
      throw new Error('package specification is missing version')
    }
    if (!SEMVER_RE.test(version)) {
      throw new Error(`\`${version}\` is not a valid package version`)
    }
  }

  return { name, version }
}

export function parsePackageSpec(input: string): ParsedSpec {
  const spec = input.trim()
  if (!spec) {
    throw new Error('template package specification is required')
  }

  const namespace = parseNamespace(spec)
  if (namespace !== 'preview') {
    throw new Error("only the '@preview' namespace is supported")
  }

  const { name, version } = parseNameAndVersion(spec)
  return { namespace: 'preview', name, version }
}

export function formatResolvedSpec(spec: ResolvedSpec): string {
  return `@${spec.namespace}/${spec.name}:${spec.version}`
}

export function parseVersion(version: string): [number, number, number] {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`\`${version}\` is not a valid package version`)
  }
  const [major, minor, patch] = version.split('.').map((part) => Number(part))
  return [major, minor, patch]
}

export function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseVersion(a)
  const [bMaj, bMin, bPatch] = parseVersion(b)

  if (aMaj !== bMaj) return aMaj - bMaj
  if (aMin !== bMin) return aMin - bMin
  return aPatch - bPatch
}

export function parseInitCommand(command: string): ParsedInitCommand {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new Error('init command cannot be empty')
  }

  const tokens = trimmed.split(/\s+/)
  if (tokens.length < 3) {
    throw new Error('expected command format: typst init <spec> [dir]')
  }
  if (tokens.length > 4) {
    throw new Error('expected command format: typst init <spec> [dir]')
  }
  if (tokens[0] !== 'typst' || tokens[1] !== 'init') {
    throw new Error('expected command format: typst init <spec> [dir]')
  }

  const spec = parsePackageSpec(tokens[2])
  const dir = tokens[3]

  if (dir !== undefined && !dir.trim()) {
    throw new Error('project directory cannot be empty')
  }

  return { spec, dir }
}

export function normalizeResolvedSpec(spec: ParsedSpec, resolvedVersion: string): ResolvedSpec {
  return {
    namespace: 'preview',
    name: spec.name,
    version: resolvedVersion,
  }
}

export function toResolvedSpec(spec: ParsedSpec): ResolvedSpec {
  if (!spec.version) {
    throw new Error('package version is required')
  }
  return {
    namespace: 'preview',
    name: spec.name,
    version: spec.version,
  }
}
