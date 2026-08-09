# Performance Baseline

Updated August 9, 2026 from local production output (`dist/`).

## Bundle snapshots

- Initial HTML preloaded JS: ~327 KB raw (budget 500 KB).
- Home **static import closure** (preload + transitive static deps): ~415 KB raw.
  - Must stay free of `typst-engine`, `editor-core`, `editor-vim`, `latex-*`, `workspace-*`, and `project-io`.
  - `vendor-*` on this path must not contain `createTypstCompiler` / `@myriaddreamin`.
- Dist assets (`js + css + wasm + fonts`): ~3.4 MB raw (Typst WASM dominates).
- Home preload composition:
  - `react-core-*.js`: ~297 KB raw
  - `project-store-*.js`: ~20 KB raw
  - `index-*.js`: ~6 KB raw
  - `settings-store-*.js` / `ui-store-*.js` / `state-core-*.js` / `rolldown-runtime*`: small
  - `editor-store` may load with the app for sync Cmd+S but must not pull `editor-core`
- Deferred until workspace / import actions:
  - `editor-core-*.js`: ~492 KB raw
  - `editor-vim-*.js`: ~198 KB raw (loaded only when vim mode is enabled)
  - `typst-engine-*.js`: ~154 KB raw (Typst.js runtime; must not sit in catch-all `vendor`)
  - `latex-converter-*.js`: ~358 KB raw
  - `typst_ts_renderer_bg-*.wasm`: ~973 KB raw
  - `typst_syntax_bg-*.wasm`: ~320 KB raw
  - `workspace-shell-*.js`: ~185 KB raw
  - `home-shell-*.js`: ~135 KB raw (lazy after boot)

Historical notes:
- Feb 27, 2026: initial preloaded JS was ~1417 KB raw before home/workspace splitting.
- Later regression: `vendor → @replit/codemirror-indentation-markers` pulled `editor-core` (~853 KB preload).
- Aug 9, 2026: Typst.js was still riding catch-all `vendor` onto the home static path (~190 KB + `__tla` boot block); split into `typst-engine` and keep Vite's preload helper out of that chunk.

## Compile-path baseline notes

Compile latency varies by project size and package imports. Initial local instrumentation target points:

- compile input build
- package resolution
- compile engine stage
- render stage
- total compile request

Set `localStorage.perf_debug = '1'` to emit timing samples in the console.

## Preview mapping baseline notes

Preview click-to-source mapping currently traverses renderer/text candidates and can grow with SVG complexity.
Timing sample emitted as `preview.click-map` when perf debug mode is enabled.

## Guardrails

- `bun run build:budget` walks the home **static import closure** (not only HTML preload tags) and fails if deferred chunks or Typst-in-vendor appear.
- Keep `@myriaddreamin/*` / typst packages in `typst-engine`, never catch-all `vendor`.
- Keep Vite `preload-helper` out of `typst-engine` so `project-store` dynamic/static edges cannot wait on Typst `__tla`.
- Keep `@replit/codemirror*` packages in `editor-core` (or lazy `editor-vim`) so `vendor` never imports CodeMirror.
- Home import/export UI should dynamic-import `@/lib/project-io` so zip/LaTeX code stays off the critical path.
- Keep global Cmd+S synchronous (no dynamic `import()` before persist); do not also bind Mod-s in the CodeMirror keymap.
