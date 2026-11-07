# App performance investigation — November 6, 2026

## Outcome

Targeted improvements are implemented, but **fivefold improvement in every
median is not achieved**. Bulk file updates and some content searches exceed
that target. Project loading improves substantially. Compilation and PDF export
remain engine-bound and approximately unchanged; small-document compilation
was 0.1 ms slower in the controlled comparison. No app-wide 5× claim is warranted.

Baseline: checkout [716e12e](https://github.com/aaditagrawal/typsmthng/commit/716e12e0e5adf741c1d3565b20b006e9b4abf156), unchanged application
code. Candidate: this working tree. Existing compiler WASM, language version,
formatting behavior, document contents, and editor features are retained.

## What changed and why

- **Worker transport:** replace Comlink with a compiler-specific five-method
  request/response protocol. Transfer owned vector/PDF result buffers instead
  of cloning them. Never transfer project assets, fonts, or preview inputs,
  since callers retain those buffers. Preserve application-error propagation,
  worker failure fallback, generation invalidation, and incremental resync.
  Pending requests and listeners are cleaned up when the worker is disposed.
  The production worker shrinks from 62,344 to 58,661 bytes. The small fixtures
  do not establish an end-to-end compilation speedup from this replacement.
- **Search:** custom lazy lowercase indexing and native substring search replace
  full-document line splitting and per-line lowercasing on every query. The
  initial whole-line prefix is approximately 8 KB, so early capped results do
  not index the rest of a large document. Sparse searches complete the index.
  Cache entries are weakly keyed by file object and replaced when the stored
  or live source changes. The cost is up to one cached lowercase copy of each
  searched file. Line ordering, one hit per line, previews, Unicode column
  semantics, and result limits are retained.
- **Bulk file ingestion:** build a path-to-index map once per batch rather than
  scanning the growing file array for every insertion. This changes quadratic
  lookup work to linear indexing and lookup, for both text and binary batches.
  Existing duplicate-entry deduplication and binary equality checks remain.
- **Project loading:** the application already loads every project and asset
  on home. Read that snapshot with idb-keyval's native `getAll`/`getAllKeys`
  fast path instead of individual per-project and sequential per-asset reads.
  Reassemble split binary records in memory, preserving legacy inline records,
  missing-payload handling, metadata, and recovery-journal behavior. This can
  also read orphaned binary records, which are ignored; no storage schema changes.
- **Home loading:** isolate resizable panels and the Typstyle wrapper from the
  catch-all vendor chunk. The baseline vendor chunk imported CodeMirror, pulling
  the editor into the home static graph despite the workspace's lazy import.
  The production budget check now passes and also blocks the new formatter
  chunk from the home graph.

## Controlled browser measurements

Chromium 157, Linux x86_64 in an orb, five warmups and 31 samples per median.
Candidate ran before baseline in this controlled pair; no tests/builds ran
alongside it. Both used an otherwise blank Vite HTML page, not the mounted UI.
Source modules, the real compiler worker, and real IndexedDB were used.
Setup and output validation were outside the timer. Query strings varied
between calls. Cold search uses a fresh file object; warm search reuses it.

Search fixture: 50,000 lines, approximately 2.7 MB of ASCII text, early matches
limited to 80 results and a sparse match at line 40,001. Storage fixture:
20 projects with 400 total 4 KB binary assets. File batch: 2,500 entries,
half updating existing files and half adding files. Compiler fixtures:
a short math document and a 100-section formatted document with unique edits.

| Operation | Before median | After median | Before / after |
| --- | ---: | ---: | ---: |
| Early-hit search, warm | 1.40 ms | 0.10 ms | ~14× |
| Early-hit search, cold | 1.40 ms | 0.10 ms | ~14× |
| Sparse search, warm | 5.00 ms | 1.00 ms | 5.00× |
| Sparse search, cold | 5.10 ms | 3.10 ms | 1.65× |
| No-match search, warm | 5.80 ms | 1.30 ms | 4.46× |
| No-match search, cold | 5.80 ms | 3.40 ms | 1.71× |
| Batch upsert, 2,500 text files | 57.50 ms | 0.90 ms | 63.89× |
| Load 20 projects / 400 assets | 107.60 ms | 25.90 ms | 4.15× |
| Small-document edit compile | 0.70 ms | 0.80 ms | 0.88× |
| Small-document PDF | 1.10 ms | 1.10 ms | 1.00× |
| Long-document edit compile | 40.10 ms | 37.90 ms | 1.06× |
| Long-document PDF | 32.50 ms | 29.70 ms | 1.09× |

Raw samples: [baseline](benchmarks/app-2026-11-06/baseline-round2.json),
[candidate](benchmarks/app-2026-11-06/candidate-final-round2.json).
Sub-millisecond ratios are approximate because the browser clock advances in
roughly 0.1 ms increments. Single first-compile observations are in the raw
files but are not startup medians. Exploratory runs overlapped checks and are
excluded; they exposed a cold early-search regression, corrected by prefix
indexing before the controlled comparison.

A separate [five-call stage sample](benchmarks/app-2026-11-06/engine-stages.json)
after five warmups measured long-document engine compilation at 39–42 ms,
renderer work at 0.5–0.9 ms, and client calls at 40.4–51.3 ms. That sample
supports prioritizing engine work over further transport micro-optimizations;
it is not an additional baseline/candidate speedup comparison.

Production build: initial HTML preload remains 248 KiB; the transitive static
JS closure falls from **664 to 281 KiB** (~58% smaller). This is raw
code size, not a page-load timing result. PWA precaching remains enabled for
offline features, so splitting chunks does not eliminate installation downloads.
Compiler WASM remains 24,574,197 bytes.

## Dependency decisions

| Dependency / avenue | Decision |
| --- | --- |
| Comlink | Replaced with the narrow compiler protocol described above. |
| idb-keyval | Retained: tiny wrapper; use its existing bulk native API rather than maintaining a second IndexedDB implementation. |
| unified-latex parser | Retained: lazy import, only used during conversion. The emitter relies on argument attachment, math reparsing, list/bibliography normalization, and verbatim handling. A regex/brace parser or `parseMinimal` is not compatible. Existing tests alone would not establish replacement safety. |
| fflate | Retained: ZIP containers are not provided by CompressionStream. Its UTF-8 helpers already use native encoder/decoder fast paths. |
| React / Zustand | Retained: dependency removal alone provides no demonstrated 5× benefit; framework replacement would require rewriting application behavior. |
| CodeMirror / Vim / Typstyle | Retained: editor, undo, language, navigation, Vim and formatter semantics are substantial. Correctly defer their chunks rather than implementing incomplete substitutes. |
| Resizable panels | Retained but deferred: preserve pointer, keyboard and accessibility behavior. |
| Lucide | Retained: named icon imports; no measured icon bottleneck. |
| Typst compiler / renderer | Retained: already locally built and optimized; engine work dominates long compiles. See compiler-performance.md for prior candidates and rejected regressions. |
| Build-time plugins / fonts | No runtime rewrite justified. StyleX already produces CSS at build time; deleting build dependencies is not a runtime speedup. |

Further work should profile engine layout/export and canvas paint separately,
then establish representative project and device budgets. Package/font network
latency, page-load vitals, typing-to-paint, scroll smoothness, memory medians,
mobile devices, and other browsers are not measured by this harness. Lowering
intentional typing/debounce delays merely to improve a number would change
the editor's responsiveness tradeoff rather than speed up its computation.

## Verification and rerunning

- `bun run test`: 40 files, 327 tests passed.
- `bun run build:budget`: compiler size verified and home closure budget passed.
- `bun run lint`: zero errors; eight existing warnings in unrelated code.
- 6,000 temporary differential Unicode search comparisons matched the unchanged
  implementation, including expanded lowercase characters and sparse prefixes.
- Real message-port tests cover buffer ownership, concurrent out-of-order
  responses, errors, repeated calls and disposal. Existing worker fallback,
  project recovery, split-asset, import/export, and compiler tests still pass.
- Production-browser smoke: home mounted without editor/worker/formatter/panel
  resources in its window resource entries; opening the default document produced
  a nonblank 1,191 × 1,684 preview canvas and compiler-ready status. Editing,
  an invalid `#let x =` diagnostic, correction, saving, reload, and content-search
  navigation to line 3 / column 12 succeeded. No browser errors were logged.

To rerun, start the Vite dev server and open `/scripts/bench-app.html` in a
**disposable browser profile**. Execute this in that page's console:

```js
await (await import('/scripts/bench-app-browser.mjs')).run({ allowStorageReset: true })
```

The explicit flag is required because the benchmark erases local projects and
recovery data. For an unchanged baseline, copy the same harness HTML and script
into a separate baseline checkout, install its locked dependencies, and run it
on a separate origin. Run variants sequentially without builds/tests in parallel,
capture the returned JSON, and reverse variant order on subsequent comparisons.
