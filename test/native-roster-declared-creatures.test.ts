// ONE-FORMAT OF23b: a native roster runs declared spawns beside it. Pine Hollow runs as a native assembly whose
// `population.roster` host stands its bodies; OF22b0 made an assembly stand declared spawns after its hosts, proven on
// Driftwood's mixed population. This proves it on Pine's roster with Pine's own species as rows (shard-pine-hollow OF23a,
// `fixtures/pine-of23b-rows.json`): a deer that hunts with only the motion numbers it authors (walk and trample; the
// charge, windup and ring stay the hunt's own) and a boar with all five stand from the level beside the roster's bodies,
// tick, and save and restore exactly; a declared id the roster already stands refuses.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { populationCensus } from '../src/shared/game/population/census';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

const rows = JSON.parse(readFileSync('test/fixtures/pine-of23b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Spawn = ShardCreatures['spawns'][number];
const DEER = 'of23b.deer', BOAR = 'of23b.boar', TICKS = 600;
/** where the player holds: between the two declared bodies, a few metres from Pine's spawn */
const HOLD = [0, -228] as const;

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  // the files a server reads (a Ring 1 slice carries only these)
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped shard with Pine's deer and boar rows declared (parsed on an empty shard); its `files` stay the product's. */
function declaring(source: Shardfile, spawns: readonly Spawn[]): Shardfile {
  const base = emptyShardfile({ slug: 'of23b-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = rows.rows.species.map(row => ({ id: `pine.look.${row.kind}`, species: row.id, recipe: 'of23b.rig', material: null,
    parameters: {}, animation: { recipe: 'of23b.clips', parameters: {} } }));
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species: rows.rows.species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains, spawns } });
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: parsed.creatures };
}
const spawnRows = (ids: readonly [string, string]): Spawn[] => [[3, -234], [-3, -234]].map(([x, z], index) => {
  const species = rows.rows.species[index]; if (species === undefined || x === undefined || z === undefined) throw new Error('Missing converted species');
  return { id: ids[index], species: species.id, variant: species.variants[0]?.id ?? '', brain: null, strike: null, seed: 11 + index, scale: 1,
    at: [x, 0, z], yaw: 0 } as Spawn;
});
function resident(fixture: Shipped, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
}
interface Frame { readonly x: number; readonly y: number; readonly z: number; readonly state: string }
function frame(host: SimHost, id: string): Frame {
  const actor = host.entities.get(id); if (actor === undefined) throw new Error(`Missing body ${id}`);
  return { x: actor.position.x, y: actor.position.y, z: actor.position.z, state: actor.state };
}
function hold(host: SimHost): void {
  const player = leadPlayer(host), [x, z] = HOLD;
  player.position.set(x, host.groundHeightAt(x, z), z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
  player.health.attributes.health = player.health.attributes.maxHealth;
}
function run(live: NativeHeadlessResident, ticks: number): Frame[][] {
  const frames: Frame[][] = [];
  for (let tick = 0; tick < ticks; tick++) { hold(live.host); live.step([]); frames.push([DEER, BOAR].map(id => frame(live.host, id))); }
  return frames;
}

test("Pine's native roster stands declared spawns beside its bodies, ticks them, and saves and restores them exactly", async () => {
  const fixture = await shipped(), bare = await resident(fixture, fixture.shard);
  const roster = populationCensus(bare.host).alive; bare.dispose();
  const shard = declaring(fixture.shard, spawnRows([DEER, BOAR]));
  const live = await resident(fixture, shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    // the declared bodies stand from the level, named by Pine's species, beside every body the roster stands
    expect(live.host.entities.get(DEER)?.species).toBe('pine.creature.deer');
    expect(live.host.entities.get(BOAR)?.species).toBe('pine.creature.boar');
    expect(populationCensus(live.host).alive).toBe(roster + 2);
    const frames = run(live, TICKS);
    const moved = (i: number): number => { const s = frames[0]?.[i], e = frames[TICKS - 1]?.[i]; return s === undefined || e === undefined ? 0 : Math.hypot(e.x - s.x, e.z - s.z); };
    // a player six metres ahead of both, standing still: the deer notices them (its hunt's awareness meter), the boar bolts
    expect(frames.some(row => row[0]?.state === 'alert')).toBe(true); expect(moved(1)).toBeGreaterThan(5);
    // a save mid-run restores the declared bodies and the roster's exactly; both go on the same
    restored = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    const again = restored;
    expect(run(again, 300)).toEqual(run(live, 300));
    expect(canonicalSimDigest(snapshotSimHost(again.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    expect(populationCensus(again.host)).toEqual(populationCensus(live.host));
  } finally { restored?.dispose(); live.dispose(); }
}, 240_000);

test('a declared spawn on a body the roster stands refuses: one body, one owner', async () => {
  const fixture = await shipped();
  await expect(resident(fixture, declaring(fixture.shard, spawnRows(['creature:7', BOAR])))).rejects.toThrow(/one body, one owner/u);
}, 120_000);
