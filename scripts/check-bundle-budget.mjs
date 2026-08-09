#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve(process.cwd(), process.env.HOME_JS_DIST_DIR ?? 'dist')
const assetsDir = path.join(distDir, 'assets')
const htmlPath = path.join(distDir, 'index.html')
const budgetBytes = Number(process.env.HOME_JS_BUDGET_BYTES ?? 500 * 1024)

if (!fs.existsSync(htmlPath)) {
  console.error('Missing dist/index.html. Run a production build first.')
  process.exit(1)
}

const html = fs.readFileSync(htmlPath, 'utf8')
const srcMatches = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const preloadMatches = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const entryFiles = [...new Set([...srcMatches, ...preloadMatches])]

function isBlockedHomeChunk(file) {
  // editor-store is intentionally on the home path for sync Cmd+S.
  // editor-core / editor-vim must stay deferred with the workspace.
  return (
    file.includes('editor-core')
    || file.includes('editor-vim')
    || file.includes('typst-engine')
    || file.includes('typst_ts_')
    || file.includes('typst-worker')
    || file.includes('latex-')
    || file.includes('workspace-')
    || file.includes('project-io')
  )
}

/** Collect static ESM imports (not dynamic import()) from a chunk. */
function staticImportsOf(file) {
  const filePath = path.join(assetsDir, file)
  if (!fs.existsSync(filePath)) return []
  const source = fs.readFileSync(filePath, 'utf8')
  const found = new Set()
  for (const match of source.matchAll(/(?:^|[^\w.])import\s*(?:[^"'`]*from\s*)?["']\.\/([^"']+\.js)["']/g)) {
    found.add(match[1])
  }
  return [...found]
}

function walkStaticClosure(roots) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.shift()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const dep of staticImportsOf(file)) {
      if (!seen.has(dep)) queue.push(dep)
    }
  }
  return [...seen]
}

const closureFiles = walkStaticClosure(entryFiles)

let preloadBytes = 0
for (const file of entryFiles) {
  const filePath = path.join(assetsDir, file)
  if (!fs.existsSync(filePath)) {
    console.error(`Referenced JS file is missing: assets/${file}`)
    process.exit(1)
  }
  preloadBytes += fs.statSync(filePath).size
}

let closureBytes = 0
for (const file of closureFiles) {
  const filePath = path.join(assetsDir, file)
  if (!fs.existsSync(filePath)) {
    console.error(`Static dependency missing: assets/${file}`)
    process.exit(1)
  }
  closureBytes += fs.statSync(filePath).size
}

const blockedPreloads = entryFiles.filter(isBlockedHomeChunk)
const blockedClosure = closureFiles.filter(isBlockedHomeChunk)
const typstInVendor = closureFiles.filter((file) => {
  if (!file.includes('vendor-')) return false
  const source = fs.readFileSync(path.join(assetsDir, file), 'utf8')
  return source.includes('createTypstCompiler') || source.includes('@myriaddreamin')
})

console.log(`Initial JS preload budget: ${Math.round(preloadBytes / 1024)}KB (limit ${Math.round(budgetBytes / 1024)}KB)`)
console.log(`Initial JS preload files: ${entryFiles.join(', ')}`)
console.log(`Home static closure: ${Math.round(closureBytes / 1024)}KB across ${closureFiles.length} files`)

let failed = false

if (blockedPreloads.length > 0) {
  failed = true
  console.error('Editor/Typst/workspace chunks are preloaded in the home shell:')
  for (const file of blockedPreloads) console.error(`- ${file}`)
}

if (blockedClosure.length > 0) {
  failed = true
  console.error('Home static import closure includes deferred chunks:')
  for (const file of blockedClosure) console.error(`- ${file}`)
}

if (typstInVendor.length > 0) {
  failed = true
  console.error('Typst runtime leaked into vendor on the home static path:')
  for (const file of typstInVendor) console.error(`- ${file}`)
}

if (preloadBytes > budgetBytes) {
  failed = true
  console.error(`Initial JS preload exceeds budget by ${Math.round((preloadBytes - budgetBytes) / 1024)}KB`)
}

if (failed) process.exit(1)

console.log('Bundle budget check passed.')
