# StyleX migration

All Tailwind utility classes are replaced by colocated StyleX definitions. The Babel plugin compiles static props in Vite and Vitest; PostCSS extracts the same definitions into the application's single CSS entry. Tailwind and its Vite plugin are removed.

The existing compiled reset and theme declarations remain in `src/index.css`, with their MIT notice, followed by the original semantic CSS. Existing inline styles, interactions, responsive layout rules, and CSS layers retain their priority. Loading spinners use equivalent StyleX keyframes. This does not redesign the interface or convert unrelated inline/custom CSS.

## Validation

- `bun run build`, `bun run lint`, `bun run test`: all pass (295 tests, 31 files).
- `node scripts/check-bundle-budget.mjs`: passes; initial preload 334 kB against the existing 500 kB limit.
- Browser comparisons against default-branch commit b250015f3176797fc5dc3883904bd6705aeba2ef: text, exact rectangles, and all non-custom computed CSS properties match for home at 375, 767, 768, and 1440 pixels; settings in both themes at 375, 768, and 1440 pixels (up to 563 elements); and the open sidebar at 375, 767, 768, and 1440 pixels. The initial desktop editor comparison also matches all 536 elements.
- Desktop editor/sidebar screenshot is byte-identical. Compile-time text is normalized to 100 ms and the seeded project's timestamps are fixed in the browser fixture, since those values are nondeterministic. Infinite animations are paused and transitions finished before comparison.
- Vite development editor/settings rendering checked: layout and colors match production; CSS minification serializes the unused background position differently (`0px 0px` versus `0% 0%`) on buttons without a background image.

Production CSS changes from 19.46 kB to 17.28 kB. The home shell changes from 138.08 kB to 138.16 kB and workspace from 177.51 kB to 178.19 kB. These are uncompressed build output sizes; this is a styling port, not a performance claim.
