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
  setDiagnostics: (diagnostics: Diagnostic[]) => void
  setSvgResult: (svg: string, vectorData: Uint8Array, pageDimensions: PageDimension[]) => void
  setCompileTime: (ms: number) => void
  setAutoCompile: (auto: boolean) => void
}

export const useCompileStore = create<CompileState>((set) => ({
  status: 'idle',
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
  setDiagnostics: (diagnostics) => set({
    diagnostics,
    errorCount: diagnostics.reduce((count, diag) => count + (diag.severity === 'error' ? 1 : 0), 0),
    warningCount: diagnostics.reduce((count, diag) => count + (diag.severity === 'warning' ? 1 : 0), 0),
  }),
  setSvgResult: (svg, vectorData, pageDimensions) => set({
    svg,
    vectorData,
    pageDimensions,
    totalPages: Math.max(pageDimensions.length, 1),
  }),
  setCompileTime: (compileTime) => set({ compileTime }),
  setAutoCompile: (autoCompile) => set({ autoCompile }),
}))
