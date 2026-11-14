import { beforeAll, expect, test } from 'vitest';
import { builtProduct } from '../fixtures/builtProduct';
import { scenario, type DiskScriptScenario } from '../../src/sharddev/test/scriptScenario';
import { loadHeadlessProduct } from '@wildshard/engine/host/headlessProduct';

const directories = new Map<string, string>();
beforeAll(() => { for (const slug of ['driftwood-isle', 'pine-hollow']) directories.set(slug, builtProduct(slug)); });

async function encounter(slug: string, actorName: string, at: readonly [number, number, number], player: readonly [number, number, number]) {
  const directory = directories.get(slug); if (directory === undefined) throw new Error('Missing selected scenario product');
  const product = await loadHeadlessProduct(directory);
  const made = await scenario(slug, `${slug === 'pine-hollow' ? 'pine.king' : 'driftwood.captain'}.decision`, {
    productDirectory: directory, seed: 6218, actors: [{ id: actorName, at }], players: [{ id: 101, at: player }],
  });
  const fields = new Map(product.shardfile.state.shared.map(row => [row.name, row.id]));
  const body = (owner: DiskScriptScenario) => {
    const actor = owner.world.snapshot().actors?.[0]; if (actor === undefined) throw new Error('Missing actual scenario actor'); return actor;
  };
  return { made, product, set: (owner: DiskScriptScenario, values: Readonly<Record<string, number>>, hpShare = 1): void => {
    const actor = body(owner), next = { ...actor.fields };
    for (const [name, value] of Object.entries(values)) { const id = fields.get(name); if (id === undefined) throw new Error(`Missing admitted field ${name}`); next[id] = value; }
    owner.world.setActor({ ...actor, fields: next, hpShare });
  }, get: (owner: DiskScriptScenario, name: string): number | undefined => {
    const id = fields.get(name); if (id === undefined) throw new Error(`Missing admitted field ${name}`); return body(owner).fields?.[id];
  } };
}

test('Captain published guest rises, sinks, relocates inside the pool and resumes its second cut', async () => {
  const fixture = await encounter('driftwood-isle', 'captain', [0, 0, 0], [0, 0, 1]);
  const { made: captain, get, set } = fixture;
  captain.send('start'); expect(captain.commands(),JSON.stringify(captain.trace())).toContainEqual(['move', 'captain', 'rise']);
  set(captain, { rise: 1, subt: 8, cd: 8 }); captain.send('move.done', 'captain', 'rise', true);
  expect(get(captain, 'st')).toBe(2);
  captain.advance(.2);
  expect(get(captain,'subt')).toBeLessThan(.5);expect(get(captain,'cd')).toBeGreaterThan(.2);
  set(captain, { cd: 0, subt: 8 }, .5); captain.advance(.2);
  expect(captain.commands()).toContainEqual(['move', 'captain', 'sink']);
  set(captain, { rise: 0 }, .5); captain.send('move.done', 'captain', 'sink', true);
  expect(get(captain, 'st')).toBe(5);
  const x = get(captain, 'burst-x'), z = get(captain, 'burst-z');
  if (x === undefined || z === undefined) throw new Error('Missing admitted relocation point');
  expect(Math.hypot(x, z - 1)).toBeGreaterThanOrEqual(1.2); expect(Math.hypot(x, z - 1)).toBeLessThanOrEqual(2.2);
  captain.advance(.1);captain.advance(1.2); expect(captain.commands()).toContainEqual(['move', 'captain', 'relocate', 101]);
  captain.send('move.done', 'captain', 'relocate', true);
  expect(captain.commands()).toContainEqual(['strike', 'captain', 'burst', 101]);
  set(captain, { st: 3, combo: 0 }, .2);
  // The same live strike owner reports completion; the guest never invents a hit.
  captain.send('strike.done', 'captain', 'rage', false);
  expect(captain.commands()).toContainEqual(['strike', 'captain', 'second', 101]);
  const saved = captain.save(), resumed = await encounter('driftwood-isle', 'captain', [0, 0, 0], [0, 0, 1]);
  resumed.made.restore(saved); expect(resumed.made.host.metrics()[0]?.calls).toBe(0);
  for (const owner of [captain, resumed.made]) { owner.send('strike.done', 'captain', 'second', true); owner.advance(.2); }
  expect(resumed.made.save()).toEqual(captain.save());
  for (const owner of [captain, resumed.made]) {expect(owner.host.metrics()[0]).toMatchObject({ refusals: 0, disabled: false });expect(owner.maxFuel()).toBeLessThan(400_000);}
}, 10_000);

test('King published guest chooses sweep, ring recovery, summons and last-phase lanes without replay on restore', async () => {
  const fixture = await encounter('pine-hollow', 'king', [150, 0, -30], [155, 0, -30]);
  const { made: king, set, get } = fixture;
  king.send('start'); expect(king.commands(),JSON.stringify(king.trace())).toContainEqual(['move', 'king', 'reset', 101]);
  king.send('move.done', 'king', 'reset', true);
  king.advance(2.2); expect(get(king, 'king.mode')).toBe(4);
  king.advance(1); expect(king.commands()).toContainEqual(['field', 'king', 'request', 1]);
  king.advance(1.2);
  expect(get(king, 'king.mode')).toBe(5);
  king.advance(1); expect(king.commands()).toContainEqual(['field', 'king', 'request', 2]);
  set(king, { 'king.rings': 0 }); king.advance(.2); expect(get(king, 'king.mode')).toBe(7);
  const summoned=await encounter('pine-hollow','king',[150,0,-30],[155,0,-30]);
  summoned.set(summoned.made,{'king.mode':3,'king.phase':1,'king.burst-cd':8,'king.summon-cd':0});
  summoned.made.send('start');summoned.made.advance(.2);
  expect(summoned.get(summoned.made,'king.mode')).toBe(8);summoned.made.advance(1.7);
  expect(summoned.made.commands()).toContainEqual(['field','king','request',3]);
  summoned.set(summoned.made,{'king.phase':2});summoned.made.send('threshold','king',2);summoned.made.advance(1.4);
  expect(summoned.made.commands()).toContainEqual(['field','king','request',4]);
  const saved = king.save(), resumed = await encounter('pine-hollow', 'king', [150, 0, -30], [155, 0, -30]);
  resumed.made.restore(saved); expect(resumed.made.host.metrics()[0]?.calls).toBe(0);
  for (const owner of [king, resumed.made]) { owner.advance(.4); owner.send('death', 'king'); }
  expect(resumed.made.save()).toEqual(king.save()); expect(get(king, 'king.mode')).toBe(2);
  for (const owner of [king, resumed.made,summoned.made]) {expect(owner.host.metrics()[0]).toMatchObject({ refusals: 0, disabled: false });expect(owner.maxFuel()).toBeLessThan(400_000);}
}, 10_000);
