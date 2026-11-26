import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the gate's pure Python selection rule without running a gate.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Enforce read-only setup for the shipped-product scenario suites.
import { readFileSync } from 'node:fs';

test.each([
  'ground-borrowed-body', 'roc-borrowed-body',
  'template-strikes-hurt',
  'mover-carry',
])('%s consumes an existing product without building an app or starting a server', name => {
  const source = readFileSync(`test/${name}.test.ts`, 'utf8');
  expect(source).toMatch(/builtFolder\(/u);
  expect(source).not.toMatch(/node:child_process|scripts\/build-shardfiles|createServer\(|localhost:3000/u);
});

test('selected disk readers require exactly their published products', () => {
  const result = execFileSync('python3', ['-c', `
import json, runpy
select = runpy.run_path('src/scripts/test_products.py')['required_test_products']
registry = json.load(open('src/scripts/test-folders.json'))
cases = [
 ['test/template-strikes-hurt.test.ts'],
 ['test/unit.test.ts', 'test/scripts/far-reach-roc.test.ts'],
 ['src/sharddev/bake/script-scenario.test.ts', 'test/shard-headless.test.ts'],
 [], ['test/scripts-not-a-scenario.test.ts'],
 ['test/scripts/readme.md'], ['other/test/scripts/example.test.ts'],
 ['test/mover-carry.test.ts', 'test/scripts/ground-encounters.test.ts'],
 ['test/scripts/nine-sign-atlas.test.ts'],
 ['test/mover-carry.test.ts'],
]
print(json.dumps([select(case, registry) for case in cases], separators=(',', ':')))
for unregistered in ['test/scripts/unregistered.test.ts', 'test/scripts/_template-boss.test.ts']:
 try:
  select([unregistered], registry)
  raise AssertionError('An unregistered or migrated scenario must refuse')
 except ValueError:
  pass
from pathlib import Path
assert all(str(path) in registry for path in Path('test/scripts').glob('*.test.ts'))
`], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual([
    ['brasscap-mesa'], ['far-reach'],
    ['driftwood-isle', 'far-reach', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes'],
    [], [], [], [], ['driftwood-isle', 'pine-hollow'], [], ['pine-hollow'],
  ]);
});

test('carriers require their own zero guard and never trust a checkout-only checker', () => {
  const result = execFileSync('python3', ['-c', `
import json, runpy
from pathlib import Path
from tempfile import TemporaryDirectory
command = runpy.run_path('src/scripts/test_products.py')['custom_sections_zero_command']
Path('tmp').mkdir(exist_ok=True)
with TemporaryDirectory(dir='tmp') as temporary:
 root = Path(temporary).resolve()
 repo, tree, common = root / 'repo', root / 'carrier', root / 'git'
 for folder in [repo, tree]:
  (folder / 'src/scripts').mkdir(parents=True)
 checker = 'src/scripts/check-custom-sections-zero.mjs'
 (repo / checker).write_text('checkout-only checker')
 try:
  command(tree)
  raise AssertionError('missing zero guard accepted')
 except ValueError:
  pass
 (tree / checker).write_text('committed checker')
 assert command(tree) == [
  'node', str(tree / checker), str(tree)]
 print(json.dumps({'missingRefused': True, 'newUsesCarrier': True}))
`], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual({ missingRefused: true, newUsesCarrier: true });
});
