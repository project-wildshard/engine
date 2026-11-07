import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- A fresh real-GC process verifies the escaped material closure.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only this test's temporary configuration.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the runner without a shell.
import { resolve as resolvePath } from 'node:path';
import { Scope } from '../src/shared/engine/app/scope';
import type { Renderer } from '../src/client/engine/render/renderer';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { clientMaterials } from '../src/client/game/shardfile/clientMaterials';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

async function fixture() {
  const source = emptyShardfile({ slug: 'material-inputs', name: 'Inputs', author: 'Test', revision: 1, seed: 1 });
  const graph = new TextEncoder().encode(JSON.stringify({ version: 1, kind: 'material', model: 'standard', nodes: {}, stages: { surface: { colour: [0.5, 0.4, 0.3], roughness: 1 } } }));
  const ref = hashImmutableBytes(graph), unrelated = new Uint8Array(1_048_576), binary = 'b'.repeat(64);
  for (const [hash, bytes, kind] of [[ref, graph, 'json'], [binary, unrelated, 'binary']] as const) source.files.push({ hash, kind, compressed: bytes.length, decoded: bytes.length, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  source.look.materials['later'] = { family: 'graph', file: ref };
  const inputs = new Map([[ref, graph], [binary, unrelated]]), weak = new WeakRef(unrelated.buffer), scope = new Scope('material-inputs');
  const materials = await clientMaterials(source, inputs, legacyDouble<Renderer>({}), scope, { graphs: false });
  return { materials, inputs, weak, scope };
}

test('lazy graph files still compile after the preparation Map is cleared', async () => {
  const f = await fixture();
  try {
    f.inputs.clear();
    expect(f.materials.materials.get('later')?.type).toBe('MeshStandardMaterial');
    expect(f.materials.instance?.('later').material.type).toBe('MeshStandardMaterial');
  } finally { f.scope.dispose(); }
});

async function escapedMaterials() {
  const f = await fixture();
  return { materials: f.materials, weak: f.weak, scope: f.scope };
}
test('live materials retain graph JSON without retaining unrelated preparation backing', async () => {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    if (process.env['WS_MATERIAL_INPUT_GC'] === '1') throw new Error('Material input proof requires --expose-gc');
    mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolvePath('tmp/material-input-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['test/client-material-input-lifetime.test.ts'],setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: { ...process.env, WS_MATERIAL_INPUT_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      }); expect(output).toContain('2 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const live = await escapedMaterials();
  try {
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
      if (live.weak.deref() === undefined) break;
    }
    expect(live.weak.deref()).toBeUndefined(); expect(live.scope.disposed).toBe(false);
    expect(live.materials.materials.get('later')?.type).toBe('MeshStandardMaterial');
  } finally { live.scope.dispose(); }
});
