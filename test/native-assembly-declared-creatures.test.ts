// ONE-FORMAT OF22b0: a native assembly stands declared creature rows. Driftwood runs as a native assembly (its plan's 14
// hosts, `server/native-assembly.json`), so its creatures can only move to rows (OF22b) once that path stands and drives
// declared spawns beside its hosts, as OF19b0 made the runtime-plan path do. The fixture is the shipped Driftwood product
// with OF11a's converted Dunes ray and strider (`fixtures/dunes-of11b-rows.json`) declared on the island: they stand and
// tick on the native resident beside the mixed population's keeper bodies, save and restore exactly, and a declared id
// one of the assembly's hosts already stands refuses.
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
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { populationCensus } from '../src/shared/game/population/census';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

const rows = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Spawn = ShardCreatures['spawns'][number];
const RAY = 'of22b0.ray', STRIDER = 'of22b0.strider', TICKS = 600;

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  // the files a server reads (a Ring 1 slice carries only these)
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped shard with the converted ray and strider declared (parsed on an empty shard, so their defaults are the
 *  format's); its `files` stay the product's, so its output descriptor and sections are the shipped ones. */
function declaring(source: Shardfile, spawns: readonly Spawn[]): Shardfile {
  const base = emptyShardfile({ slug: 'of22b0-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = rows.rows.species.map(row => ({ id: `sunscar.look.${row.kind}`, species: row.id, recipe: 'of22b0.rig', material: null,
    parameters: {}, animation: { recipe: 'of22b0.clips', parameters: {} } }));
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species: rows.rows.species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains, spawns } });
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] },
    // Driftwood rev 7 declares its own roster: the pair stands beside it
    creatures: { ...source.creatures, brains: [...source.creatures.brains, ...parsed.creatures.brains], spawns: [...source.creatures.spawns, ...parsed.creatures.spawns] } };
}
const spawnRows = (ids: readonly [string, string]): Spawn[] => [[8, -75], [10, -50]].map(([x, z], index) => {
  const species = rows.rows.species[index]; if (species === undefined || x === undefined || z === undefined) throw new Error('Missing converted species');
  return { id: ids[index], species: species.id, variant: 'dusk', brain: species.temperament?.brain ?? null, strike: null, seed: 11 + index, scale: 1,
    at: [x, 0, z], yaw: 0, ...(species.kind === 'duneStrider' ? { phaseOffset: 0 } : {}) } as Spawn;
});
function resident(fixture: Shipped, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
}
interface Frame { readonly x: number; readonly y: number; readonly z: number; readonly attack: number; readonly state: string }
function frame(host: SimHost, id: string): Frame {
  const actor = host.entities.get(id); if (actor === undefined) throw new Error(`Missing body ${id}`);
  return { x: actor.position.x, y: actor.position.y, z: actor.position.z, attack: actor.attackPhase, state: actor.state };
}
/** The player stands between the two, in reach of both, kept alive. */
function hold(host: SimHost): void {
  const player = leadPlayer(host);
  player.position.set(9, host.groundHeightAt(9, -62), -62); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
  player.health.attributes.health = player.health.attributes.maxHealth;
}
function run(live: NativeHeadlessResident, ticks: number): Frame[][] {
  const frames: Frame[][] = [];
  for (let tick = 0; tick < ticks; tick++) { hold(live.host); live.step([]); frames.push([RAY, STRIDER].map(id => frame(live.host, id))); }
  return frames;
}

test('Driftwood\'s native assembly stands declared spawns beside its keeper bodies, ticks them, and saves and restores them exactly', async () => {
  const fixture = await shipped(), shard = declaring(fixture.shard, spawnRows([RAY, STRIDER]));
  const live = await resident(fixture, shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    // the declared bodies stand from the level, named by their species, beside every keeper body the mixed population stands
    expect(live.host.entities.get(RAY)?.species).toBe('sunscar.creature.duneRay');
    expect(live.host.entities.get(STRIDER)?.species).toBe('sunscar.creature.duneStrider');
    expect(populationCensus(live.host).alive).toBe(34 + 2);
    const frames = run(live, TICKS);
    const moved = (i: number): number => { const s = frames[0]?.[i], e = frames[TICKS - 1]?.[i]; return s === undefined || e === undefined ? 0 : Math.hypot(e.x - s.x, e.z - s.z); };
    expect(moved(0)).toBeGreaterThan(5); expect(moved(1)).toBeGreaterThan(1);
    expect(frames.some(row => row.some(f => f.attack > 0))).toBe(true);
    // a save mid-run restores the declared bodies, their brains and clocks, and the keeper's, exactly; both go on the same
    restored = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    const again = restored;
    expect(run(again, 300)).toEqual(run(live, 300));
    expect(canonicalSimDigest(snapshotSimHost(again.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    expect(populationCensus(again.host)).toEqual(populationCensus(live.host));
  } finally { restored?.dispose(); live.dispose(); }
}, 180_000);

// The refusal of a declared id an assembly host already stood left with the population hosts (OF22c3): no host stands a body.
