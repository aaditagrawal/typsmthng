# Local dependency patches

## braces 3.0.3

GHSA-vfj7-8cjw-p6xm has no published fixed release as of 2026-10-21.
The upstream parser builds arbitrarily deep trees within its existing input
length limit. Recursive compile, expand, stringify, append and flatten walkers
can exhaust the JavaScript call stack. This local patch uses suspended generator
visits and an explicit heap stack, preserving valid patterns without adding a
nesting limit. The original license and package version are unchanged.

Install with `bun install --frozen-lockfile`. Bun applies the committed patch
using the patch path recorded in its lockfile. Run `bun run test:security` with Node to check
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

## Linear recovery of unfinished blocks

The 3.0.3 parser previously spliced each unfinished block's descendants into
all its ancestors. Existing parent/prev references kept the copied arrays alive,
so 9,000 unmatched opens exhausted a 256 MiB Node heap before the 10,000-character
input limit. Recovery now visits unfinished blocks once and emits one root list.
It preserves that limit, valid AST reference graphs, recovered root node order,
node flags and parent/prev references, and compile/stringify/expand results.
For malformed ASTs only, discarded unfinished blocks reached through parent/prev
retain their original direct child arrays rather than copied descendant arrays.
Consumers should traverse the recovered root's nodes to inspect the recovery.
This explicit change avoids retaining quadratic data via those historical links.

The shared candidate passed all 764 upstream tests, 168,672 old/baseline/new
entrypoint comparisons, 28,112 recovered AST comparisons excluding parent/prev,
and 12,796 exact valid AST graph comparisons. Constrained Node processes cover
unmatched opens/closes, mixed and balanced nesting, string and parsed-AST
entrypoints, the existing maximum input length and post-GC retention. The local
security command includes bounded-heap recovery regressions. Arbitrary expansion
can still require combinatorial output; this patch adds no expansion/depth limit
and does not claim to bound every possible resource-exhaustion pattern.
