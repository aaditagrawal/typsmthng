import { createTypstCompiler, loadFonts } from '@myriaddreamin/typst.ts'
import { _resolveAssets } from '../node_modules/@myriaddreamin/typst.ts/dist/esm/options.init.mjs'
const fonts = await Promise.all(_resolveAssets({ assets: ['text'] }).map(async url =>
  new Uint8Array(await (await fetch(url)).arrayBuffer())))
const variants = [
  { name: 'baseline', module: '/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm' },
  { name: 'candidate', module: '/vendor/typst-compiler/compiler_bg.wasm',
    wrapper: () => import('../vendor/typst-compiler/compiler.js') },
]
const sources = [
  { name: 'small', source: '= A document\nHello, *Typst*. $x^2 + y^2 = z^2$' },
  { name: 'large', source: '#set page(height: 280mm)\n' + Array.from({ length: 100 }, (_, i) =>
    `\n== Section ${i}\n${'A paragraph with *bold*, _italic_, and a #link("https://typst.app")[link]. '.repeat(8)}\n`).join('') },
]
const median = values => {
  const s = [...values].sort((a, b) => a - b)
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2
}
export async function run() {
  const reports = []
  for (const variant of variants) {
    const compiler = createTypstCompiler()
    await compiler.init({ getModule: () => ({ module_or_path: variant.module }),
      ...(variant.wrapper ? { getWrapper: variant.wrapper } : {}),
      beforeBuild: [loadFonts(fonts, { assets: false })] })
    const results = []
    for (const fixture of sources) {
      compiler.resetShadow()
      compiler.addSource('/main.typ', fixture.source)
      const compile = () => compiler.compile({ mainFilePath: '/main.typ', root: '/', diagnostics: 'full' })
      if (!(await compile()).result?.length) throw Error('Compile failed')
      const unchanged = [], edits = []
      for (let i = 0; i < 35; i++) {
        const start = performance.now()
        const result = await compile()
        const elapsed = performance.now() - start
        if (!result.result?.length) throw Error('Compile failed')
        if (i >= 5) unchanged.push(elapsed)
      }
      for (let i = 0; i < 35; i++) {
        const start = performance.now()
        compiler.addSource('/main.typ', `${fixture.source}\n\nUnique edit ${i}.`)
        const result = await compile()
        const elapsed = performance.now() - start
        if (!result.result?.length) throw Error('Compile failed')
        if (i >= 5) edits.push(elapsed)
      }
      results.push({ fixture: fixture.name, unchanged_ms: unchanged, edits_ms: edits,
        unchanged_median_ms: median(unchanged), edits_median_ms: median(edits) })
    }
    reports.push({ variant: variant.name, results })
  }
  return { userAgent: navigator.userAgent, samples: 30, warmup: 5, reports,
    scope: 'Browser in-process compiler calls, source upload included for edits; initialization, renderer, worker transport, and network excluded. Single round, baseline first.' }
}
