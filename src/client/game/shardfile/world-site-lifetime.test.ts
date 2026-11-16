import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Mandatory real-GC child exercises the actual site factory.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Read pinned catalogue rows and own only the child config.
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Check the pinned catalogue bytes against their product index.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the child runner without a shell.
import { resolve as resolvePath } from 'node:path';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { MemoryAttribution } from '@wildshard/engine/core/memoryAttribution';
import { sharedModelContext } from '@wildshard/engine/models/model';
import { SkyRig } from '@wildshard/engine/world/skyRig';
import { defineWorldSceneCatalogue, bindWorldSceneModelSources } from '../models/worldSceneCatalogue';
import { parseWorldSceneModels } from '@wildshard/format/worldSceneModels';
import { WorldAssembly } from './worldAssembly';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import type { SceneHandles } from './sceneHandles';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import * as v from 'valibot';

const keys = ['hut', 'lookout', 'shrine'];
// J65: the shard source this read (`siteCatalogue.json` and its layout
// constructors) lives in the shard repo now. Read the same shipped site rows
// from the pinned driftwood-isle shardfile's admitted scene catalogue instead:
// its cook already merged each layout's origin, colliders, floors and anchors.
// The product is what `node scripts/pins.ts install` writes, or Ring 1's server
// slice of the same pin (test/fixtures/engine-lift/folder.ts's order); both
// carry the identical catalogue bytes.
const full = 'out/driftwood-isle', slice = 'out/.slices/driftwood-isle';
const product = (process.env['WILDSHARD_RING'] === '1' ? [slice, full] : [full, slice]).find(directory => existsSync(resolvePath(directory, 'shard.json')));
if (product === undefined) throw new Error('Missing pinned driftwood-isle product; run: node scripts/pins.ts install driftwood-isle');
const index = v.parse(v.looseObject({ files: v.array(v.looseObject({ name: v.optional(v.string()), path: v.string(), hash: v.string() })) }),
  JSON.parse(readFileSync(resolvePath(product, 'shard.json'), 'utf8')));
const entry = index.files.find(file => file.name === 'models/world-scenes.json');
if (entry === undefined) throw new Error('The pinned product has no scene catalogue');
const bytes = readFileSync(resolvePath(product, entry.path));
if (createHash('sha256').update(bytes).digest('hex') !== entry.hash) throw new Error('The pinned scene catalogue differs from its index hash');
const shipped = parseWorldSceneModels(JSON.parse(bytes.toString('utf8')));
const rows = parseWorldSceneModels({ ...shipped, models: shipped.models.filter(row => keys.includes(row.key)) });

async function retiredVisit(page: Scope, ledger: MemoryAttribution, handles: Set<object>): Promise<WeakRef<object>[]> {
  const scope = page.child('retired site construction'), sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing real catalogue sky fixture');
  sky.setupMaterial = () => undefined;
  const ctx = sharedModelContext(sky), geometry = new Map<string, BufferGeometry>(), material = new Map<string, MeshStandardMaterial>();
  for (const row of rows.models) for (const choice of row.choices) for (const draw of choice.draws) {
    geometry.set(JSON.stringify([draw.library, draw.model]), new BufferGeometry().setAttribute('position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)));
    material.set(draw.material, new MeshStandardMaterial());
  }
  bindWorldSceneModelSources(ctx, rows.product, { catalogue: rows, geometries: geometry, materials: material }, scope);
  let donorDisposals = 0;
  for (const donor of geometry.values()) donor.addEventListener('dispose', () => { donorDisposals++; });
  const catalogue = defineWorldSceneCatalogue(rows), weak: WeakRef<object>[] = [];
  const assembly = WorldAssembly.admit({ stages: keys.map(id => ({ kind: 'site', id, label: id, model: id, choice: 'world' })) }, {
    scope, sites: catalogue, scenes: legacyDouble<SceneHandles>({}), context: ctx, registry: null, slice: () => Promise.resolve(),
  });
  try {
    for (const id of keys) {
      // Match the awaited construction path: no ambient withOwner crosses this turn.
      await Promise.resolve(); await assembly.next(id);
      entryOwner(scope, 'object', id).traverse(node => {
        if (!(node instanceof Mesh)) return;
        const shape: unknown = node.geometry, handle = {};
        if (!(shape instanceof BufferGeometry)) return;
        const position: unknown = shape.getAttribute('position');
        if (!(position instanceof BufferAttribute)) throw new Error('Missing site position storage');
        weak.push(new WeakRef<object>(shape)); handles.add(handle);
        ledger.label(handle, { owner: id, asset: 'site position buffer' });
        ledger.allocation(handle, 'gpu', 'buffer', position.array.byteLength);
        // A live context holds storage until the geometry sends its actual dispose event.
        shape.addEventListener('dispose', () => { handles.delete(handle); ledger.release(handle, 'gpu'); });
      });
    }
  } finally {
    scope.dispose();
    expect(donorDisposals).toBe(0);
    for (const donor of geometry.values()) donor.dispose();
    for (const donor of material.values()) donor.dispose();
  }
  return weak;
}

test('awaited shipped sites release their GPU storage and collect while the page remains live', async () => {
  // The consumed facts: each pinned site keeps its world choice, layout and colliders.
  expect(rows.product).toBe('driftwood-isle');
  expect(rows.models.map(row => row.key)).toEqual(keys);
  for (const row of rows.models) {
    const world = row.choices.find(choice => choice.id === 'world');
    expect([world?.site !== undefined, (world?.colliders.length ?? 0) > 0, (world?.draws.length ?? 0) > 0]).toEqual([true, true, true]);
  }
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    if (process.env['WS_WORLD_SITE_GC'] === '1') throw new Error('Site lifetime proof requires --expose-gc');
    mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolvePath('tmp/world-site-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['src/client/game/shardfile/world-site-lifetime.test.ts'],environment:'node',setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: { ...process.env, WS_WORLD_SITE_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      }); expect(output).toContain('1 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const page = new Scope('live page'), ledger = new MemoryAttribution(), handles = new Set<object>(), weak: WeakRef<object>[] = [];
  try {
    for (let visit = 0; visit < 5; visit++) weak.push(...await retiredVisit(page, ledger, handles));
    expect(weak.length).toBeGreaterThan(0);
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
      if (weak.every(ref => ref.deref() === undefined)) break;
    }
    expect(weak.every(ref => ref.deref() === undefined)).toBe(true);
    expect(handles.size).toBe(0); expect(ledger.snapshot().totals.gpu).toBe(0);
    expect(page.disposed).toBe(false);
  } finally { page.dispose(); }
});
