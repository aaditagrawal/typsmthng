# Local Typst compiler

The compiler WASM is 24,567,390 bytes. Bindings, type declarations, and the
Apache-2.0 license bring the package to 24,654,595 bytes. Both are strictly
under 25,000,000 bytes, without transport compression.

This is a build of [typst.ts 0.7.0-rc2](https://github.com/Myriad-Dreamin/typst.ts/tree/af2047eb986155ca5171a2370db359e5f4aa1404).
It retains the upstream `web,misc` features and Typst 0.14.2 dependencies.
It uses Rust optimization level 3, fat LTO, one codegen unit, and Binaryen
`-Oz`. No language, font, package, PDF, vector, or source mapping support was
removed. Fonts remain separate inputs, as in the original app.

`manifest.json` records the exact source commit, build settings, module hash,
bindings hash, and sizes. The generated JavaScript belongs to this WASM;
always replace them together. Normal app builds verify this pair and its
version against the installed compiler package. They also check the emitted
production asset and verify that the compiler stays out of the home precache.

Rebuild instructions and measured tradeoffs are in
[the performance report](../../docs/compiler-performance.md).
