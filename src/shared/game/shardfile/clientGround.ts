import type { ShardManifest } from '../../../client/game/shard/manifest';
import { bilinearTerrainSamplers, decodeTerrainTile, terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import type { TerrainField } from '@wildshard/engine/level/data';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { decodeMeshCollision, lowestMeshHeight } from '@wildshard/format/meshCollisionBytes';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { splatTerrainOf } from '@wildshard/format/splatTerrain';
import { outputDescriptor } from './outputDescriptor';
import type { TerrainLattice } from '@wildshard/engine/physics/terrain';

/** Keep temporary byte readers outside the context retained by height/normal/water callbacks. */
function samplingQueries(profile: NonNullable<NonNullable<Shardfile['terrain']>['sampling']>, assets: ReadonlyMap<string, Uint8Array>, nativeDatum?: number) {
  const wire = assets.get(profile.file); if (wire === undefined) throw new Error('Missing admitted terrain sampling profile');
  return bilinearTerrainSamplers(decodeTerrainTile(wire), profile.normalEpsilon, nativeDatum ?? profile.datum);
}

function meshQueries(tiles: NonNullable<Shardfile['meshCollision']>['tiles'], assets: ReadonlyMap<string, Uint8Array>) {
  return tiles.map(row => {
    const wire = assets.get(row.file); if (wire === undefined) throw new Error('Missing admitted mesh terrain queries');
    return { minX: -250 + row.x * 62.5, minZ: -250 + row.z * 62.5, data: decodeMeshCollision(wire) };
  });
}

/** Baked collider samples supply the existing player's terrain queries; they never allocate an analytic collider. */
export function clientGround(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, nativeDatum?: number): TerrainField {
  const rawPlan = hasDeclaredClientPage(source) ? outputDescriptor(source)?.sections.get('sim/runtime-plan') : undefined;
  const ground = rawPlan === undefined ? undefined : parseNativeRuntimePlan(rawPlan).recipe.ground;
  const bytes = source.terrain === null ? undefined : assets.get(source.terrain.collider);
  if (source.terrain !== null && bytes === undefined) throw new Error('Missing admitted terrain queries');
  const data = bytes === undefined || (source.terrain?.form === 'query' && source.terrain.collider === source.terrain.sampling.file) ? null : decodeTerrainTile(bytes);
  const profile = source.terrain?.sampling;
  const queries = profile === undefined ? null : samplingQueries(profile, assets, nativeDatum);
  const mesh = source.meshCollision === null ? undefined : meshQueries(source.meshCollision.tiles, assets);
  const heightAt = (x: number, z: number): number => {
    if (queries === null && mesh === undefined && data === null) return ground?.height ?? 0;
    if (queries !== null && mesh === undefined) return queries.heightAt(x, z);
    if (x < -250 || x > 250 || z < -250 || z > 250) return 0;
    if (mesh !== undefined) {
      let lowest: number | undefined;
      for (const row of mesh) {
        if (x < row.minX || x > row.minX + 62.5 || z < row.minZ || z > row.minZ + 62.5) continue;
        const height = lowestMeshHeight(row.data, x, z);
        if (height !== undefined && (lowest === undefined || height < lowest)) lowest = height;
      }
      // The cube's bottom is a void fallback, never an allocated ground collider.
      return lowest ?? -250;
    }
    return data === null ? 0 : terrainTileHeight(data, x, z);
  };
  return { heightAt, normalAt: queries?.normalAt ?? ((x, z, eps = 0.25) => {
    const dx = heightAt(x - eps, z) - heightAt(x + eps, z), dz = heightAt(x, z - eps) - heightAt(x, z + eps), length = Math.hypot(dx, 2 * eps, dz);
    return [dx / length, 2 * eps / length, dz / length];
  }), splatAt: queries?.splatAt ?? (() => [1, 0, 0, 0]), trailDistance: () => Infinity, cabinMask: () => 0, pondMask: () => 0,
    waterLevel: () => source.water.find((row) => row.kind === 'sea')?.level ?? -250, trails: [], cabinSites: [], pond: null };
}

/**
 * The shard's admitted terrain collider as the page's collider lattice: the server installs exactly these samples
 * (`prepareRuntimeWorld` → `addBakedTerrainCollider`), so the page predicts on them too (NET-LAG NL10). Undefined when the
 * shard declares none or its tile is not the whole chunk centred on the origin (the page's terrain collider always is).
 */
export function colliderLattice(source: Pick<Shardfile, 'terrain'>, assets: ReadonlyMap<string, Uint8Array>): TerrainLattice | undefined {
  const bytes = source.terrain === null ? undefined : assets.get(source.terrain.collider);
  if (bytes === undefined) return undefined;
  const data = decodeTerrainTile(bytes);
  if (data.colours !== undefined || data.x !== -data.size / 2 || data.z !== -data.size / 2) return undefined;
  return { grid: data.heights, res: data.resolution, size: data.size };
}

/** Native pages keep the recipe's real terrain collision policy at both entry points.
 * Structure floors omit a terrain collider; sampled terrain collides on the server's own collider lattice. */
export function clientPageGround(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>): { paths: 'plugin'; terrain: TerrainField; structures?: true; tiled?: true; collider?: TerrainLattice } {
  const plan = parseNativeRuntimePlan(outputDescriptor(source)?.sections.get('sim/runtime-plan'));
  const tiled = source.props !== null && source.props.tiles.length > 0 && splatTerrainOf(source.props) !== undefined;
  const collider = plan.recipe.terrain === 'collider' ? colliderLattice(source, assets) : undefined;
  return { paths: 'plugin', terrain: clientGround(source, assets), ...(plan.recipe.terrain === 'none' ? { structures: true } : {}), ...(tiled ? { tiled: true } : {}), ...(collider === undefined ? {} : { collider }) };
}

/** A props-bound native transition already replaces its whole splat mesh with tiles.
 * Carry that draw ownership into bootstrap, before the discarded mesh loads public texture arrays. */
export function tiledBootstrapGround(ground: ShardManifest['ground'], props: Shardfile['props'], binds: readonly string[]): ShardManifest['ground'] {
  if (ground.tiled === true || !binds.includes('terrain') || !binds.includes('props') || props === null
    || props.tiles.length === 0 || splatTerrainOf(props) === undefined) return ground;
  return { ...ground, tiled: true };
}
