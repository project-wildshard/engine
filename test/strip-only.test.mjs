// oxlint-disable-next-line import/no-nodejs-modules -- A planted checkout on disk, read by Node's own stripper.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { flagUsers, specifiers, stripOnlyRefusals, trackedEntries } from '../scripts/strip-only.mjs';

// Meta QA 11-25 row 25 (J505): fc0832b52's parameter property in the cook held engine main red for 82 minutes, because
// Node runs the cook strip-only and the lint override covered only src/*/engine and src/cook. The push gate's
// check:strip-only walks the import closure of every tool Node runs and refuses what strip-only Node cannot run.
const made = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function checkout(files) {
  const root = mkdtempSync(resolve('tmp/strip-only-')); made.push(root);
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
}
const PROPERTY = 'export class Meter { constructor(private readonly limit: number) {} }\n';
const PLAIN = 'export class Meter { private readonly limit: number; constructor(limit: number) { this.limit = limit; } }\n';

test('a parameter property outside the cook, reached from a tool Node runs, is refused with its entry', () => {
  const root = checkout({
    'scripts/run.mjs': "import { Meter } from '../src/shared/game/meter.ts';\nnew Meter(1);\n",
    'src/shared/game/meter.ts': "import type { Unused } from './types.ts';\nexport { Meter } from './inner.ts';\n",
    'src/shared/game/inner.ts': PROPERTY,
  });
  expect(stripOnlyRefusals(root, ['scripts/run.mjs'])).toEqual([{ file: 'src/shared/game/inner.ts', entry: 'scripts/run.mjs',
    error: expect.stringContaining('parameter property') }]);
  writeFileSync(join(root, 'src/shared/game/inner.ts'), PLAIN);
  expect(stripOnlyRefusals(root, ['scripts/run.mjs'])).toEqual([]);
});

test('only what the tool loads is judged: a type-only import, generated code in a template string and an unreached file pass', () => {
  const root = checkout({
    'scripts/gen.mjs': "const code = `render: async () => (await import('../src/client/look.ts')).look()`;\nawait import('./dyn.ts');\n",
    'scripts/dyn.ts': "import type { Meter } from '../src/shared/meter.ts';\nexport const x: Meter | null = null;\n",
    'src/client/look.ts': PROPERTY, 'src/shared/meter.ts': PROPERTY,
  });
  expect(specifiers("import a from './a.ts';\nexport * from \"./b.mjs\";\nconst c = await import('./c.ts');\n")).toEqual(['./a.ts', './b.mjs', './c.ts']);
  expect(stripOnlyRefusals(root, ['scripts/gen.mjs', 'scripts/dyn.ts'])).toEqual([]);
});

test('a file that still passes the removed transform flag is named; the stored copies of old CI files are not', () => {
  const flag = ['--experimental', 'transform-types'].join('-');
  expect(flagUsers([
    { path: 'a.yml', text: `run: node ${flag} --import ./scripts/bake-loader.mjs scripts/host.ts out.json\n` },
    { path: 'test/fixtures/ci-native-cache-v4.yml', text: `run: node ${flag} scripts/ci-native-fixtures.mjs\n` },
    { path: 'c.mjs', text: "spawn(node, ['scripts/plain.ts'])\n" },
  ])).toEqual(['a.yml']);
});

test('every TypeScript file Node runs here is erasable, and nothing passes the removed flag', () => {
  const { entries, flagged } = trackedEntries(process.cwd());
  expect(entries).toContain('src/server/host/bake/headlessWorker.ts');
  expect(stripOnlyRefusals(process.cwd(), entries)).toEqual([]);
  expect(flagged).toEqual([]);
}, 60_000);
