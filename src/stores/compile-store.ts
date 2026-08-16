import { create } from 'zustand'
import type { PageDimension } from '@/lib/compiler'

export type CompileStatus = 'idle' | 'compiling' | 'success' | 'error'

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  path: string
  range: string
  message: string
  package?: string
}

interface CompileState {
  status: CompileStatus
  compilerReady: boolean
  /** Bumped whenever the compiler worker/config is torn down; invalidates per-worker caches. */
  compilerGeneration: number
  diagnostics: Diagnostic[]
  svg: string | null
  vectorData: Uint8Array | null
  pageDimensions: PageDimension[]
  totalPages: number
  errorCount: number
  warningCount: number
  compileTime: number
  autoCompile: boolean
  setStatus: (status: CompileStatus) => void
  setCompilerReady: (ready: boolean) => void
  bumpCompilerGeneration: () => void
  setDiagnostics: (diagnostics: Diagnostic[]) => void
  setSvgResult: (svg: string | null, vectorData: Uint8Array, pageDimensions: PageDimension[]) => void
  clearPreview: () => void
  setCompileTime: (ms: number) => void
  setAutoCompile: (auto: boolean) => void
}

export const useCompileStore = create<CompileState>((set) => ({
  status: 'idle',
  compilerReady: false,
  compilerGeneration: 0,
  diagnostics: [],
  svg: null,
  vectorData: null,
  pageDimensions: [],
  totalPages: 0,
  errorCount: 0,
  warningCount: 0,
  compileTime: 0,
  autoCompile: true,
  setStatus: (status) => set({ status }),
  setCompilerReady: (compilerReady) => set({ compilerReady }),
  bumpCompilerGeneration: () => set((state) => ({ compilerGeneration: state.compilerGeneration + 1 })),
  setDiagnostics: (diagnostics) => set((state) => {
    // Keep the previous reference on empty -> empty so downstream effects can skip work.
    if (diagnostics.length === 0 && state.diagnostics.length === 0) return state
    return {
      diagnostics,
      errorCount: diagnostics.reduce((count, diag) => count + (diag.severity === 'error' ? 1 : 0), 0),
      warningCount: diagnostics.reduce((count, diag) => count + (diag.severity === 'warning' ? 1 : 0), 0),
    }
  }),
  setSvgResult: (svg, vectorData, pageDimensions) => set({
    svg,
    vectorData,
    pageDimensions,
    totalPages: Math.max(pageDimensions.length, 1),
  }),
  clearPreview: () => set({
    svg: null,
    vectorData: null,
    pageDimensions: [],
    totalPages: 0,
    diagnostics: [],
    errorCount: 0,
    warningCount: 0,
    compileTime: 0,
    status: 'idle',
  }),
  setCompileTime: (compileTime) => set({ compileTime }),
  setAutoCompile: (autoCompile) => set({ autoCompile }),
}))
