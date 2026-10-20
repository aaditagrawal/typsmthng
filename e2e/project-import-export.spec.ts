import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const bib = '@book{knuth1984, author={Donald E. Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}'
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#345678"/></svg>'

function archive(files: Record<string, string | Uint8Array>) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [
    path, typeof content === 'string' ? strToU8(content) : content,
  ]))))
}

async function uploadLatexZip(page: Page, name: string, files: Record<string, string | Uint8Array>) {
  const buffer = archive(files)
  await writeFile(test.info().outputPath(`${name}.zip`), buffer)
  await page.getByRole('button', { name: 'Import LaTeX', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '.zip archive', exact: true }).click()
  await (await chooser).setFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer })
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function expectCompiled(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Compiler Ready' })).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('canvas').or(page.getByText(/Compilation failed with \d+ error/)).first()).toBeVisible({ timeout: 90_000 })
  expect(await page.locator('canvas').count(), await page.locator('body').innerText()).toBeGreaterThan(0)
  await expect(page.locator('footer')).not.toContainText(/\[\d+\] Errors?/)
}

async function downloadZip(page: Page) {
  const event = page.waitForEvent('download')
  await page.getByTitle('Export project (.zip)', { exact: true }).click()
  const download = await event
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).not.toBeNull()
  return { name: download.suggestedFilename(), bytes: await readFile(path!) }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  page.on('dialog', (dialog) => dialog.accept())
})

test('multi-file LaTeX, nested includes, image and bibliography compile and round-trip', async ({ page }, testInfo) => {
  const files = {
    'paper/main.tex': String.raw`\documentclass{article}
\title{Import integration fixture}
\author{Ada Example}
\begin{document}
\maketitle
\input{chapters/intro}
\bibliographystyle{plain}
\bibliography{references}
\end{document}`,
    'paper/chapters/intro.tex': String.raw`\section{Introduction}
A citation \cite{knuth1984} and inline math $x^2 + y^2 = z^2$.
\input{chapters/details}
\begin{figure}\includegraphics{figures/chart.svg}\caption{Example chart}\label{fig:chart}\end{figure}
See Figure~\ref{fig:chart}.`,
    'paper/chapters/details.tex': String.raw`\subsection{Details}
\begin{itemize}\item First item\item Second item\end{itemize}
\begin{tabular}{ll}Name & Value \\ Alpha & 42\end{tabular}`,
    'paper/references.bib': bib,
    'paper/figures/chart.svg': svg,
    'paper/assets/raw.bin': new Uint8Array([0, 255, 11, 128, 33]),
  }
  await uploadLatexZip(page, 'paper', files)
  await expectCompiled(page)
  await page.screenshot({ path: testInfo.outputPath('multifile-preview.png'), fullPage: true })
  const exported = await downloadZip(page)
  await writeFile(testInfo.outputPath('exported-project.zip'), exported.bytes)
  const decoded = unzipSync(exported.bytes)
  expect(strFromU8(decoded['references.bib'])).toBe(bib)
  expect(strFromU8(decoded['figures/chart.svg'])).toBe(svg)
  expect(decoded['assets/raw.bin']).toEqual(files['paper/assets/raw.bin'])
  expect(strFromU8(decoded['chapters/intro.tex'])).toBe(files['paper/chapters/intro.tex'])
  expect(strFromU8(decoded['chapters/intro.typ'])).toContain('details.typ')
  const pdfEvent = page.waitForEvent('download')
  await page.getByTitle('Download PDF', { exact: true }).click()
  const pdf = await pdfEvent
  const pdfBytes = await readFile((await pdf.path())!)
  await writeFile(testInfo.outputPath('compiled-project.pdf'), pdfBytes)
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-')

  const chooser = page.waitForEvent('filechooser')
  await page.getByTitle('Import project (.zip)', { exact: true }).click()
  await (await chooser).setFiles({ name: exported.name, mimeType: 'application/zip', buffer: exported.bytes })
  await expectCompiled(page)
  const reexported = unzipSync((await downloadZip(page)).bytes)
  expect(Object.keys(reexported).sort()).toEqual(Object.keys(decoded).sort())
  for (const path of Object.keys(decoded)) expect(reexported[path], path).toEqual(decoded[path])
  await page.reload()
  await page.getByRole('button', { name: 'Open project Import integration fixture', exact: true }).first().click()
  await expectCompiled(page)
})

test('biblatex resources and numbered equations compile', async ({ page }, testInfo) => {
  await uploadLatexZip(page, 'biblatex', {
    'main.tex': String.raw`\documentclass{article}
\usepackage{biblatex}
\addbibresource{references.bib}
\title{Bibliography fixture}
\date{September 2026}
\begin{document}
\maketitle
\section{Energy $E=mc^2$}
\begin{equation}E=mc^2\label{eq:energy}\end{equation}
Equation~\ref{eq:energy}, citation \cite{knuth1984}.
\printbibliography
\end{document}`,
    'references.bib': bib,
  })
  await expectCompiled(page)
  await page.screenshot({ path: testInfo.outputPath('biblatex-preview.png'), fullPage: true })
})

