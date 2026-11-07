import type { TerrainField, CabinSite, Vec2 } from '../level/data';
import { buildTerrainMetadata } from './terrainField';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';

/** A required manifest ground: `key` names it to the session's required-ground loader; the selected level supplies the same seed. */
export interface BakedTerrainSource { readonly key: string; readonly seed: number }
/** Authored metadata and native water/trail laws, independent of the height lattice. */
export type BakedTerrainMetadata = Omit<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'>;
/** Data-only terrain metadata. Optional pond samples use the same native lattice law as height queries. */
export interface BakedTerrainRows {
  readonly water: number;
  readonly trails: Vec2[][];
  readonly cabinSites: CabinSite[];
  readonly pond?: { x: number; z: number; r: number };
  readonly mask?: { readonly res: number; readonly size: number; readonly values: Float32Array };
}
/** The unshifted samples a required-ground loader admits for one declaration, and the seed they were authored under. */
export interface RequiredGround extends Pick<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'> { readonly seed: number }
/**
 * The session's required-ground port: it admits a declared ground's samples from wherever its owner keeps them, or rejects,
 * which refuses the level. The engine names no source of bytes.
 */
export type RequiredGroundLoader = (source: BakedTerrainSource) => Promise<RequiredGround>;
interface Declaration { readonly source: BakedTerrainSource; install: (ground: RequiredGround) => void }
const declarations = new WeakMap<TerrainField, Declaration>();
let loader: RequiredGroundLoader | null = null;

/**
 * Declare a required manifest ground without evaluating an analytic landscape.
 * Height/normal/splat reads refuse until the owning boot installs its samples
 * (`loadBakedTerrain` through the session's loader, or a painter's bound ground).
 * Trail, water and datum metadata remain the caller's existing laws.
 * Construction neither loads nor selects a level or installs a service.
 */
export function createBakedTerrainField(source: BakedTerrainSource, input: BakedTerrainMetadata | BakedTerrainRows): TerrainField {
  if ('water' in input && !Number.isFinite(input.water)) throw new Error('Invalid terrain water level');
  const metadata: BakedTerrainMetadata = 'water' in input
    ? buildTerrainMetadata(source.seed, input, () => input.water) : input;
  if ('water' in input && input.mask !== undefined) {
    const { res, size, values } = input.mask;
    if (!Number.isInteger(res) || res < 2 || res > 2048 || !Number.isFinite(size) || size <= 0 || values.length !== res * res
      || !values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Invalid terrain mask lattice');
    metadata.pondMask = bakedSamplers({ res, size, heights: values, seed: source.seed, landscapeHash: 0, splat: new Uint8Array(0), undergrowth: null }).heightAt;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(source.key)
    || !Number.isSafeInteger(source.seed) || source.seed < 0 || source.seed > 0xffffffff
    || !Number.isFinite(metadata.datum ?? 0)) throw new Error('Invalid baked terrain declaration');
  let samples: Pick<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'> | null = null;
  const declared = Object.freeze({ ...source });
  const missing = new Error(`Required baked terrain is not ready: ${source.key}`);
  const read = (): Pick<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'> => { if (samples === null) throw missing; return samples; };
  const datum = metadata.datum ?? 0;
  const field: TerrainField = { ...metadata,
    heightAt: (x, z) => read().heightAt(x, z) + datum,
    normalAt: (x, z, eps) => read().normalAt(x, z, eps),
    splatAt: (x, z) => read().splatAt(x, z),
  };
  declarations.set(field, { source: declared, install: ground => {
    if (ground.seed !== declared.seed) throw new Error(`Required ground ${declared.key}: bad header / seed`);
    if (![ground.heightAt(0, 0), ...ground.normalAt(0, 0), ...ground.splatAt(0, 0)].every(Number.isFinite)) throw new Error('Invalid declared baked terrain samples');
    samples = { heightAt: ground.heightAt, normalAt: ground.normalAt, splatAt: ground.splatAt };
  } });
  return field;
}

/** Required source of this field, or null for the existing analytic terrain path. */
export function bakedTerrainSource(field: TerrainField): BakedTerrainSource | null { return declarations.get(field)?.source ?? null; }
/** Install admitted samples only into the explicitly declared field (their seed must be its own); no level selection occurs. */
export function installDeclaredBakedTerrain(field: TerrainField, ground: RequiredGround): void { declarations.get(field)?.install(ground); }

/**
 * Install the session's required-ground loader (E434: the game session calls this; importing the module installs nothing).
 * Returns the restore, which puts back the loader it replaced.
 */
export function installRequiredGroundLoader(next: RequiredGroundLoader): () => void {
  const previous = loader;
  loader = next;
  return () => { if (loader === next) loader = previous; };
}

/** Admit a declared ground's samples through the installed loader; with none installed the level is refused. */
export function loadRequiredGround(source: BakedTerrainSource): Promise<RequiredGround> {
  if (loader === null) return Promise.reject(new Error(`No required ground loader is installed for ${source.key}`));
  return loader(source);
}
