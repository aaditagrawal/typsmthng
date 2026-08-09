# Performance Baseline

Updated March 9, 2026 from local production output (`dist/`).

## Bundle snapshots

- Initial preloaded JS (from `dist/index.html`): ~379 KB raw (budget 500 KB).
- Dist assets (`js + css + wasm + fonts`): ~3.4 MB raw (Typst WASM dominates).
- Home preload composition (must stay CodeMirror/Typst-free):
  - `react-core-*.js`: ~355 KB raw
  - `project-store-*.js`: ~18 KB raw
  - `index-*.js`: ~7 KB raw
  - `settings-store-*.js` / `ui-store-*.js` / `state-core-*.js`: small
  - `editor-store` may load with the app for sync Cmd+S but must not pull `editor-core`
- Deferred until workspace / import actions:
  - `editor-core-*.js`: ~492 KB raw
  - `latex-converter-*.js`: ~358 KB raw
  - `typst_ts_renderer_bg-*.wasm`: ~973 KB raw
  - `typst_syntax_bg-*.wasm`: ~320 KB raw
  - `workspace-shell-*.js`: ~185 KB raw
  - `home-shell-*.js`: ~135 KB raw (lazy after boot)

Historical note (Feb 27, 2026): initial preloaded JS was ~1417 KB raw before home/workspace splitting; a later regression reintroduced `editor-core` via `vendor → @replit/codemirror-indentation-markers` (~853 KB preload).

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

- `bun run build:budget` fails if home HTML preloads `editor-*` / Typst chunks or exceeds 500 KB.
- Keep `@replit/codemirror*` packages in the `editor-core` (or `editor-vim`) manual chunk so `vendor` never imports CodeMirror.
- Home import/export UI should dynamic-import `@/lib/project-io` so zip/LaTeX code stays off the critical path.
