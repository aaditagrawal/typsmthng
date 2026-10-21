import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readdirSync } from 'node:fs';
const projectRequire = createRequire(path.resolve('package.json'));
let location = process.env.BRACES_PACKAGE;
if (!location) {
  try { location = projectRequire.resolve('braces'); }
  catch {
    // Bun isolated monorepos retain transitive packages in node_modules/.bun.
    const entries = readdirSync('node_modules/.bun').filter(name => name.startsWith('braces@3.0.3'));
    assert.equal(entries.length, 1, 'exactly one braces 3.0.3 package must be installed');
    location = path.resolve('node_modules/.bun', entries[0], 'node_modules/braces/index.js');
  }
}
const braces = projectRequire(location);

for (const [pattern, expanded] of [
  ['src/{app,lib}/file.{js,ts}', ['src/app/file.js', 'src/app/file.ts', 'src/lib/file.js', 'src/lib/file.ts']],
  ['{01..05..2}', ['01', '03', '05']],
  ['{a,{b,c}}', ['a', 'b', 'c']],
  ['${a,b}', ['${a,b}']],
  ['{a,a,,}', ['a', 'a', '', '']],
]) {
  assert.deepEqual(braces.expand(pattern), expanded);
  assert.equal(braces.stringify(braces.parse(pattern)), pattern);
}
assert.deepEqual(braces.expand('{a,a,,}', { nodupes: true, noempty: true }), ['a']);
assert.equal(braces.compile('src/{a,b}/{1..3}'), 'src/(a|b)/([1-3])');
assert.throws(() => braces.expand('{1..1001}'), RangeError);
assert.throws(() => braces.parse('a'.repeat(65537)), SyntaxError);

// Run each public walker cold with an identical constrained V8 stack. An
// unpatched 3.0.3 throws RangeError; the patched walkers preserve the output.
for (const method of ['compile', 'expand', 'stringify']) {
  for (const pair of ['{}', '()']) {
    const code = `const assert = require('node:assert/strict');
      const braces = require(${JSON.stringify(location)});
      const pattern = ${JSON.stringify(pair[0])}.repeat(4500) + 'a' + ${JSON.stringify(pair[1])}.repeat(4500);
      const result = braces[${JSON.stringify(method)}](pattern);
      assert.deepEqual(result, ${method === 'expand' ? '[pattern]' : 'pattern'});`;
    execFileSync(process.execPath, ['--stack-size=512', '-e', code], { timeout: 15000, stdio: 'pipe' });
  }
}
console.log('braces: expansion, ranges, escaping, limits and six cold deep-tree regressions passed');

// Recovery must fit the existing 10,000-character parser limit without copying
// every descendant list into every unfinished ancestor. Use the actual Node
// consumer and cap V8's heap so the old recovery loop fails reproducibly.
execFileSync(process.execPath, ["--stack-size=512", "--max-old-space-size=256", "-e", `
  const assert = require('node:assert/strict');
  const braces = require(${JSON.stringify(location)});
  for (const pattern of [
    '{'.repeat(9999) + 'x', '('.repeat(9999) + 'x',
    '}'.repeat(9999) + 'x', ')'.repeat(9999) + 'x',
    '{'.repeat(4999) + 'x' + '}'.repeat(4999),
    '('.repeat(4999) + 'x' + ')'.repeat(4999),
    '{('.repeat(2499) + 'x' + ')}'.repeat(2499),
    '{'.repeat(6000) + 'x' + '}'.repeat(3000),
  ]) {
    assert.equal(braces.parse(pattern).input, pattern);
    for (const method of ['compile', 'stringify', 'expand']) {
      const expected = method === 'expand' ? [pattern] : pattern;
      assert.deepEqual(braces[method](pattern), expected);
      assert.deepEqual(braces[method](braces.parse(pattern)), expected);
    }
  }
`], { timeout: 20000, stdio: "pipe" });
console.log("braces: bounded-heap malformed and balanced parser regressions passed");
