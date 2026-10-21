# Local dependency patches

## braces 3.0.3

GHSA-vfj7-8cjw-p6xm has no published fixed release as of 2026-10-21.
The upstream parser builds arbitrarily deep trees within its existing input
length limit. Recursive compile, expand, stringify, append and flatten walkers
can exhaust the JavaScript call stack. This local patch uses suspended generator
visits and an explicit heap stack, preserving valid patterns without adding a
nesting limit. The original license and package version are unchanged.

Install with `bun install --frozen-lockfile`. Bun applies the committed patch
and verifies its lockfile hash. Run `bun run test:security` with Node to check
ordinary expansion semantics and six deep-tree cases using a constrained V8
stack. Against an unpatched package the deep-tree test fails.

The candidate passed 764 upstream 3.0.3 tests and 3,840 deterministic old/new
comparisons before integration. This addresses recursive stack exhaustion, not
unbounded combinatorial expansion or every possible resource-exhaustion input.

Bun audit still reports the advisory because it matches version 3.0.3. No
advisories are suppressed. Remove this patch only after upgrading to an upstream
fix and rerunning the regressions.

Sources: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
and https://github.com/micromatch/braces/issues/70
