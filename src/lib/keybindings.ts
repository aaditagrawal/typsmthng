import type { KeyBinding } from '@codemirror/view'
import { useProjectStore } from '@/stores/project-store'
import { useEditorStore } from '@/stores/editor-store'
import { forceCompile, applyPagePreamble, ensureCompilerReady } from './compile-manager'
import { useUIStore } from '@/stores/ui-store'
import { compileToPdf, ensurePackagesForCompile } from './compiler'
import { findPreviewImportSpecs } from './universe-registry'
import { buildCompileInputs } from './compile-inputs'
import { toggleTypstLineComment } from './commenting'

export const typstKeymap: KeyBinding[] = [
  {
    key: 'Mod-/',
    run: (view) => toggleTypstLineComment(view),
  },
  {
    key: 'Mod-s',
    run: () => {
      const projectStore = useProjectStore.getState()
      const currentPath = projectStore.currentFilePath
      if (currentPath) {
        projectStore.updateFileContent(currentPath, useEditorStore.getState().source)
      }
      projectStore.saveCurrentProject()
      return true
    },
  },
  {
    key: 'Mod-Enter',
    run: (view) => {
      const currentPath = useProjectStore.getState().currentFilePath
      forceCompile(view.state.doc.toString(), currentPath)
      return true
    },
  },
  {
    key: 'Mod-Shift-Enter',
    run: (view) => {
      const project = useProjectStore.getState().getCurrentProject()
      const currentFilePath = useProjectStore.getState().currentFilePath
      const liveSource = view.state.doc.toString()
      const compileInputs = buildCompileInputs({
        project,
        currentFilePath,
        liveSource,
      })

      const source = applyPagePreamble(compileInputs.mainSource)
      const packageSpecs = new Set<string>(findPreviewImportSpecs(compileInputs.mainSource))
      for (const file of compileInputs.extraFiles) {
        for (const spec of findPreviewImportSpecs(file.content)) {
          packageSpecs.add(spec)
        }
      }

      ensureCompilerReady()
        .then(async () => {
          if (packageSpecs.size > 0) {
            await ensurePackagesForCompile([...packageSpecs])
          }
        })
        .then(() => compileToPdf(
          source,
          compileInputs.extraFiles,
          compileInputs.mainPath,
          compileInputs.extraBinaryFiles,
        ))
        .then((pdf) => {
          if (pdf) {
            const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'document.pdf'
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 10000)
          }
        })
        .catch((err) => {
          console.error('Failed to export PDF:', err)
          window.alert('Failed to export PDF. Please try again.')
        })
      return true
    },
  },
  {
    key: 'Mod-j',
    run: () => {
      const { theme, setTheme } = useUIStore.getState()
      const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
      setTheme(next)
      return true
    },
  },
]
