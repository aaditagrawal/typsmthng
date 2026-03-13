#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve(process.cwd(), 'dist')
const htmlPath = path.join(distDir, 'index.html')
const budgetBytes = Number(process.env.HOME_JS_BUDGET_BYTES ?? 500 * 1024)

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

const blockedPreloads = jsFiles.filter((file) => (
  file.includes('editor-')
  || file.includes('typst-engine')
  || file.includes('typst_ts_')
))

console.log(`Initial JS preload budget: ${Math.round(totalBytes / 1024)}KB (limit ${Math.round(budgetBytes / 1024)}KB)`)
console.log(`Initial JS files: ${jsFiles.join(', ')}`)

if (blockedPreloads.length > 0) {
  console.error('Editor/Typst chunks are preloaded in the home shell:')
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
