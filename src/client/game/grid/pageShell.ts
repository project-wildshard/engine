import type { LevelSpec } from '@wildshard/engine/level/spec';
import { configureLevel, selectedLevel } from '@wildshard/engine/level/selection';
import { type ShardContext, type PageMode, ShardPlugin } from '../plugin/context';

import type { ShardManifest } from '../shard/manifest';
import { toLevelSpec } from '../shard/spec';
import { EmptyEquipment } from '../shardfile/emptyEquipment';
import { emptyLook } from '../shardfile/emptyLook';
import { ROAD_SKY } from './frameModel';
import type { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';


/** G226/G258: every grid home is an owned region, so leaving it releases the whole world before the next loads; the page
 * is the neutral shell (T7: no grid page boots a borrowed home world, and nothing caps the live worlds by count). A home
 * that cannot be owned (neither admitted data nor a compiled client page) refuses to boot. Standalone pages: false. */
export function useOwnedGridHome(mode: PageMode, manifest: Pick<ShardManifest, 'slug' | 'clientPlanRuntime' | 'gridShardfile'>, source?: Parameters<typeof hasDeclaredClientPage>[0]): boolean {
  if (mode !== 'grid') return false;
  const owned = manifest.clientPlanRuntime === true && manifest.gridShardfile !== undefined
    || source !== undefined && source.runtime !== undefined;
  if (!owned) throw new Error(`Grid home ${manifest.slug} cannot be an owned region (no admitted data or compiled client page)`);
  return true;
}

/**
 * G226: the page owns the renderer, player and platform controls, never an opaque home world. Keep only identity and
 * scalar presentation data here: the original manifest remains in the catalogue and its owned region builds its
 * terrain, creatures, equipment and hooks through the ordinary trusted factory. Standalone boots never use this copy.
 */
export function gridPageShell(source: ShardManifest): ShardManifest {
  const { slug, api, order, status, name, label, seed, biome, blurb, card, sky, atmosphere, grade, style, weapon, spawn } = source;
  const tools = [...(source.loadout?.tools ?? [])];
  return {
    slug, api, order, status, name, label, seed, biome, blurb, card, style, weapon, spawn: { ...spawn },
    treeCount: 0, ground: { structures: true }, trees: { factory: 'none', noun: 'trees' }, spawns: [], species: [],
    sky: { sunColor: sky.sunColor, sunIntensity: sky.sunIntensity, envIntensity: sky.envIntensity,
      bgIntensity: sky.bgIntensity, fogSunColor: sky.fogSunColor, cloudSunColor: sky.cloudSunColor,
      hemiSky: sky.hemiSky, hemiGround: sky.hemiGround, hemiIntensity: sky.hemiIntensity },
    render: () => Promise.resolve(emptyLook(null, ROAD_SKY.void)), // G630: the void past the grid floor is blue-violet
    atmosphere, grade, audio: { ambience: 'legacy', score: 'legacy' },
    boot: { files: () => [], precache: [], sources: () => ({ sky: [], baked: [], terrain: [], trees: [], physics: [], cabins: [], props: [], art: [], music: [], sfx: [] }) },
    loadout: { weapons: [], tools, start: tools.filter(id => source.loadout?.start.includes(id)) },
    ...(source.tiers === undefined ? {} : { tiers: source.tiers }),
    ...(source.camera === undefined ? {} : { camera: source.camera }),
  };
}

/** The neutral page cannot read a home terrain/navmesh bake merely because it keeps the picker's identity. */
export function gridPageShellLevel(shell: ShardManifest): LevelSpec {
  return { ...toLevelSpec(shell), id: 'platform.grid', boundary: { visible: false, walls: false } };
}

/** Select the neutral engine level before its staged boot; catalogue identity and each resident's frame stay separate. */
export function selectGridPageShell(shell: ShardManifest): () => void {
  const previous = selectedLevel(), level = gridPageShellLevel(shell);
  if (previous === null) throw new Error('Grid shell requires a configured page level');
  configureLevel(level);
  return () => { if (selectedLevel() === level) configureLevel(previous); };
}

/** Mandatory shell equipment is inert; actual shard equipment lives only in the owned region's kit scope. */
export class GridPageShellPlugin extends ShardPlugin {
  override kit(context: ShardContext): void {
    const runtime = context.game.runtime;
    if (runtime === undefined) throw new Error('Grid page shell requires its staged runtime');
    runtime.buildEquipment = () => Promise.resolve({ primary: new EmptyEquipment(), rifle: null, secondary: null });
  }
}
