# Performance Baseline

Captured on February 27, 2026 from local production output (`dist/`).

## Bundle snapshots

- Initial preloaded JS (from `dist/index.html`): ~1417 KB raw.
- Dist assets (`js + css + wasm + fonts`): ~3.08 MB raw.
- Top payloads:
  - `typst_ts_renderer_bg-*.wasm`: ~950 KB raw
  - `editor-core-*.js`: ~352 KB raw
  - `react-core-*.js`: ~332 KB raw
  - `typst_syntax_bg-*.wasm`: ~313 KB raw
  - `index-*.js`: ~292 KB raw
  - `latex-converter-*.js`: ~270 KB raw

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
