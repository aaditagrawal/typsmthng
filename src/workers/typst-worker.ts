import { expose } from 'comlink'
import {
  compileToPdfBackend,
  compileTypstIncrementalBackend,
  configureCompilerBackend,
  ensurePackagesForCompileBackend,
  initCompilerBackend,
  resolveSourceLocBatchBackend,
} from '@/lib/compiler-backend'

const api = {
  initCompiler: async (options?: { fontData?: Uint8Array[] }) => {
    configureCompilerBackend({ fontData: options?.fontData ?? [] })
    await initCompilerBackend()
  },
  compileTypstIncremental: compileTypstIncrementalBackend,
  resolveSourceLocBatch: resolveSourceLocBatchBackend,
  compileToPdf: compileToPdfBackend,
  ensurePackagesForCompile: ensurePackagesForCompileBackend,
}

expose(api)
