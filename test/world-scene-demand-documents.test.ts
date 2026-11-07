import { expect, test } from 'vitest';
import { Group } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { withOwner } from '../src/shared/engine/app/ownership';
import { legacyDouble } from '../src/test/engine/FakeGame';
import { sharedModelContext, specimenReady } from '../src/client/engine/models/model';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { Rng } from '../src/shared/engine/core/rng';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { installWorldScenes } from '../src/client/game/shardfile/worldScenes';
import { defineWorldSceneCatalogue } from '../src/client/game/models/worldSceneCatalogue';
import type { ShardContext } from '../src/client/game/plugin/context';

function fixture(demand = true, direct = false, corrupt = false) {
  const owner = new Scope('cold-scene-documents'), registry = new WorldRegistry();
  const candidate: unknown = Object.create(SkyRig.prototype);
  if (!(candidate instanceof SkyRig)) throw new Error('Missing scene fixture sky');
  const sky = candidate;
  const models = ['cold', 'unopened'].map(key => {
    const model = { key, id: `document-fixture/${key}`, name: key, file: `${key}.source`,
      category: 'props', pipeline: 'code', defaults: {}, assembly: 'scene',
      choices: [{ id: 'only', params: {}, size: [1, 1, 1], draws: [], colliders: [], scene: { file: `${key}.json` } }] };
    if (demand) Object.assign(model, { load: 'demand' }); return model;
  });
  const catalogue = { product: 'document-fixture', models };
  const section = parseWorldScenes({ version: 1, catalogue: 'catalogue.json', libraries: [], materials: [], steps: [],
    placements: direct ? [{ id: 'live-cold', model: 'cold', draw: 'single', poses: [{ x: 0, y: 0, z: 0, yxz: { yaw: 0, scale: 1 } }] }] : [] });
  const rows = new Map<string, unknown>([['catalogue.json', catalogue], ...['cold', 'unopened'].map(key => [
    `${key}.json`, { id: key, root: `${key}.root`, nodes: [{ kind: 'group', id: `${key}.original`, parent: `${key}.root`, name: `${key}-original` }],
      ...(corrupt ? { resources: [{ id: 'hidden', kind: 'seeds', words: [0, 0, 0, 0] }] } : {}) },
  ] as const)]);
  const bodies = new Map([...rows].map(([name, row]) => [name, new TextEncoder().encode(JSON.stringify(row))]));
  const inventory = new Map([...bodies].map(([name, bytes]) => [name, { hash: hashImmutableBytes(bytes), url: `/fixture/${name}` }]));
  const reads: string[] = [];
  let finish: (() => void) | undefined;
  let waiting: Promise<void> | undefined;
  const product = createShardProduct({ slug: 'document-fixture', revision: 1, shardfile: emptyShardfile({ slug: 'document-fixture', name: 'Documents', author: 'Test', revision: 1, seed: 1 }),
    sections: new Map([['world/scenes', section]]), files: inventory, read: async hash => {
      const name = [...inventory].find(([, file]) => file.hash === hash)?.[0];
      if (name === undefined) throw new Error('Missing fixture hash');
      reads.push(name); if (name === 'cold.json') await waiting;
      const bytes = bodies.get(name); if (bytes === undefined) throw new Error('Missing fixture body'); return bytes;
    } });
  type World = NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>;
  const game = legacyDouble<World['game']>({ onUpdate: () => undefined });
  const world = legacyDouble<World>({ sky, registry, game });
  const runtime = legacyDouble<NonNullable<ShardContext['game']['runtime']>>({ world });
  const context = legacyDouble<ShardContext>({ scope: owner, root: new Group(), product, cube: null,
    app: legacyDouble<ShardContext['app']>({ registry }), game: legacyDouble<ShardContext['game']>({ runtime }) });
  return { owner, registry, context, product, section, catalogue, inventory, reads, sky,
    hold: () => { waiting = new Promise<void>(resolve => { finish = resolve; }); }, release: () => { finish?.(); } };
}

test('cold demand documents stay unread until the actual Explorer choice awaits them', async () => {
  const f = fixture();
  try {
    await installWorldScenes(f.context, f.section);
    expect(f.reads).toEqual(['catalogue.json']);
    f.hold();
    const root = withOwner(f.owner, () => defineWorldSceneCatalogue(f.catalogue, f.product).model('cold').build(sharedModelContext(f.sky), {}, new Rng(1)));
    expect(root).toBeInstanceOf(Group);
    if (!(root instanceof Group)) throw new Error('Missing awaited specimen');
    let ready = false; const pending = specimenReady(root).then(() => { ready = true; return undefined; });
    await Promise.resolve(); expect(ready).toBe(false); expect(root.getObjectByName('cold-original')).toBeUndefined();
    f.release(); await pending;
    expect(root.getObjectByName('cold-original')).toBeDefined();
    expect(f.reads.filter(name => name === 'cold.json')).toHaveLength(1); expect(f.reads).not.toContain('unopened.json');
  } finally { f.release(); f.owner.dispose(); f.registry.retire(); }
});

test('missing cold inventory still refuses before constructing a live world', async () => {
  const f = fixture(); f.inventory.delete('unopened.json');
  try { await expect(installWorldScenes(f.context, f.section)).rejects.toThrow('Missing world scene blob'); }
  finally { f.owner.dispose(); f.registry.retire(); }
});

test.each([false, true])('ordinary or directly placed documents retain eager world-service refusal (direct=%s)', async direct => {
  const f = fixture(direct, direct, true);
  try { await expect(installWorldScenes(f.context, f.section)).rejects.toThrow('Frozen specimens cannot install world services'); }
  finally { f.owner.dispose(); f.registry.retire(); }
});

test('a cold demand document still refuses hidden world services before any specimen publication', async () => {
  const f = fixture(true, false, true);
  try {
    await installWorldScenes(f.context, f.section);
    expect(f.reads).toEqual(['catalogue.json']);
    const root = withOwner(f.owner, () => defineWorldSceneCatalogue(f.catalogue, f.product).model('cold').build(sharedModelContext(f.sky), {}, new Rng(1)));
    if (!(root instanceof Group)) throw new Error('Missing awaited specimen');
    await expect(specimenReady(root)).rejects.toThrow('Frozen specimens cannot install world services');
    expect(root.getObjectByName('cold-original')).toBeUndefined();
    expect(f.reads).not.toContain('unopened.json');
    expect(f.registry.pieces).toHaveLength(0);
  } finally { f.owner.dispose(); f.registry.retire(); }
});
