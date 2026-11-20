// ONE-FORMAT OF23c: Pine's herds are declared spawns (shard-pine-hollow `39d7083`), so the shelter host
// (`population.shelter`) must shelter them as it sheltered the roster's herds: declared hunt bodies sharing a spawn
// `group` are one herd, rain picks it a big tree, and its bodies walk in under it. A group a script owns (an elite
// program's main, a spawn script's thralls) is the script's, never a herd. Proven on the pinned Pine product with Pine's
// own deer row declared beside its roster, rain held on, and a save mid-shower restoring exactly.
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
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

const rows = JSON.parse(readFileSync('test/fixtures/pine-of23b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Spawn = ShardCreatures['spawns'][number];
interface ShelterRows { readonly step: string; readonly weather: string }
interface ShelterSave { readonly shelters: readonly ({ readonly spot: { readonly x: number; readonly z: number } | null } | null)[] }
/** r6's herd 29 stood here, mid-forest; Pine's big pines are within the shelter's reach */
const HERD = [12, 7] as const, PLAYER = [12, 57] as const, TICKS = 7200;

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const shelter = await product.json('actors/shelter.json') as ShelterRows;
  return { product, shard, assets, rapier, shelter };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped shard with Pine's deer row declared (parsed on an empty shard); its `files` stay the product's. */
function declaring(source: Shardfile, spawns: readonly Spawn[]): Shardfile {
  const base = emptyShardfile({ slug: 'of23c-herds', name: 'Herds', author: 'Test', revision: 1, seed: 7 });
  const looks = rows.rows.species.map(row => ({ id: `pine.look.${row.kind}`, species: row.id, recipe: 'of23b.rig', material: null,
    parameters: {}, animation: { recipe: 'of23b.clips', parameters: {} } }));
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species: rows.rows.species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains, spawns } });
  // Pine r8 (pinned 4b49472a7) ships its own deer and boar rows and declares its herds: its rows stand, the fixture adds only
  // the rows it lacks, and the test's spawns stand beside r8's
  const own = new Set(source.rows.species.map(row => row.id)), added = parsed.rows.species.filter(row => !own.has(row.id));
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...added], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks.filter(row => added.some(species => species.id === row.species))] },
    creatures: { ...source.creatures, brains: [...source.creatures.brains, ...parsed.creatures.brains], spawns: [...source.creatures.spawns, ...parsed.creatures.spawns] } };
}
const deer = rows.rows.species.find(row => row.kind === 'deer');
if (deer === undefined) throw new Error('Missing Pine deer row');
const herd = (group: string): Spawn[] => [[0, 0], [3, 2], [-2, 3]].map(([dx = 0, dz = 0], index) => ({
  id: `of23c.deer.${String(index)}`, species: deer.id, variant: deer.variants[0]?.id ?? '', brain: null, strike: null, seed: 21 + index, scale: 1,
  at: [HERD[0] + dx, 0, HERD[1] + dz], yaw: 0, group }) as Spawn);

function resident(fixture: Shipped, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
}
/** a shower that never lets up, answered after the native weather's own answer */
function raining(host: SimHost, weather: string): void {
  host.events.answer('weather.rain', request => request.id === weather ? { ...request, rain: 1 } : request, host.scope);
}
function hold(host: SimHost): void {
  const player = leadPlayer(host), [x, z] = PLAYER;
  player.position.set(x, host.groundHeightAt(x, z), z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
  player.health.attributes.health = player.health.attributes.maxHealth;
}
const shelters = (host: SimHost, step: string): ShelterSave => {
  const adapter = host.adapters.get(step) as { snapshot: () => unknown } | undefined;
  if (adapter === undefined) throw new Error(`Missing shelter step ${step}`);
  return adapter.snapshot() as ShelterSave;
};
const members = (host: SimHost): { x: number; z: number }[] => [0, 1, 2].map(index => {
  const body = host.entities.get(`of23c.deer.${String(index)}`); if (body === undefined) throw new Error('Missing declared deer');
  return { x: body.position.x, z: body.position.z };
});
const nearest = (points: readonly { x: number; z: number }[], spot: { x: number; z: number }): number =>
  Math.min(...points.map(point => Math.hypot(point.x - spot.x, point.z - spot.z)));

test('rain shelters a declared herd under a big tree and its bodies walk in; a save mid-shower restores exactly', async () => {
  const fixture = await shipped(), bare = await resident(fixture, fixture.shard);
  raining(bare.host, fixture.shelter.weather); bare.step([]);
  const rosterHerds = shelters(bare.host, fixture.shelter.step).shelters.length; bare.dispose();
  const shard = declaring(fixture.shard, herd('of23c.herd'));
  const live = await resident(fixture, shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    raining(live.host, fixture.shelter.weather);
    for (let tick = 0; tick < 60; tick++) { hold(live.host); live.step([]); }
    // the declared group is one more herd beside the roster's, and the shower picks it a shelter
    const early = shelters(live.host, fixture.shelter.step).shelters;
    expect(early).toHaveLength(rosterHerds + 1);
    const spot = early[rosterHerds]?.spot;
    expect(spot).toBeTruthy();
    if (spot === undefined || spot === null) throw new Error('No shelter for the declared herd');
    const before = nearest(members(live.host), spot);
    for (let tick = 0; tick < TICKS; tick++) { hold(live.host); live.step([]); }
    // its bodies walk in under the tree: one stands within the shelter's 3.5 m spot (and a little), nearer than they began
    const after = nearest(members(live.host), spot);
    expect(after).toBeLessThan(Math.min(before, 6));
    // a save mid-shower restores the herd's shelter and bodies exactly, and both go on the same
    restored = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    raining(restored.host, fixture.shelter.weather);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    for (let tick = 0; tick < 120; tick++) { hold(live.host); hold(restored.host); live.step([]); restored.step([]); }
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
  } finally { restored?.dispose(); live.dispose(); }
}, 240_000);
