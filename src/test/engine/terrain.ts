import { bindHeightfield, captureHeightfield, HeightfieldBinding } from '../../shared/engine/world/Heightfield';
import type { TerrainField } from '../../shared/engine/level/data';
import type { LevelSpec } from '../../shared/engine/level/spec';
import { bindLevelSelection } from '../../shared/engine/level/selection';
import { flatTerrainField } from '../../shared/engine/world/groundField';

type TerrainOverride = Partial<Pick<TerrainField, 'heightAt' | 'normalAt' | 'splatAt' | 'trailDistance' | 'cabinMask' | 'pondMask' | 'waterLevel' | 'streamAt'>>;

/** A renderer-free level for query-only fixtures; release both retained bindings after use. */
export function bindFlatTerrain(over: TerrainOverride = {}): () => void {
  const terrain = { ...flatTerrainField(0, { trailDistance: () => Infinity, cabinMask: () => 0,
    pondMask: () => 0, waterLevel: () => -100, streamAt: () => null, trails: [], cabinSites: [], pond: null }), ...over };
  const level: LevelSpec = {
    id: 'test-ground', ground: { terrain }, spawn: { x: 0, z: 0, yaw: 0 },
    sky: { sunColor: [1, 1, 1], sunIntensity: 0, envIntensity: 0, bgIntensity: 0,
      fogSunColor: [1, 1, 1], cloudSunColor: [1, 1, 1], hemiSky: 0, hemiGround: 0, hemiIntensity: 0 },
    atmosphere: { fogHeight: 0, fogHeightFalloff: 0, fogHeightDensity: 0, fogDistDensity: 0, volumetricSunColor: [1, 1, 1] },
    grade: { saturation: 0, brightness: 0, contrast: 0, bloomIntensity: 0, bloomThreshold: 1,
      shadowTint: [1, 1, 1], highTint: [1, 1, 1], lift: [0, 0, 0], gain: [1, 1, 1], gamma: 1 },
    budgets: {}, mechanisms: [], fight: {}, boot: { files: [] }, audio: { ambience: 'none', score: 'none' },
    loadout: { weapons: [], tools: [], start: [] }, species: [], spawns: [], minimap: {}, kitLook: 'toon',
  };
  const releaseLevel = bindLevelSelection(level);
  const releaseTerrain = bindHeightfield(new HeightfieldBinding(level));
  return () => { releaseTerrain(); releaseLevel(); };
}
/** Tests use the same retained-frame binding as resident worlds; no runtime test override remains. */
export function overrideTerrain(over: TerrainOverride): () => void {
  const current = captureHeightfield();
  return bindHeightfield(new HeightfieldBinding({ ...current.level,
    ground: { ...current.level.ground, terrain: { ...current.base, ...over } } }));
}
