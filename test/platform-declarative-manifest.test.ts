import { expect, it } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The census fixture owns its complete temporary source tree.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep every fixture file under its own temporary directory.
import { join, dirname } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated census root, never the shared checkout.
import { tmpdir } from 'node:os';
import { declarationOnlyManifest, shardLines } from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';

it('recognizes typed literal rows, imported data and const aliases without executing them', () => {
  expect(declarationOnlyManifest(`import type { Manifest } from './contract';
import { BASE, ITEMS } from './data/rows';
const places = [{x: -3, z: +4}, ...ITEMS] as const;
export const manifest = {...BASE, places, name: BASE.identity.name, fixed: ITEMS[0]} satisfies Manifest;
export default manifest;`)).toBe(true);
});

it('keeps any runtime logic, side effect or unknown expression custom', () => {
  for (const source of [
    "import './register'; export default {};", 'let row = {}; export default row;',
    'export default defineShard({});', 'export const row = Object.freeze({});',
    "export default {load: () => import('./plugin')};", 'export default {f() { return 1; }};',
    'export default {get x() { return 1; }};', 'export default new Map();',
    'export default {x: 2 * 3};', 'export default ready ? left : right;',
    'export default left || right;', 'export default {x: row?.x};',
    'export default {x: row[key]};', 'export default {[key]: 1};',
    'const row = {}; row.x = 1; export default row;', 'export default class {};',
    'export default await ready;', `export default \`value \${compute()}\`;`,
    'export default tag`value`;', 'export default function make() { return {}; }',
  ]) expect(declarationOnlyManifest(source), source).toBe(false);
});

it('the output basis counts no authored runtime or manifest logic (LD10: a product ships no TypeScript)', () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-manifest-'));
  const put = (file: string, text: string): void => { const path = join(root, file); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); };
  try {
    put('src/shards/_template/manifest.ts', "import { VALUE } from './logic'; export default {value: VALUE};");
    put('src/shards/_template/logic.ts', 'export const VALUE = compute();');
    put('src/shards/_template/nested/manifest.ts', 'export default {value: 1};');
    put('src/shards/pine-hollow/manifest.ts', 'export default {load: () => load()};');
    platformOutput(root,'_template',{'runtime/index.ts':'export const LIVE=1;'});
    platformOutput(root,'pine-hollow',{'runtime/index.ts':'export const LIVE=1;'});
    const rows = shardLines(root,true);
    expect(rows['_template']?.conversion.shardRuntimeLines).toBe(0);
    expect(rows['pine-hollow']?.conversion.shardRuntimeLines).toBe(0);
    expect(rows['_template']?.customSources).toEqual([]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
