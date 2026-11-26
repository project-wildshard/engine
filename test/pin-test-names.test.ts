// Meta SHARD-COMPAT NB10: a retired shard leaves every test list in the same commit; a pin drop refuses while a test names it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { assertTestsDropped, namingLines, testsNaming } from '../src/scripts/pin-test-names.ts';

const scratch = resolve('tmp/pin-test-names');
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, 'tree-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

put('test/pins/shardfiles.json', JSON.stringify({ shards: [{ slug: 'old-cove' }] }));
put('test/pins/catalogue.json', JSON.stringify({ shards: [{ slug: 'old-cove' }] }));
put('test/ring.test.ts', "// old-cove retired in 11-20\nconst ring = ['old-cove', 'pine-hollow'];\nconst other = 'old-cove-two';\n");
put('test/pins/saves/old-cove.json', '{"slug": "old-cove"}\n');
put('test/notes.md', 'old-cove\n');

test('a whole slug on a code line names it; a longer slug, a comment or a doc does not', () => {
  expect(namingLines('old-cove', 'a.ts', "x('old-cove')\n// old-cove\n * old-cove\ny('old-cove-two')\nz(`out/old-cove/shard.json`)"))
    .toEqual([{ path: 'a.ts', line: 1, text: "x('old-cove')" }, { path: 'a.ts', line: 5, text: 'z(`out/old-cove/shard.json`)' }]);
  expect(() => namingLines('Old Cove', 'a.ts', '')).toThrow(/not a shard slug/u);
});

test('every test file naming a dropped slug is listed, but not the pin files the drop edits', () => {
  expect(testsNaming(['old-cove'], root).map(row => `${row.path}:${row.line}`).toSorted())
    .toEqual(['test/pins/saves/old-cove.json:1', 'test/ring.test.ts:2']);
});

test('the drop refuses by file and line until the tests drop the slug, unless ALLOW_PIN_DROP_TEST_NAMES=1', () => {
  expect(() => assertTestsDropped(['old-cove'], root, {})).toThrow(/2 test line\(s\) still name old-cove[\s\S]*test\/ring\.test\.ts:2/u);
  expect(() => assertTestsDropped(['old-cove'], root, { ALLOW_PIN_DROP_TEST_NAMES: '1' })).not.toThrow();
  expect(() => assertTestsDropped(['never-named'], root, {})).not.toThrow();
});
