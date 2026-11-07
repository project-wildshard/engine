import * as v from 'valibot';
import { PopulationEnvironmentSchema, PopulationFieldSchema } from '@wildshard/format/populationEnvironment';
import { readScalarLattice } from '@wildshard/engine/world/scalarChannel';
import { GrassField, populationMeadow } from '../../../shared/game/systems/looks/grassField';
import { TrampleField } from '../../../shared/game/systems/looks/trampleField';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import type { BakedGrid } from '@wildshard/format/bakedTerrainBytes';
import { terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import type { HuntGround, HuntTree } from '@wildshard/engine/ai/hunt';
import { TreeGrid } from '@wildshard/engine/world/forest/placement';
import { buildTerrainMetadata } from '@wildshard/engine/world/terrainField';
import { declaredWaterBody } from '@wildshard/engine/world/water/declared';
import type { SimHost } from '@wildshard/engine/sim';

/** Wander observations are published by the built-in shelter before roster decisions. */
export interface NativePopulationEnvironment extends HuntGround { readonly wanderGoals: ({ x: number; z: number; r: number } | null)[] }
const installed = new WeakMap<SimHost, Map<string, NativePopulationEnvironment>>();
/** Resolve an immutable native habitat installed on this host. Missing ids refuse. */
export function populationEnvironment(host: SimHost, id: string): NativePopulationEnvironment {
  const ground = installed.get(host)?.get(id);
  if (ground === undefined) throw new Error(`Missing native population environment: ${id}`);
  return ground;
}


/** Install exact ground, ordered trunk and projected-water observations from data.
 * No terrain, weather, actor or shard callback crosses this boundary. Both triangle
 * and bilinear profiles use the existing native lattice samplers, without a copy. */
export function installPopulationEnvironment(host: SimHost, grid: Pick<BakedGrid, 'res' | 'size' | 'heights'>, input: unknown): void {
  const rows = v.parse(PopulationEnvironmentSchema, input);
  if (!Number.isInteger(grid.res) || grid.res < 2 || grid.res > 1024 || grid.heights.length !== grid.res*grid.res || grid.size !== rows.chunkHalf*2)
    throw new Error('Invalid native population environment lattice');
  const services = installed.get(host) ?? new Map<string, NativePopulationEnvironment>();
  if (services.has(rows.id)) throw new Error('Duplicate native population environment');
  const tile = { resolution: grid.res, size: grid.size, x: -grid.size/2, z: -grid.size/2, heights: grid.heights };
  const heightAt = rows.sampling === 'column-triangles'
    ? (x: number, z: number): number => terrainTileHeight(tile, x, z, { layout: 'column-major', boundary: 'clamp' })
    : bakedSamplers({ ...grid, seed: rows.seed, landscapeHash: 0, splat: new Uint8Array(0), undergrowth: null }).heightAt;
  const stream = rows.stream === null ? null : declaredWaterBody(rows.stream);
  const field = buildTerrainMetadata(rows.seed, { trails: rows.trails ?? [], cabinSites: rows.cabins.map(row => ({ ...row, rot: 0 })),
    ...(rows.pond === null ? {} : { pond: rows.pond }), ...(stream === null ? {} : { streamAt: stream.restAt }) }, () => rows.water);
  const trees = new TreeGrid<HuntTree>();
  for (const [x, z, r] of rows.trees) trees.add({ x, z, r });
  const epsilon = rows.normalEpsilon;
  const ground: NativePopulationEnvironment = {
    wanderGoals: [],
    heightAt, normalY: (x, z) => {
      const nx = heightAt(x-epsilon,z)-heightAt(x+epsilon,z), nz = heightAt(x,z-epsilon)-heightAt(x,z+epsilon);
      return 2*epsilon/Math.hypot(nx,2*epsilon,nz);
    },
    trailDistance: rows.trails === null ? () => { throw new Error('Native population environment has no trails'); } : field.trailDistance,
    cabinMask: field.cabinMask, inChunk: (x, z, margin) => Math.abs(x) <= rows.chunkHalf-margin && Math.abs(z) <= rows.chunkHalf-margin,
    streamAt: (x, z) => stream === null ? null : stream.restAt(x, z), waterLevel: () => rows.water, pond: () => rows.pond,
    sea: () => rows.sea, wetAt: () => false, trees: (x,z,r) => trees.nearby(x,z,r), treeless: () => rows.trees.length === 0,
    terrain: () => true, chunkHalf: rows.chunkHalf,
  };
  services.set(rows.id, ground); installed.set(host, services);
  host.scope.onDispose(() => { services.delete(rows.id); });
}

/** G474 renderer-free grass, water and hunt observations. This concrete owner
 * accepts data only and retains no shard query, clock or placement callbacks. */
export class NativePopulationField {
  readonly grass: { field: GrassField; trample: TrampleField };
  readonly hunt: HuntGround;
  readonly trees: TreeGrid<{ x: number; z: number; r: number; top: number; }> = new TreeGrid<{ x: number; z: number; r: number; top: number }>();
  readonly queries: { normalY: (x: number,z: number) => number; surfaceAt: (x: number,z: number) => number | null; inBounds: (x: number,z: number,margin: number) => boolean };
  constructor(grid: BakedGrid, input: unknown, treeRows: readonly (readonly [number,number,number])[], tops: readonly number[], pondBlock?: { readonly file: string; readonly bytes: Uint8Array }, wetBlock?: { readonly file: string; readonly bytes: Uint8Array }) {
    const rows = v.parse(PopulationFieldSchema,input), sample = bakedSamplers(grid), world = rows.world;
    if (grid.size !== world.size || grid.seed !== rows.seed || tops.length !== treeRows.length) throw new Error('Incompatible native population field');
    const blocks = new Map(pondBlock === undefined ? [] : [[pondBlock.file,pondBlock.bytes]]);
    if(wetBlock!==undefined){if(blocks.has(wetBlock.file))throw new Error('Duplicate native scalar block');blocks.set(wetBlock.file,wetBlock.bytes);}
    const channel = (data: typeof world.pond): ((x: number,z: number) => number) => readScalarLattice({ res: world.res,size: world.size,values: typeof data === 'string' ? { type: 'f32',count: world.res*world.res,data } : data },blocks);
    const pond = channel(world.pond), wet = channel(world.wet), meta = buildTerrainMetadata(rows.seed,{ trails: rows.trails,cabinSites: [] },() => world.water);
    treeRows.forEach(([x,z,r],index) => { const top = tops[index]; if (top === undefined || ![x,z,r,top].every(Number.isFinite)) throw new Error('Invalid population tree'); this.trees.add({ x,z,r,top }); });
    this.queries = { normalY: (x,z) => sample.normalAt(x,z)[1],surfaceAt: (x,z) => pond(x,z) > 0 ? world.water : null,
      inBounds: (x,z,margin) => Math.abs(x) < world.size/2-margin && Math.abs(z) < world.size/2-margin };
    this.grass = { field: new GrassField({ seed: rows.seed,half: world.size/2,heightAt: sample.heightAt,normalAt: sample.normalAt,splatAt: sample.splatAt,
      trailDistance: meta.trailDistance,cabinMask: meta.cabinMask,pondMask: pond,waterLevel: meta.waterLevel,paint: () => false,
      layout: populationMeadow(rows) }),trample: new TrampleField() };
    this.hunt = { heightAt: sample.heightAt,normalY: this.queries.normalY,trailDistance: meta.trailDistance,cabinMask: meta.cabinMask,
      inChunk: (x,z,margin) => Math.abs(x) <= world.size/2-margin && Math.abs(z) <= world.size/2-margin,
      streamAt: () => null,waterLevel: meta.waterLevel,pond: () => null,sea: () => false,wetAt: (x,z) => wet(x,z) > .5,
      trees: (x,z,r) => this.trees.nearby(x,z,r),treeless: () => false,terrain: () => true,chunkHalf: world.size/2 };
  }
}
