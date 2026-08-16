import {
  compileToPdfClient,
  compileTypstClient,
  ensurePackagesForCompileClient,
  initCompilerClient,
  isCompilerReadyClient,
  resolveSourceLocBatchClient,
  resolveSourceLocClient,
} from './compiler-client'
export type { CompileResult, PdfCompileResult, PageDimension, CompileTimings } from './compiler-backend'

export const initCompiler = initCompilerClient
export const compileTypst = compileTypstClient
export const resolveSourceLoc = resolveSourceLocClient
export const resolveSourceLocBatch = resolveSourceLocBatchClient
export const compileToPdf = compileToPdfClient
export const ensurePackagesForCompile = ensurePackagesForCompileClient
export const isCompilerReady = isCompilerReadyClient
