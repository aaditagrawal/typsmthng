/// <reference lib="webworker" />

import { exposeCompilerWorker } from '@/lib/compiler-rpc'
import {
  compileToPdfBackend,
  compileTypstIncrementalBackend,
  configureCompilerBackend,
  ensurePackagesForCompileBackend,
  initCompilerBackend,
  resolveSourceLocBatchBackend,
} from '@/lib/compiler-backend'

declare const self: DedicatedWorkerGlobalScope

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

exposeCompilerWorker(api, self)
