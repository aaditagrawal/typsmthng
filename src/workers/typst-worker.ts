import { exposeCompilerRpc } from '@/lib/compiler-rpc'
import {
  compileToPdfBackend,
  compileTypstBackend,
  compileTypstIncrementalBackend,
  configureCompilerBackend,
  ensurePackagesForCompileBackend,
  initCompilerBackend,
  isCompilerReadyBackend,
  resolveSourceLocBackend,
  resolveSourceLocBatchBackend,
} from '@/lib/compiler-backend'

const api = {
  initCompiler: async (options?: { fontData?: Uint8Array[] }) => {
    configureCompilerBackend({ fontData: options?.fontData ?? [] })
    await initCompilerBackend()
  },
  compileTypst: compileTypstBackend,
  compileTypstIncremental: compileTypstIncrementalBackend,
  resolveSourceLoc: resolveSourceLocBackend,
  resolveSourceLocBatch: resolveSourceLocBatchBackend,
  compileToPdf: compileToPdfBackend,
  ensurePackagesForCompile: ensurePackagesForCompileBackend,
  isCompilerReady: isCompilerReadyBackend,
}

exposeCompilerRpc(api, self)
