# Browser adapters

The application owns three small adapters covering the APIs it uses:

| Module | Behavior preserved |
| --- | --- |
| `src/lib/keyval.ts` | Existing database/store names and structured-cloned records. Reads resolve on request success; writes and deletions resolve after transaction commit. Failed opens can retry; version changes close cached connections. |
| `src/lib/compiler-rpc.ts` | Eight compiler methods, concurrent request IDs, structured-cloned buffers, error names/messages/stacks and rejection of pending calls when the client disposes a worker transport. The client retains its compiler generation, incremental synchronization and fallback policies. |
| `src/lib/store.ts` | Immutable partial/functional updates, synchronous subscriptions, initial server snapshots and React selectors. Shallow selectors cover the plain objects selected by existing components. |

The unused `codemirror` umbrella package is removed. Individual CodeMirror packages and the original `vite-plugin-wasm` registration remain; the scoped adapter benchmark does not measure the plugin replacement. Compiler checks still validate emitted WASM against its manifest.

## Validation

Bun 1.4.2 frozen installation, type checking, lint, all 312 tests in 35 files, the production build, compiler manifest/dist checks, bundle budgets and brace security regressions pass. The emitted compiler remains 24,574,197 bytes. The final home static closure is 320 KB across eight files, within the 500 KB budget.

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
  --chrome /path/to/chrome --samples 11 --output /path/to/results.json
```

Each workload has three warmups followed by alternating baseline/candidate samples in one browser. Database and worker startup are measured separately. Other cases cover settings, text-only project autosaves that skip unchanged separate binary records, binary payload writes/reads, large/concurrent storage operations, small/large/concurrent worker calls and store updates with 0/4/32 subscribers. React cases check unrelated updates, 32 components selecting five fields, and a 24-field settings selection. Correctness assertions run before timing; no network requests occur during workloads.

JSON output records source hashes, package/runtime versions, raw batch times, medians, p90 and min/max. `--only idb`, `--only rpc` or `--only store` selects a subset. A fleet exit 75 means timings are deferred or contaminated and cannot establish parity. Early runs under host overload are diagnostic only; final acceptance requires completed gated measurements of the recorded source hashes and independent reproduction.
