import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the gate's pure Python selection rule without running a gate.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Enforce read-only setup for the shipped-product scenario suites.
import { readFileSync } from 'node:fs';

test.each([
  'ground-borrowed-body', 'matriarch-borrowed-body', 'roc-borrowed-body', 'pine-npc-figure-product',
  'scripts/_template-boss', 'scripts/ground-encounters', 'scripts/sunscar-matriarch',
  'scripts/far-reach-roc', 'scripts/skitterer-pack',
  'chapter-director-product', 'pine-quest-actions-product', 'pine-prop-product',
  'native-runtime-plan', 'mover-carry',
  'template-map-generation',
])('%s consumes an existing product without building an app or starting a server', name => {
  const source = readFileSync(`test/${name}.test.ts`, 'utf8');
  expect(source).toContain('builtFolder(');
  expect(source).not.toMatch(/node:child_process|scripts\/build-shardfiles|createServer\(|localhost:3000/u);
});

test('selected disk readers require exactly their published products', () => {
  const result = execFileSync('python3', ['-c', `
import json, runpy
select = runpy.run_path('scripts/test_products.py')['required_test_products']
registry = json.load(open('scripts/test-folders.json'))
cases = [
 ['test/scripts/_template-boss.test.ts'],
 ['test/unit.test.ts', 'test/scripts/far-reach-roc.test.ts'],
 ['src/sharddev/bake/script-scenario.test.ts', 'test/shard-headless.test.ts'],
 [], ['test/scripts-not-a-scenario.test.ts'],
 ['test/scripts/readme.md'], ['other/test/scripts/example.test.ts'],
 ['test/pine-npc-figure-product.test.ts', 'test/scripts/ground-encounters.test.ts'],
 ['test/scripts/nine-sign-atlas.test.ts'],
 ['test/template-map-generation.test.ts'],
]
print(json.dumps([select(case, registry) for case in cases], separators=(',', ':')))
try:
 select(['test/scripts/unregistered.test.ts'], registry)
 raise AssertionError('An unregistered scenario must refuse')
except ValueError:
 pass
from pathlib import Path
assert all(str(path) in registry for path in Path('test/scripts').glob('*.test.ts'))
`], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual([
    ['_template'], ['far-reach'],
    ['_template', 'driftwood-isle', 'far-reach', 'nalati-grasslands', 'nine-dragon-stack', 'pastel-plain', 'pine-hollow', 'sunscar-dunes'],
    [], [], [], [], ['driftwood-isle', 'pine-hollow'], [], ['_template'],
  ]);
});

test('carriers require their own zero guard and never trust a checkout-only checker', () => {
  const result = execFileSync('python3', ['-c', `
import json, runpy
from pathlib import Path
from tempfile import TemporaryDirectory
command = runpy.run_path('scripts/test_products.py')['custom_sections_zero_command']
Path('tmp').mkdir(exist_ok=True)
with TemporaryDirectory(dir='tmp') as temporary:
 root = Path(temporary).resolve()
 repo, tree, common = root / 'repo', root / 'carrier', root / 'git'
 for folder in [repo, tree]:
  (folder / 'scripts').mkdir(parents=True)
 checker = 'scripts/check-custom-sections-zero.mjs'
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
