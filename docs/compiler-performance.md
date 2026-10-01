# Compiler performance, October 1, 2026

The shipped compiler is **24,574,197 bytes**, down from 28,377,376 bytes, a
13.40% reduction. The compiler, bindings, declarations, and license total
24,661,402 bytes. The build rejects either size at 25,000,000 bytes or above.
The budget measures uncompressed files, not runtime memory.

A second hillclimb adds a bounded glyph-outline cache. Compared with the first
24.57 MB build, small-document edits improve 38–47% and math/table edits improve
52–53% in two Linux runs. Chromium also shows faster small and math edits.
Long-document edits remain approximately unchanged. Details and raw samples
are below.

The app now loads its compiler from a Vite asset on the same origin. It retains
the existing vector preview, renderer, PDF exporter, file and package callbacks,
and worker transport. Compiler and renderer initialization run concurrently.
The service worker caches the compiler after its first use instead of including
it in the home precache. The verified home preload remains 334 KB.

The source is the pinned [typst.ts 0.7.0-rc2 release](https://github.com/Myriad-Dreamin/typst.ts/tree/af2047eb986155ca5171a2370db359e5f4aa1404),
with all original `web,misc` features and one checked-in source patch.
Its Typst dependency remains 0.14.2.
This change does not substitute typrst's engine or upgrade the language version.
The local typrst project's strict raw-size checks and persistent compiler
benchmarks informed the build and comparison process. Its font compression
does not apply here because this app already loads fonts separately.

## Build candidates

All sizes below are measured WASM bytes. Rust source builds use 1.98.1,
fat LTO, one codegen unit, and panic abort. Binaryen is version 133.

| Candidate | Bytes | Decision |
| --- | ---: | --- |
| Published compiler | 28,377,376 | Baseline, too large |
| Published compiler with `-Oz` | 27,528,797 | Too large |
| Repeated `-Oz` to convergence | 27,517,063 | Too large |
| Rust level 3, fat LTO | 26,886,239 | Too large |
| Rust level 3, Binaryen `-O3` | 25,309,425 | Too large |
| Rust level 3, Binaryen `-Os` | 25,202,570 | Too large |
| Rust level 3, global flow analysis and `-O3` | 25,298,991 | Too large |
| Rust level 3, Binaryen `-Oz` | 24,567,390 | First hillclimb winner |
| Same build, bounded glyph-outline cache | 24,574,197 | Shipped |
| Rust level `s`, no Binaryen | 23,578,772 | Slower editing |
| Rust level `s`, Binaryen `-O3` | 22,057,220 | Slower editing |
| Level 3, omit AST/semantic token features, `-O3` | 25,253,574 | Too large; retain full feature set |

The 22.06 MB candidate regressed the long-document edit median by 15%. The
23.58 MB candidate regressed it by 25%. The shipped build leaves 425,803 bytes
of WASM headroom and 338,598 bytes for the complete compiler package.

Explicitly freeing each temporary world through `runWithWorld` reduced the
observed WASM memory high-water mark from 250.94 MB to 218.43 MB, but slowed
the long-document edit median from 33.21 ms to 35.37 ms in that round. The app
keeps the existing compile API. These memory figures include the benchmark's
documents, fonts, and retained caches; they are not an idle-app measurement.

## First hillclimb timings

Two Bun 1.4.0 runs on Linux x86_64 each measured 30 calls after five warmups.
Each variant ran in a fresh process, sequentially, without build jobs running.
Round one ran the baseline first; round two ran the selected build before the
baseline. The long fixture contains 100 sections with formatted paragraphs
and links. Edits append unique text and include source upload in the timing.
Rendering, network, worker transport, and output writes are excluded.

| Long-document operation | Baseline | Selected | Reduction |
| --- | ---: | ---: | ---: |
| Round 1, unchanged | 19.33 ms | 18.11 ms | 6.3% |
| Round 1, edit | 35.80 ms | 34.21 ms | 4.4% |
| Round 2, unchanged | 20.25 ms | 18.07 ms | 10.8% |
| Round 2, edit | 35.86 ms | 33.21 ms | 7.4% |
| Final artifact, unchanged | 19.14 ms | 17.71 ms | 7.5% |
| Final artifact, edit | 36.98 ms | 35.92 ms | 2.9% |

Small-document edits regressed by 5–16%, an absolute difference of 0.04–0.13 ms.
Math, imports, images, and bibliography generally changed by small amounts;
bibliography edits improved 4.5% in round one and regressed 4.1% in round two.
The retained raw samples include these results and p95 values. A final pass
measured the exact checked-in WASM and matched bindings, with the candidate
before the baseline. Small edits improved 2.5% in that pass. Long-document edits
improved 2.9%, showing the variation across runs. This is a modest long-document
improvement, not a claim that every workload is faster.

A separate Chromium 152 browser run on the shared T3 preview measured 30 calls
after five warmups. The baseline ran first. Long-document unchanged calls fell
from 13.80 ms to 11.60 ms, and edits from 23.80 ms to 22.05 ms. Small-document
edits were approximately 0.40 ms for both. This single browser run measures
compiler calls, not end-to-end keystroke latency. Browser startup, rendering,
and worker transport are excluded.

Module initialization and first-compile observations appear in the reports,
but single observations are insufficient to establish a startup speedup.

## Second hillclimb: glyph outlines

The vector exporter rebuilt the same SVG outline strings from font curves on
every compilation. The source patch caches that pure extraction by the complete
immutable `Font` value and glyph ID. It does not cache documents, layout,
source paths, diagnostics, or package contents. Custom glyph providers retain
their original behavior.

The cache holds at most 2,048 entries, 32 fonts, and 2 MiB of outline text. Font
data and map overhead are additional runtime memory. It clears before an
insertion would exceed a limit; oversized individual outlines bypass it.
This keeps retention bounded even when the host never evicts Typst's memoization
cache. Font names alone are insufficient keys because different font files can
share a family name. A mutex protects native concurrent exporters as well as
the single-threaded web compiler.

The patch adds 6,807 WASM bytes. An earlier experiment that skipped repeated
glyph-map writes did not improve long-document edits and was rejected. Global
outline memoization improved small cases, but the shipped cache adds explicit
retention limits.

The exact shipped module was compared against the first hillclimb's checked-in
module in two fresh-process Linux runs, with 60 samples after five warmups.
Round one ran the previous build first; round two reversed the order. Edits
insert unique text near the middle of each document, after a line boundary.
The fixture set also adds regular, bold, italic, Greek, Cyrillic, and accented
text across three font families. Rendering and artifact checks remain outside
the timing.

| Edit workload | Previous, round 1 | Cached, round 1 | Previous, round 2 | Cached, round 2 |
| --- | ---: | ---: | ---: | ---: |
| Small document | 0.755 ms | 0.468 ms | 0.778 ms | 0.410 ms |
| Math/table | 0.855 ms | 0.398 ms | 0.831 ms | 0.397 ms |
| Imports | 0.440 ms | 0.189 ms | 0.426 ms | 0.187 ms |
| Image with added text | 0.263 ms | 0.151 ms | 0.257 ms | 0.153 ms |
| Bibliography | 0.952 ms | 0.511 ms | 0.943 ms | 0.507 ms |
| Multiple fonts | 1.184 ms | 0.477 ms | 1.083 ms | 0.484 ms |
| Long document | 35.079 ms | 34.742 ms | 33.537 ms | 33.764 ms |

Small and math/table edits improve 38–47% and 52–53%, respectively. Imports,
bibliography, and multiple-font edits also improve. Long-document edits change
by less than 1% in either direction. The unchanged image-only fixture remains
in the tens of microseconds and varies across runs. Startup and first-compile
observations do not establish an improvement.

Two Chromium 152 runs used 40 samples after five warmups and reversed variant
order after reloading the page. Small edit medians went from 0.40 to 0.20 ms
and from 0.30 to 0.10 ms. Math/table edits went from 0.40 to 0.20 ms in both
runs. The browser clock resolves to roughly 0.10 ms, so these ratios are coarse.
Long edits changed from 22.50 to 23.25 ms in round one and from 22.25 to 21.70 ms
in round two. These results support faster small edits, not another consistent
long-document speedup or a claim about end-to-end typing latency.

All seven fixture PDFs, normalized previews, page dimensions, diagnostics, and
each edited preview match the previous module. A separate test exports 3,049
distinct mapped characters to exercise cache eviction, then verifies that an
earlier preview remains identical. It also replaces a font with a modified
outline while preserving its family name and glyph IDs. The preview changes
as expected and returns to its original hash when the original font is restored.
All six resulting preview hashes match the previous compiler. Existing package,
file, binary-image, and input invalidation checks still match their baselines.

The exact binary passed the 295 app tests, lint, TypeScript, the production
build, both byte limits, emitted-asset hash checks, and home bundle checks.
The shared browser compiled through a real Comlink worker with no worker errors,
exported a PDF, and rendered an SVG through the main-thread backend.

Raw second-round reports have `cache-` filenames in the benchmark directory.
The source patch and its SHA-256 are tracked and verified by normal app builds.

## Correctness and app checks

The initial six-fixture suite covers text, long documents, math/tables, imports, SVG
images, and bibliography. For every selected-build comparison, PDFs were
byte-identical to the baseline. Normalized SVGs, page dimensions, diagnostics,
and every edited preview matched. SVG normalization renames opaque IDs while
preserving geometry, text, and reference relationships. Rust's hash seed changes
those IDs, so raw vectors and SVG bytes are not used as cross-build equality
checks. Each timed call must return a compiled result. Edited previews are
compared outside their timed regions.

Separate real-WASM checks exercise a mounted package, imported file edits,
dependency removal and recovery, binary image edits, and changed `sys.inputs`.
All eight resulting PDF hashes and the missing-file diagnostics match exactly.
The app retains source mapping support; this suite does not exhaustively test
every source navigation target or Typst program.

The app passed 295 tests, TypeScript, ESLint, the production build, compiler
size/hash checks, and home bundle budget checks. The emitted compiler matches
the vendor hash and stays out of the generated service worker's precache.
The shared browser also compiled through both the main-thread backend and
the real Comlink worker, produced vector/SVG previews, and exported a PDF.
Offline cache wiring was checked in the generated service worker; offline
operation was not exercised over the HTTP Tailscale preview.

## Reproduce

Ordinary app builds use the checked-in compiler and need no Rust tools:

```sh
bun install --frozen-lockfile
bun run build:budget
bun run compiler:fonts
bun run compiler:test
bun run compiler:test:cache
bun run compiler:bench --module node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm --fonts .compiler-perf/fonts --out .compiler-perf/baseline --samples 30
bun run compiler:bench --module vendor/typst-compiler/compiler_bg.wasm --wrapper vendor/typst-compiler/compiler.js --fonts .compiler-perf/fonts --out .compiler-perf/candidate --samples 30
bun scripts/compare-compiler.mjs .compiler-perf/baseline/report.json .compiler-perf/candidate/report.json
```

For middle-document edits, add `--edit-location middle` to both benchmark
commands. Use the same sample count and edit location on both sides. The cache
test uses `uv` and pinned FontTools 4.66.1 to prepare its synthetic font input;
ordinary builds and compiler benchmarks do not require Python.

The font preparation command downloads the same 17 upstream font files used
by the app and verifies their hashes against the saved baseline. Timings use
those local files. The document clock is fixed for PDF comparisons.

For the browser benchmark, start Vite and run in the browser console:

```js
const benchmark = await import('/scripts/bench-compiler-browser.mjs')
await benchmark.run()
```

To rebuild the vendor pair, install Rust 1.98.1 with the WASM target,
`wasm-bindgen-cli` 0.2.106, and [Binaryen 133](https://github.com/WebAssembly/binaryen/releases/tag/version_133):

```sh
rustup toolchain install 1.98.1 --profile minimal --target wasm32-unknown-unknown
cargo +1.98.1 install wasm-bindgen-cli --version 0.2.106 --locked
COMPILER_RUST_TOOLCHAIN=1.98.1 bun run compiler:build
```

`WASM_BINDGEN` and `WASM_OPT` can point to specific executable paths. The
script verifies tool versions, source commit, a clean compiler checkout, and
the locked dependency graph. It applies the checked-in patches and restores
them after compilation, including when Cargo fails. It clones into ignored `.compiler-perf`, builds
the complete feature set, creates matched bindings, optimizes the module,
enforces both byte budgets, and records hashes. A repeat build produced the
same size but changed the hash because wasm-bindgen reordered three imports.
Rebuilds therefore need new hash checks and correctness comparisons. The
shipped module hash is
`8e4b52bb66f7330cfc14a7f4eaf640e355c2bb8f210763fc2c9f9f7bb8f1661b`.

Raw reports are in [benchmarks/compiler-2026-10-01](benchmarks/compiler-2026-10-01).
The build details are in [the vendor manifest](../vendor/typst-compiler/manifest.json).
