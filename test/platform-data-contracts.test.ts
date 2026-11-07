import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Disposable ruler fixture files.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths stay inside the fixture root.
import { dirname, join } from 'node:path';
import { sourceProgressInventory } from '../scripts/shard-platform.mjs';
import { platformOutput } from './fixtures/platformOutputs';

test('generated data contracts and erased JSON stubs leave handwritten and executable TypeScript charged', () => {
  const root = mkdtempSync('tmp/platform-data-contracts-');
  const put = (path: string, source: string): void => {
    const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source);
  };
  try {
    platformOutput(root, 'pine-hollow', { 'runtime/index.ts': 'export const live = 1;' });
    const prefix = 'src/shards/pine-hollow/data/';
    put(`${prefix}rows.d.json.ts`, "import type { Shape } from './shape';\ntype Rows = Shape[];\ndeclare const rows: Rows;\nexport = rows;");
    put(`${prefix}policy.d.json.ts`, "import type policy from './policy.json';\ninterface Rows { policy: typeof policy }\ndeclare const rows: Rows;\nexport default rows;");
    put(`${prefix}fauna.generated.ts`, 'export const fauna: { count: number }[] = [{ count: 4 }];');
    put(`${prefix}authored.ts`, 'export const authored = 1;');
    put(`${prefix}unregistered.generated.ts`, 'export const handWritten = 1;');
    put(`${prefix}executable.d.json.ts`, 'export const runtime = () => 1;');
    put(`${prefix}runtime.generated.ts`, 'export function runtime() { return 1; }');
    put('scripts/source-generation-outputs.json', JSON.stringify({ schema: 'source-generation-outputs/1',
      producers: { 'scripts/bake-data.mjs': [`${prefix}fauna.generated.ts`, `${prefix}runtime.generated.ts`] } }));
    const row = sourceProgressInventory(root)['pine-hollow'];
    expect(row?.conversion.shardRuntimeLines).toBe(5);
    expect(row?.customSources?.filter(source => source.kind === 'runtime-ts').map(source => source.path).sort()).toEqual([
      `${prefix}authored.ts`, `${prefix}executable.d.json.ts`, `${prefix}runtime.generated.ts`,
      `${prefix}unregistered.generated.ts`, 'src/shards/pine-hollow/runtime/index.ts',
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('generated literal tables keep their embedded shader charge', () => {
  const root = mkdtempSync('tmp/platform-generated-shader-');
  const put = (path: string, source: string): void => {
    const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source);
  };
  try {
    platformOutput(root, 'pine-hollow', { 'runtime/index.ts': 'export const live = 1;' });
    const path = 'src/shards/pine-hollow/data/shader.generated.ts';
    put(path, 'export const shader = `uniform float time;\nvoid main() {}`;');
    put('scripts/source-generation-outputs.json', JSON.stringify({ schema: 'source-generation-outputs/1',
      producers: { 'scripts/bake-data.mjs': [path] } }));
    const row = sourceProgressInventory(root)['pine-hollow'];
    expect(row?.conversion.shardRuntimeLines).toBe(1);
    expect(row?.conversion.additionalGlslLines).toBe(2);
    expect(row?.customSources).toContainEqual({ path, kind: 'additional-glsl', lines: 2 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
