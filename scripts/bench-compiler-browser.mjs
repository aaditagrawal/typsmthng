import { createTypstCompiler, loadFonts } from '@myriaddreamin/typst.ts'
import { _resolveAssets } from '../node_modules/@myriaddreamin/typst.ts/dist/esm/options.init.mjs'
const fonts = await Promise.all(_resolveAssets({ assets: ['text'] }).map(async url =>
  new Uint8Array(await (await fetch(url)).arrayBuffer())))
const defaultVariants = [
  { name: 'baseline', module: '/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm' },
  { name: 'candidate', module: '/vendor/typst-compiler/compiler_bg.wasm',
    wrapper: () => import('../vendor/typst-compiler/compiler.js') },
]
const sources = [
  { name: 'small', source: '= A document\nHello, *Typst*. $x^2 + y^2 = z^2$' },
  { name: 'large', source: '#set page(height: 280mm)\n' + Array.from({ length: 100 }, (_, i) =>
    `\n== Section ${i}\n${'A paragraph with *bold*, _italic_, and a #link("https://typst.app")[link]. '.repeat(8)}\n`).join('') },
  { name: 'math-table', source: '= Equations\n$ integral_0^1 x^2 dif x = 1/3 $\n$ mat(1, 2; 3, 4) $\n#table(columns: 3, [Name], [Value], [Result], [Alpha], [$sqrt(2)$], [Yes])' },
]
const median = values => {
  const s = [...values].sort((a, b) => a - b)
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2
}
export async function run({ variants = defaultVariants, samples = 30, editLocation = 'append' } = {}) {
  if (!Number.isInteger(samples) || samples <= 0 || !['append', 'middle'].includes(editLocation)) throw Error('Invalid benchmark options')
  const reports = []
  for (const variant of variants) {
    const compiler = createTypstCompiler()
    const bytes = new Uint8Array(await (await fetch(variant.module)).arrayBuffer())
    await compiler.init({ getModule: () => ({ module_or_path: bytes }),
      ...(variant.wrapper ? { getWrapper: variant.wrapper } : {}),
      beforeBuild: [loadFonts(fonts, { assets: false })] })
    const results = []
    for (const fixture of sources) {
      compiler.resetShadow()
      compiler.addSource('/main.typ', fixture.source)
      const compile = () => compiler.compile({ mainFilePath: '/main.typ', root: '/', diagnostics: 'full' })
      if (!(await compile()).result?.length) throw Error('Compile failed')
      const unchanged = [], edits = []
      for (let i = 0; i < samples + 5; i++) {
        const start = performance.now()
        const result = await compile()
        const elapsed = performance.now() - start
        if (!result.result?.length) throw Error('Compile failed')
        if (i >= 5) unchanged.push(elapsed)
      }
      const newline = fixture.source.indexOf('\n', Math.floor(fixture.source.length / 2))
      const offset = editLocation === 'append' || newline < 0 ? fixture.source.length : newline + 1
      for (let i = 0; i < samples + 5; i++) {
        const start = performance.now()
        compiler.addSource('/main.typ', `${fixture.source.slice(0, offset)}\n\nUnique edit ${i}.\n${fixture.source.slice(offset)}`)
        const result = await compile()
        const elapsed = performance.now() - start
        if (!result.result?.length) throw Error('Compile failed')
        if (i >= 5) edits.push(elapsed)
      }
      results.push({ fixture: fixture.name, unchanged_ms: unchanged, edits_ms: edits,
        unchanged_median_ms: median(unchanged), edits_median_ms: median(edits) })
    }
    reports.push({ variant: variant.name, module: variant.module, wasm_bytes: bytes.length, results })
  }
  return { userAgent: navigator.userAgent, samples, warmup: 5, edit_location: editLocation, reports,
    scope: 'Browser in-process compiler calls, source upload included for edits; initialization, renderer, worker transport, and network excluded. Variants run sequentially in report order.' }
}
