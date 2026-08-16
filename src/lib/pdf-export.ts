import { useEditorStore } from '@/stores/editor-store'
import { useProjectStore } from '@/stores/project-store'
import { useCompileStore } from '@/stores/compile-store'
import { buildCompileInputs } from '@/lib/compile-inputs'
import { applyPagePreamble, ensureCompilerReady } from '@/lib/compile-manager'
import { compileToPdf, ensurePackagesForCompile } from '@/lib/compiler'
import { applyPackageImportCompatRewrites } from '@/lib/package-compat'
import { findPreviewImportSpecs } from '@/lib/universe-registry'

export type PdfExportResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; reason: 'empty' | 'error'; message: string }

function collectPackageSpecs(mainSource: string, extraFiles: Array<{ content: string }>): string[] {
  const packageSpecs = new Set<string>(findPreviewImportSpecs(mainSource))
  for (const file of extraFiles) {
    for (const spec of findPreviewImportSpecs(file.content)) {
      packageSpecs.add(spec)
    }
  }
  return [...packageSpecs]
}

function triggerPdfDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Compile the current project to PDF and download it.
 * Shared by toolbar and keybindings so failure UX stays consistent.
 */
export async function exportCurrentProjectPdf(options?: {
  liveSource?: string
  alertOnFailure?: boolean
}): Promise<PdfExportResult> {
  const alertOnFailure = options?.alertOnFailure ?? true

  try {
    await ensureCompilerReady()
    const project = useProjectStore.getState().getCurrentProject()
    const currentFilePath = useProjectStore.getState().currentFilePath
    const liveSource = options?.liveSource ?? useEditorStore.getState().source
    const compileInputs = buildCompileInputs({
      project,
      currentFilePath,
      liveSource,
      // Match preview: package-compat rewrites must apply to PDF too.
      transformText: (_path, content) => (
        content.includes('@preview/')
          ? applyPackageImportCompatRewrites(content)
          : content
      ),
    })

    const packageSpecs = collectPackageSpecs(compileInputs.mainSource, compileInputs.extraFiles)
    if (packageSpecs.length > 0) {
      await ensurePackagesForCompile(packageSpecs)
    }

    const compileResult = await compileToPdf(
      applyPagePreamble(compileInputs.mainSource),
      compileInputs.extraFiles,
      compileInputs.mainPath,
      compileInputs.extraBinaryFiles,
    )

    if (!compileResult.pdf || compileResult.pdf.length === 0) {
      const compileStore = useCompileStore.getState()
      compileStore.setDiagnostics(compileResult.diagnostics)
      compileStore.setStatus('error')
      const result: PdfExportResult = {
        ok: false,
        reason: 'empty',
        message: 'PDF export produced no output. Check the preview for compile errors.',
      }
      if (alertOnFailure) window.alert(result.message)
      return result
    }

    const filename = `${project?.name ?? 'document'}.pdf`
    triggerPdfDownload(compileResult.pdf, filename)
    return { ok: true, bytes: compileResult.pdf, filename }
  } catch (err) {
    console.error('Failed to export PDF:', err)
    const compileStore = useCompileStore.getState()
    compileStore.setDiagnostics([{
      severity: 'error',
      path: '',
      range: '',
      message: err instanceof Error ? err.message : 'Unknown PDF compilation error',
    }])
    compileStore.setStatus('error')
    const result: PdfExportResult = {
      ok: false,
      reason: 'error',
      message: 'Failed to export PDF. Please try again.',
    }
    if (alertOnFailure) window.alert(result.message)
    return result
  }
}
