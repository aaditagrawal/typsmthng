#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve(process.cwd(), process.env.HOME_JS_DIST_DIR ?? 'dist')
const htmlPath = path.join(distDir, 'index.html')
const budgetBytes = Number(process.env.HOME_JS_BUDGET_BYTES ?? 500 * 1024)

// Keep in sync with src/lib/home-preload-budget.ts and vite.config.ts.
const BLOCKED_HOME_PRELOAD_PATTERNS = [
  'vendor-',
  'editor-',
  'latex-',
  'typst',
  'workspace-',
  'project-io',
]

function isBlockedHomePreload(file) {
  return BLOCKED_HOME_PRELOAD_PATTERNS.some((pattern) => file.includes(pattern))
}

if (!fs.existsSync(htmlPath)) {
  console.error('Missing dist/index.html. Run a production build first.')
  process.exit(1)
}

const html = fs.readFileSync(htmlPath, 'utf8')
const srcMatches = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const preloadMatches = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const jsFiles = [...new Set([...srcMatches, ...preloadMatches])]

let totalBytes = 0
for (const file of jsFiles) {
  const filePath = path.join(distDir, 'assets', file)
  if (!fs.existsSync(filePath)) {
    console.error(`Referenced JS file is missing: assets/${file}`)
    process.exit(1)
  }
  totalBytes += fs.statSync(filePath).size
}

const blockedPreloads = jsFiles.filter((file) => isBlockedHomePreload(file))

console.log(`Initial JS preload budget: ${Math.round(totalBytes / 1024)}KB (limit ${Math.round(budgetBytes / 1024)}KB)`)
console.log(`Initial JS files: ${jsFiles.join(', ')}`)

if (blockedPreloads.length > 0) {
  console.error('Editor/Typst/LaTeX/workspace chunks are preloaded in the home shell:')
  for (const file of blockedPreloads) {
    console.error(`- ${file}`)
  }
  process.exit(1)
}

if (totalBytes > budgetBytes) {
  console.error(`Initial JS exceeds budget by ${Math.round((totalBytes - budgetBytes) / 1024)}KB`)
  process.exit(1)
}

console.log('Bundle budget check passed.')
