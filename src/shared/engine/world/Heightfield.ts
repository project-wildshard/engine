import { setTerrainDatum, setTerrainHeight, setTerrainPlacement } from './terrainHeight';
import { terrainFieldFor } from './groundField';
import type { PondDef, TerrainField } from '../level/data';
import type { LevelSpec } from '../level/spec';
import { activeLevel, onLevelChange, selectedLevel } from '../level/selection';
// The level's terrain shape. Pure functions so the same field drives the mesh,
// player collision, tree placement and grass.
//
// The field itself is the selected level's `LevelSpec.ground.terrain` (compiled by src/shared/engine/world/terrainField.ts);
// this module re-exports it under the names every consumer already imports. The exports are live `let` bindings
// resolved when a level is configured (src/shared/engine/level/selection.ts) and again on every level change — no per-call
// lookup, so heightAt() stays as cheap as before. Read before any level is configured, a function resolves the active
// level on its first call.
import { CHUNK_HALF } from '../core/config';

const NO_POND: PondDef = { x: 0, z: 0, r: 0 };

function terrainOf(level: LevelSpec): TerrainField {
  return terrainFieldFor(level.ground, level.id);
}

let home: HeightfieldBinding | null = null;
const frames: { binding: HeightfieldBinding }[] = [];

/** A retained analytic/baked terrain in one level's local frame; construction does not select it. */
export class HeightfieldBinding {
  readonly level: LevelSpec;
  readonly base: TerrainField;
  private terrain: TerrainField;
  constructor(level: LevelSpec) {
    this.level = level;
    this.base = terrainOf(level);
    this.terrain = this.base;
  }
  /** Captured builds read this binding even after another frame becomes active. */
  get field(): TerrainField { return this.terrain; }
  /** Install an unshifted native bake using this frame's datum, never the active frame's. */
  install(baked: Pick<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'>): void {
    const datum = this.base.datum ?? 0;
    this.terrain = { ...this.terrain, ...baked, heightAt: datum === 0 ? baked.heightAt : (x, z) => baked.heightAt(x, z) + datum };
    if ((frames.at(-1)?.binding ?? home) === this) publish(this.terrain);
  }
}

/** Capture the active retained field before an async build yields. */
export function captureHeightfield(): HeightfieldBinding {
  const frame = frames.at(-1);
  if (frame !== undefined) return frame.binding;
  home ??= new HeightfieldBinding(activeLevel());
  return home;
}
function field(): TerrainField { return captureHeightfield().field; }

/** Activate a retained field; releases may arrive out of order without restoring a dead frame. */
export function bindHeightfield(binding: HeightfieldBinding): () => void {
  captureHeightfield();
  const entry = { binding };
  frames.push(entry); publish(binding.field);
  return () => {
    const index = frames.indexOf(entry);
    if (index === -1) return;
    frames.splice(index, 1);
    publish(field());
  };
}

const noStream = (): number | null => null;
/** surface height, metres */
export let heightAt: TerrainField['heightAt'] = (x, z) => field().heightAt(x, z);
/** unit surface normal by central differences */
export let normalAt: TerrainField['normalAt'] = (x, z, eps) => field().normalAt(x, z, eps);
/** splat weights for the four ground layers of the level */
export let splatAt: TerrainField['splatAt'] = (x, z) => field().splatAt(x, z);
/** distance to the nearest trail centreline */
export let trailDistance: TerrainField['trailDistance'] = (x, z) => field().trailDistance(x, z);
/** 0 off the cabin pads → 1 on them */
export let cabinMask: TerrainField['cabinMask'] = (x, z) => field().cabinMask(x, z);
/** 0 outside the pond basin → 1 at its centre */
export let pondMask: TerrainField['pondMask'] = (x, z) => field().pondMask(x, z);
/** still-water surface height (far below the terrain when the level has no pond) */
export let waterLevel: TerrainField['waterLevel'] = () => field().waterLevel();
/** running water's surface at (x, z) (a creek), or null off it */
export let streamAt: NonNullable<TerrainField['streamAt']> = (x, z) => (field().streamAt ?? noStream)(x, z);
/** Trail polylines (xz). The first four enter at the edge midpoints. */
export let TRAILS: TerrainField['trails'] = [];
/** The level's cabin pads (x, z and yaw), flattened into its terrain. */
export let CABIN_SITES: TerrainField['cabinSites'] = [];
/** The level's pond (r = 0 when it has none — check `hasPond()`). */
export let POND: PondDef = NO_POND;

/** whether the running level has a pond (`POND` is a zero-size placeholder when it has none) */
export function hasPond(): boolean { return field().pond !== null; }

function publish(T: TerrainField): TerrainField {
  heightAt = T.heightAt; setTerrainHeight(heightAt); normalAt = T.normalAt; splatAt = T.splatAt;
  trailDistance = T.trailDistance; cabinMask = T.cabinMask; pondMask = T.pondMask; waterLevel = T.waterLevel; streamAt = T.streamAt ?? noStream;
  TRAILS = T.trails; CABIN_SITES = T.cabinSites; POND = T.pond ?? NO_POND;
  return T;
}

const initial = selectedLevel();
if (initial !== null) { home = new HeightfieldBinding(initial); publish(home.field); }
else setTerrainHeight(heightAt);
setTerrainPlacement((x, z) => normalAt(x, z), () => waterLevel());
// the field's runtime vertical shift (TerrainField.datum, 0 unless a level is shifted): the authored frame for saved poses
setTerrainDatum(() => field().datum ?? 0);
// a new level rebinds the analytic field (its bake is installed when it loads); the same field configured again keeps
// whatever is bound, an installed bake included
onLevelChange((level) => {
  if (terrainOf(level) !== home?.base || level.id !== home.level.id) {
    home = new HeightfieldBinding(level);
  }
  if (frames.length === 0) publish(home.field);
});

/**
 * The baked grid (src/shared/engine/world/BakedTerrain.ts, public/assets/baked/<slug>/terrain.bin) replaces the
 * analytic field with lookups over the terrain mesh's own vertices — the same numbers the mesh is
 * built from, so collision and planting sit exactly on the rendered surface. A level change
 * rebinds the analytic functions again (the next level's bake is installed when it loads).
 */
export function _installBakedTerrain(baked: Pick<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'>): void {
  captureHeightfield().install(baked);
}

/** whether (x, z) lies inside the level's square, `margin` metres in from its edge */
export function inChunk(x: number, z: number, margin = 0): boolean {
  return Math.abs(x) <= CHUNK_HALF - margin && Math.abs(z) <= CHUNK_HALF - margin;
}