test('native archive keeps raw LaTeX and the selected main file', async ({ page }) => {
  await uploadLatexZip(page, 'starter', { 'main.tex': String.raw`\documentclass{article}\begin{document}Starter\end{document}` })
  const native = archive({
    'appendix.typ': 'Appendix',
    'document.typ': '= Native roundtrip\nOriginal Typst document.',
    'sources/original.tex': String.raw`\documentclass{article}\begin{document}Original source\end{document}`,
    '.typsmthng/project.json': JSON.stringify({ format: 'typsmthng-project', version: 1, mainFile: '/document.typ' }),
  })
  const chooser = page.waitForEvent('filechooser')
  await page.getByTitle('Import project (.zip)', { exact: true }).click()
  await (await chooser).setFiles({ name: 'native.zip', mimeType: 'application/zip', buffer: native })
  await expect(page.locator('.cm-content')).toContainText('Native roundtrip')
  await expectCompiled(page)
  const exported = unzipSync((await downloadZip(page)).bytes)
  expect(exported['sources/original.tex']).toBeDefined()
  expect(exported['sources/original.typ']).toBeUndefined()
  expect(JSON.parse(strFromU8(exported['.typsmthng/project.json'])).mainFile).toBe('/document.typ')
})

test('corrupt archives show an error and leave the picker usable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: 'Import LaTeX', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '.zip archive', exact: true }).click()
  await (await chooser).setFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') })
  await expect(page.getByRole('button', { name: 'Dismiss import error' })).toBeVisible()
  await uploadLatexZip(page, 'recovery', { 'main.tex': String.raw`\documentclass{article}\begin{document}Recovered\end{document}` })
  await expect(page.locator('.cm-content')).toContainText('Recovered')
  expect(errors).toEqual([])
})

test('manual bibliography across files and extensionless images compile', async ({ page }) => {
  await uploadLatexZip(page, 'manual-references', {
    'chapters/background.tex': String.raw`\section{Background}A source \cite{manual-key}.`,
    'manuscript.tex': String.raw`\documentclass{article}
\begin{document}
\input{chapters/background}
\begin{figure}\includegraphics{chart}\caption{A chart}\end{figure}
\input{references}
\end{document}`,
    'references.tex': String.raw`\begin{thebibliography}{9}\bibitem{manual-key}Ada Example. Test reference, 2026.\end{thebibliography}`,
    'chart.svg': svg,
  })
  await expect(page.locator('.cm-content')).toContainText('background.typ')
  await expectCompiled(page)
})

test('sidebar upload preserves existing files and survives an immediate reload', async ({ page }) => {
  await uploadLatexZip(page, 'existing', { 'main.tex': String.raw`\documentclass{article}\begin{document}Original content\end{document}` })
  await page.getByTitle('Show sidebar', { exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTitle('Upload file', { exact: true }).click()
  await (await chooser).setFiles([
    { name: 'main.tex', mimeType: 'text/plain', buffer: Buffer.from(String.raw`\documentclass{article}\begin{document}Uploaded content\end{document}`) },
    { name: 'references.bib', mimeType: 'text/plain', buffer: Buffer.from(bib) },
  ])
  await expect(page.getByText('main-2.typ', { exact: true })).toBeVisible()
  await expect(page.getByText('references.bib', { exact: true })).toBeVisible()
  // Export awaits any current upload persistence and also checks collision handling.
  const exported = unzipSync((await downloadZip(page)).bytes)
  expect(strFromU8(exported['main.typ'])).toContain('Original content')
  expect(strFromU8(exported['main-2.typ'])).toContain('Uploaded content')
  await page.reload()
  await page.getByRole('button', { name: 'Open project existing', exact: true }).click()
  await page.getByTitle('Show sidebar', { exact: true }).click()
  await expect(page.getByText('main-2.typ', { exact: true })).toBeVisible()
  await expect(page.getByText('references.bib', { exact: true })).toBeVisible()
})

test('bulk export and import preserve separate projects with the same name', async ({ page }) => {
  for (const content of ['First article', 'Second article']) {
    await uploadLatexZip(page, 'repeated', {
      'main.tex': `\\documentclass{article}\\title{Repeated}\\begin{document}${content}\\end{document}`,
    })
    await page.getByTitle('Back to projects', { exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'Open project Repeated', exact: true })).toHaveCount(2)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all', exact: true }).click()
  const download = await downloadEvent
  const bytes = await readFile((await download.path())!)
  const decoded = unzipSync(bytes)
  expect(decoded['Repeated/main.typ']).toBeDefined()
  expect(decoded['Repeated-2/main.typ']).toBeDefined()
  expect(strFromU8(decoded['Repeated/main.typ'])).not.toBe(strFromU8(decoded['Repeated-2/main.typ']))
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import all', exact: true }).click()
  await (await chooser).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: bytes })
  await expect(page.getByRole('button', { name: 'Open project Repeated', exact: true })).toHaveCount(4)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Open project Repeated', exact: true })).toHaveCount(4)
})
