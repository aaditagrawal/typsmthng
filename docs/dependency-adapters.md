# Browser adapters

The application owns three small adapters covering the APIs it uses:

| Module | Behavior preserved |
| --- | --- |
| `src/lib/keyval.ts` | Existing database/store names and structured-cloned records. Reads resolve on request success; writes and deletions resolve after transaction commit. Warm operations use the cached database directly. Failed opens can retry; version changes close and clear cached connections. |
| `src/lib/compiler-rpc.ts` | Eight compiler methods, concurrent request IDs, structured-cloned buffers, error names/messages/stacks and rejection of pending calls when the client disposes a worker transport. The client retains its compiler generation, incremental synchronization and fallback policies. |
| `src/lib/store.ts` | Immutable partial/functional updates, synchronous subscriptions, initial server snapshots and React selectors. Shallow selectors compare the plain objects selected by existing components using own keys and `Object.is`, without reflection or per-comparison callbacks. |

The unused `codemirror` umbrella package is removed. Individual CodeMirror packages and the original `vite-plugin-wasm` registration remain; the scoped adapter benchmark does not measure the plugin replacement. Compiler checks still validate emitted WASM against its manifest.

## Validation

Bun 1.4.2 frozen installation, type checking, lint, all 313 tests in 35 files, the production build, compiler manifest/dist checks, bundle budgets and brace security regressions cover this substitution. The emitted compiler remains 24,574,197 bytes. The home static closure must remain within the 500 KB budget.

The lock removes exactly four package versions and adds none. `bun audit` continues to report the existing advisories for `deepmerge`, `glob`, `minimatch` and `serialize-javascript`; their locked versions are unchanged.

## Reproducing the comparison

Use Bun 1.4.2 and the application's frozen lock. Prepare a disposable baseline directory outside the application with this `package.json`, then install it once and preserve its lock for repeat runs:

```json
{"private":true,"packageManager":"bun@1.4.2","dependencies":{"idb-keyval":"6.3.0","comlink":"4.4.2","zustand":"5.0.15"}}
```

Those are the exact versions in starting commit `d00ebdb489ea6dee562d256a331081ff551f5a52`. The harness accepts the baseline's `node_modules` directory and aliases both state implementations to the application's installed React. It uses an external Playwright installation and a Chrome binary for real IndexedDB transactions, workers and React rendering.

On the shared fleet, run baseline installation through the build gate and comparisons through the benchmark gate. Set `FLEET_GATE` to the fleet's `fleet_gate.py` path and use the same project identifier for implementation and review:

```sh
uv run --no-project python "$FLEET_GATE" --project typsmthng--app-compiler-perf benchmark -- \
  bun scripts/bench-owned-adapters.mjs \
  --baseline /path/to/baseline/node_modules \
  --playwright /path/to/playwright/index.mjs \
  --chrome /path/to/chrome --samples 31 --output /path/to/results.json
```

Each workload has three warmups followed by alternating baseline/candidate samples in one browser. Database and worker startup are measured separately. Other cases cover settings, text-only project autosaves that skip unchanged separate binary records, binary payload writes/reads, large/concurrent storage operations, small/large/concurrent worker calls and store updates with 0/4/32 subscribers. React cases check unrelated updates, 32 components selecting five fields, and a 24-field settings selection. Correctness assertions run before timing; no network requests occur during workloads.

JSON output records source hashes, package/runtime versions, raw batch times, medians, p90 and min/max. `--only idb`, `--only rpc` or `--only store` selects a subset. A fleet exit 75 means timings are deferred or contaminated and cannot establish parity. Early runs under host overload are diagnostic only; final acceptance requires completed gated measurements of the recorded source hashes and independent reproduction.

## Measured results

Independent final-source run on November 6, 2026, using Linux x86_64, 12 logical CPUs, Bun 1.4.2 and Chrome 128. Each row is milliseconds per named batch, with three warmups and 31 alternating paired samples against the exact packages from target commit `d00ebdb4`. Both implementations use the same installed React, browser, data and origin. The fleet gate reported no CPU/memory contamination.

| Workload | Baseline median | Candidate median | Baseline p90 | Candidate p90 |
| --- | ---: | ---: | ---: | ---: |
| First database open + write | 0.4 | 0.4 | 0.4 | 0.4 |
| Settings: 30 write/read/delete cycles | 13.2 | 11.9 | 14.0 | 13.3 |
| Text autosave: 30 project writes | 16.4 | 15.8 | 21.3 | 19.1 |
| Binary: 20 write/read cycles, 256 KiB | 29.0 | 29.5 | 34.4 | 35.2 |
| 100 parallel reads + keys | 4.4 | 4.2 | 6.5 | 5.6 |
| 128 concurrent writes | 83.6 | 79.3 | 124.9 | 124.6 |
| New worker + init | 4.0 | 3.6 | 4.6 | 4.0 |
| 100 small worker calls | 2.8 | 2.2 | 3.3 | 2.9 |
| 30 worker round trips, 128 KiB | 9.8 | 9.5 | 12.5 | 12.6 |
| 5 worker round trips, 8 MiB | 90.3 | 90.3 | 94.5 | 92.8 |
| 128 concurrent worker errors | 1.9 | 1.7 | 2.2 | 1.9 |
| 50,000 updates, no subscribers | 2.9 | 2.6 | 3.0 | 2.7 |
| 50,000 updates, 4 subscribers | 4.6 | 3.3 | 4.9 | 3.6 |
| 50,000 updates, 32 subscribers | 14.6 | 8.0 | 14.8 | 8.2 |
| 500 selected/unrelated React updates | 1.6 | 1.2 | 2.7 | 1.9 |
| 32 components selecting 5 fields, 100 updates | 11.7 | 6.6 | 11.8 | 6.8 |
| 1 component selecting 24 fields, 100 updates | 4.3 | 2.3 | 4.6 | 2.6 |

Binary storage is parity, not an improvement: its paired median difference is approximately zero and the candidate wins 15 of 31 pairs. Concurrent-write times rise with database history for both implementations; the aggregate tail is not a steady-state throughput guarantee. First-open timings are quantized near 0.4 ms. Large worker calls are dominated by the unchanged structured cloning and are classified as parity. These adapter measurements do not establish whole-app load time or real document compilation speed.

A separate 31-pair storage-only repeat used the same final source and passed the same correctness probes and exclusive gate:

| Workload | Baseline median | Candidate median | Baseline p90 | Candidate p90 |
| --- | ---: | ---: | ---: | ---: |
| First database open + write | 0.4 | 0.4 | 0.5 | 0.5 |
| Settings: 30 write/read/delete cycles | 13.2 | 12.4 | 14.9 | 14.9 |
| Text autosave: 30 project writes | 15.0 | 15.3 | 19.7 | 18.2 |
| Binary: 20 write/read cycles, 256 KiB | 28.3 | 28.8 | 33.7 | 34.0 |
| 100 parallel reads + keys | 4.5 | 4.5 | 5.8 | 7.4 |
| 128 concurrent writes | 82.1 | 86.6 | 126.4 | 131.2 |

Settings improved in both runs. Autosave, parallel reads and concurrent writes vary between runs and are classified as parity, with no tail improvement claimed. The storage-only repeat had a 0.1 ms paired median difference for binary operations and parallel reads. These measurements support the finite adapter substitution, not a universal latency guarantee.
