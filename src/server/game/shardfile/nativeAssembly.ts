import { bakedSamplers, parseBakedTerrain } from '@wildshard/engine/world/BakedTerrain';
import { clamp } from '@wildshard/engine/core/noise';
import { readNavmesh } from '@wildshard/engine/physics/navmesh';
import { createSimHost, type SimHost, type SimLevel } from '@wildshard/engine/sim';
import { parseNativeAssembly, NATIVE_ASSEMBLY_FILE, type NativeAssemblyBake, type NativeAssemblyPlan } from '@wildshard/format/nativeAssembly';
import { decodeTerrainTile, terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import { nativeArenaSealSolids } from '../boss/nativeArenaSeal';
import type { ArenaSealDimensions } from '../../../shared/game/boss/arenaCollision';
import { proveTerrainEntries } from '../plugin/mover';
import { trustedLevel } from '../plugin/simulation';
import { createNativeBakeReader, installNativeCollision, nativeBakeGround, type NativeCollisionBake, type NativeCollisionSolid } from '../population/nativeBake';
import { NativePopulationField } from '../population/environment';
import { need, readAssemblyInput, type AssemblyGround, type AssemblyPrepared, type NativeAssemblyContext, type NativeAssemblyPorts } from './nativeAssemblyInput';
import { prepareAssemblyFeature, type AssemblyRun } from './nativeAssemblyHosts';
import { readPatrolIntake } from '../boss/patrolNative';
import { readSlotIntake } from '../boss/slotsNative';
import { readWindIntake } from '../boss/windEliteNative';
import { withEncounters, type EncounterIntake } from '../population/encounterIntake';
import { installNativeHarvest } from '../loot/harvest';
import { prepareReturns } from './nativeRuntimeLoans';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

/** One prepared native world: identical to a typed runtime plan, built from data alone. */
export interface NativeAssemblyRuntime<C extends NativeAssemblyContext> {
  readonly level: SimLevel;
  readonly ports: { readonly ground: false; readonly heightAt: (x: number, z: number) => number };
  readonly install: (host: SimHost, context: C) => void;
  readonly proveEntries: (host: SimHost) => ReturnType<typeof proveTerrainEntries>;
}
/** A world with no population has no bake: no ground lattice and no solids of its own. */
const NO_BAKE: NativeCollisionBake & Readonly<Record<string, unknown>> = { ground: { heights: new Float32Array(0), friction: 0, groups: 0, scale: { x: 0, y: 0, z: 0 }, at: { x: 0, y: 0, z: 0 } }, solids: [] };
/** The bake every population host reads: the reader's rows joined with the plan's owners. Each host admits its fields. */
async function prepareBake(product: ShardProduct, row: NativeAssemblyBake | undefined): Promise<NativeCollisionBake & Readonly<Record<string, unknown>>> {
  if (row === undefined) return NO_BAKE;
  const rows = await readAssemblyInput<Record<string, unknown>>(product, row.rows), ground = { file: row.ground, bytes: await product.file(row.ground) };
  const colliders = await Promise.all(row.colliders.map(async file => ({ file, bytes: await product.file(file) })));
  const reader = createNativeBakeReader(rows, row.reader, ground, colliders);
  const read: NativeCollisionBake = row.read === 'bake' ? reader.read()
    : { ground: nativeBakeGround(rows['ground'] as Parameters<typeof nativeBakeGround>[0], row.reader.resolution, row.reader.size, row.reader.label, ground),
      solids: (rows['solids'] as readonly Parameters<typeof reader.solid>[0][]).map(solid => reader.solid(solid)) };
  const kept = Object.fromEntries((row.keep ?? []).map(name => [name, need(rows[name], `Missing native bake row ${name}`)]));
  const owners = row.owners === undefined ? {} : await readAssemblyInput<Record<string, unknown>>(product, row.owners);
  const picked = row.pick === undefined ? owners : Object.fromEntries(row.pick.map(name => [name, need(owners[name], `Missing native bake owner ${name}`)]));
  const solids: readonly NativeCollisionSolid[] = row.seal === undefined ? read.solids
    : nativeArenaSealSolids(rows, read.solids, await readAssemblyInput<ArenaSealDimensions & { sealId: string; origin: { x: number; y: number; z: number } }>(product, row.seal));
  return { ...kept, ...picked, ...read, solids };
}
async function prepareGround(product: ShardProduct, assets: ReadonlyMap<string, Uint8Array>, plan: NativeAssemblyPlan, bake: NativeCollisionBake): Promise<AssemblyGround> {
  const shard = product.shardfile;
  if (plan.terrain.kind === 'flat') { const { height } = plan.level.ground; return { grid: null, samplers: null, heightAt: () => height }; }
  if (plan.terrain.kind === 'bake-ground') {
    const { resolution, size } = need(plan.bake, 'Bake ground needs its bake').reader, half = size / 2;
    return { grid: null, samplers: null, heightAt: (x: number, z: number): number => terrainTileHeight({ resolution, x: -half, z: -half, size, heights: bake.ground.heights }, x, z, { layout: 'column-major', boundary: 'clamp' }) };
  }
  const grid = plan.terrain.kind === 'baked'
    ? need(parseBakedTerrain(await product.file(plan.terrain.file), plan.terrain.rows as Parameters<typeof parseBakedTerrain>[1]), 'Native assembly requires its baked terrain grid')
    : decodeTerrainTile(need(shard.terrain?.sampling === undefined ? undefined : assets.get(shard.terrain.sampling.file), 'Native assembly requires its terrain tile'), { resolution: plan.terrain.resolution, size: plan.terrain.size, seed: shard.identity.seed });
  const samplers = bakedSamplers(grid);
  return { grid, samplers, heightAt: samplers.heightAt };
}
async function prepareField(product: ShardProduct, plan: NativeAssemblyPlan, grid: AssemblyGround['grid'], bake: NativeCollisionBake & Readonly<Record<string, unknown>>): Promise<Pick<AssemblyPrepared<never>, 'field' | 'world' | 'pond' | 'wet'>> {
  if (plan.field === undefined) return { field: null, world: null, pond: null, wet: undefined };
  const rows = await readAssemblyInput<{ world: { wet: string | { data: string | { file: string } } } }>(product, plan.field.rows), pond = { file: plan.field.pond, bytes: await product.file(plan.field.pond) };
  const wet = rows.world.wet, file = typeof wet === 'string' || typeof wet.data === 'string' ? undefined : wet.data.file;
  const block = file === undefined ? undefined : { file, bytes: await product.file(file) };
  return { pond, wet: block, world: rows.world, field: new NativePopulationField(need(grid, 'A native field needs its terrain grid'), rows, bake['trees'] as readonly (readonly [number, number, number])[], bake['tops'] as readonly number[], pond, block) };
}
const mergedIntake = (a: EncounterIntake, ...more: readonly EncounterIntake[]): EncounterIntake => more.reduce((all, row) => ({ species: [...all.species, ...row.species], recipes: [...all.recipes, ...row.recipes], motorless: [...all.motorless ?? [], ...row.motorless ?? []] }), a);
/** True when this product ships a native-assembly plan. */
export function hasNativeAssembly(product: ShardProduct): boolean { return product.hasFile(NATIVE_ASSEMBLY_FILE); }
/**
 * Build one native world from a product's `server/native-assembly.json` (P1-E3.1b). Every read happens here, so a bad
 * plan refuses before a host exists; `install` is synchronous, in the plan's order, and restores like a typed plan.
 */
export async function prepareNativeAssembly<C extends NativeAssemblyContext>(input: ShardProduct, assets: ReadonlyMap<string, Uint8Array>, ports: NativeAssemblyPorts<C>): Promise<NativeAssemblyRuntime<C>> {
  const preparation = { product: input, assets }, lendReturns = await prepareReturns(preparation);
  const plan = parseNativeAssembly(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await input.file(NATIVE_ASSEMBLY_FILE))));
  const patrol = ports.room === true ? plan.features.find(row => row.host === 'encounter.patrol') : undefined;
  const product = patrol === undefined ? input : await withEncounters(input, mergedIntake(await readPatrolIntake(input, patrol), await readSlotIntake(input, patrol), await readWindIntake(input, patrol.actors)));
  const shard = product.shardfile, bake = await prepareBake(product, plan.bake), ground = await prepareGround(product, assets, plan, bake);
  const navigation = plan.navigation === 'shard' ? assets.get(need(shard.navigation, 'Missing navigation').file) : await product.file(plan.navigation.file);
  const nav = readNavmesh(navigation, 'Native assembly requires its navigation', () => 0);
  const prepared: AssemblyPrepared<C> = { ...ground, ...await prepareField(product, plan, ground.grid, bake), product, assets, ports, plan, bake, nav,
    boot: plan.boot === undefined ? null : await readAssemblyInput(product, plan.boot) };
  const steps = await Promise.all(plan.features.map(feature => prepareAssemblyFeature(feature, prepared)));
  const heightAt = ground.heightAt, speed = plan.level.authorCap === true ? clamp(shard.authorCaps.speed, 0, plan.level.speed) : plan.level.speed;
  const level = trustedLevel(shard, { at: { x: shard.spawn.x, y: Math.max(shard.spawn.y, plan.level.stand ?? heightAt(shard.spawn.x, shard.spawn.z) + 0.1), z: shard.spawn.z }, yaw: shard.spawn.yaw, speed }, plan.level.ground);
  const levelPorts = { ground: false as const, heightAt };
  const walk = (host: SimHost): ReturnType<typeof proveTerrainEntries> => proveTerrainEntries(host.physics, shard.entryways, heightAt, plan.entries.walk as Parameters<typeof proveTerrainEntries>[3]);
  return { level, ports: levelPorts, proveEntries: host => {
    const { fresh, proven } = plan.entries;
    if (proven !== undefined) return proven;
    if (fresh === undefined) return walk(host);
    const proof = createSimHost(level, { ...levelPorts, rapier: ports.rapier });
    try { installNativeCollision(proof, bake, { ...need(plan.collision, 'A fresh entry walk needs its collision'), omit: fresh.omit } as Parameters<typeof installNativeCollision>[2]); proof.step(); return walk(proof); } finally { proof.dispose(); }
  }, install: (host, context) => {
    lendReturns(host);
    const run: AssemblyRun<C> = { host, context, input: null, day: null };
    for (const step of steps) step(run);
    installNativeHarvest(host);
  } };
}
