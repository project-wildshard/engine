// oxlint-disable-next-line import/no-nodejs-modules -- Run the real lint plugin against an owned policy fixture.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Small fixtures live only under ./tmp and are removed after the test.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture and plugin paths.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The child linter inherits this exact fixture process environment.
import { cwd, env, execPath } from 'node:process';
import { expect, test } from 'vitest';
import { shardfileBoundaryViolations } from '../lint/shardfile-boundaries.mjs';

const root = cwd(), runtime = 'src/shards/sample/runtime/index.ts';
const violations = (file: string, source: string, rule: string) => shardfileBoundaryViolations(root, file, source).filter(row => row.rule === rule);
const closed = (source: string) => violations(runtime, source, 'runtime-standalone');

test('runtime accepts its own TS and published packages, never private or author packages', () => {
  expect(closed("import './nested/helper'; import './const.ts'; import 'three'; import 'valibot'; import '@wildshard/engine/physics/query'; import '@wildshard/engine/game/plugin/simulation'; import '@wildshard/sharddev/movers';")).toEqual([]);
  expect(closed("import '@wildshard/engine/not-public'; import '@wildshard/commons/props'; import 'node:fs'; import '../../../engine/physics/query';")).toHaveLength(4);
});

test('runtime closes type imports, re-exports, dynamic imports and other-shard escapes', () => {
  expect(closed("import type { X } from '../data/facts'; export { X } from '../world/build'; export * from '../../other/runtime/index'; const x = import('../generators/a'); type T = import('../data/t').T;")).toHaveLength(5);
  expect(closed(`import x = require('../data/x'); require('../world/b'); import(\`./\${name}\`);`)).toHaveLength(3);
});

test('runtime refuses JSON, assets and transforms, including same-folder imports', () => {
  expect(closed("import './facts.json'; import './image.png'; import './worker.ts?url'; import './shader.glsl?raw'; import 'three/assets/image.png';")).toHaveLength(5);
  expect(closed("new URL('./image.webp', import.meta.url); new URL('../assets/tree.glb', import.meta.url);")).toHaveLength(2);
  expect(closed("new URL('./worker.ts', import.meta.url);")).toEqual([]);
});

test('glob patterns must prove a closed TS set, including array and computed forms', () => {
  expect(closed("import.meta.glob(['./**/*.ts', '!./excluded.ts']);")).toEqual([]);
  expect(closed("import.meta.glob(['../data/*.ts', './*.json']); import.meta.glob('./**/*'); import.meta.glob(pattern);")).toHaveLength(4);
  expect(closed("import.meta.glob('./*.ts', {query: '?raw'}); import.meta.glob('./*.ts', {as:'url'});")).toHaveLength(2);
});

test('play code cannot reach any build-time folder through static, lazy or resource forms', () => {
  const file = 'src/shards/sample/world/build.ts';
  const source = "import '../data/facts'; export * from '../generators/a'; import('../behaviour/a'); new URL('../assets/a.glb', import.meta.url); import.meta.glob('../blender/*.ts'); import '../shard.config';";
  expect(violations(file, source, 'no-build-time-import')).toHaveLength(6);
  expect(violations('src/client/app/main.ts', "import './shards/sample/data/a';", 'no-build-time-import')).toHaveLength(1);
  expect(violations('src/engine/a.ts', "import('/src/shards/' + slug + '/data/a');", 'no-build-time-import')).toHaveLength(1);
});

test('build data stays build-only while scripts and authoring CLI may read it', () => {
  const source = "import '../data/facts'; import '../generators/a'; import '../shard.config';";
  expect(violations('src/shards/sample/generators/a.ts', source, 'no-build-time-import')).toEqual([]);
  expect(violations('scripts/bake.mjs', "import '../src/shards/sample/data/a';", 'no-build-time-import')).toEqual([]);
  expect(violations('src/sharddev/cli/build.ts', "import '../../../shards/sample/data/a';", 'no-build-time-import')).toEqual([]);
  expect(violations('src/shards/other/data/a.ts', "import '../../sample/data/a';", 'no-build-time-import')).toHaveLength(1);
});

test('build bridges into runtime and legacy play code are measured, including type and glob forms', () => {
  const file = 'src/shards/sample/generators/a.ts';
  expect(violations(file, "import type {X} from '../runtime/a'; import '../world/b'; import '../plugin'; import.meta.glob('../models/*.ts'); new URL('../runtime/worker.ts',import.meta.url);", 'no-runtime-in-build')).toHaveLength(5);
  expect(violations(file, "import '../data/a'; import './other'; import '../shard.config';", 'no-runtime-in-build')).toEqual([]);
});

test('primary runtime refuses despite stale transition ceilings', () => {
  mkdirSync(resolve(root, 'tmp'), { recursive: true });
  const scratch = mkdtempSync(resolve(root, 'tmp/shardfile-lint-test-'));
  const file = resolve(scratch, runtime), baseline = resolve(scratch, 'ratchet.json'), config = resolve(scratch, 'lint.json');
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(baseline, JSON.stringify({ 'wildshard/runtime-standalone': { [runtime]: 100 },
    'wildshard/no-shard-runtime': { [runtime]: 100 } }));
  writeFileSync(file, "import './local';");
  writeFileSync(config, JSON.stringify({ jsPlugins: [resolve(root, 'lint/wildshard-plugin.js')],
    categories: { correctness: 'off' }, rules: { 'wildshard/no-shard-runtime': 'error' } }));
  try {
    const result = spawnSync(execPath, [resolve(root, 'node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json', '--no-ignore', file],
      { cwd: root, env: { ...env, WILDSHARD_RATCHET_FILE: baseline }, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('no-shard-runtime');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
