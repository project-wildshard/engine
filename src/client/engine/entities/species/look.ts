import type * as THREE from 'three';
import type { SpeciesRow } from '../../../../server/engine/ai/species';
import { registeredSpecies, validateCreatureBones, type SpeciesDef, type VariantDef, type BoneDef, type FurStyle } from '../../../../shared/engine/entities/species/registry';
import type { SkyRig as Sky } from '../../world/skyRig';
import type { AnimalMaterial } from '../AnimalFactory';
import type { Scope } from '../../../../shared/engine/app/scope';

export interface EyeSpot { centre: THREE.Vector3; radius: number }
export interface CreatureHull {
  geometry: THREE.BufferGeometry; map: THREE.Texture | null; normalMap: THREE.Texture | null;
  bones: BoneDef[]; overgrown: boolean; doubleSided?: boolean; fur?: Partial<FurStyle>;
  /** `map` as one layer of its hull's coat array (render/layeredMaps.ts): the far herd draws every coat of the hull in one
   *  batch (PF7b); absent when the coats are not one compressed format */
  coatLayer?: { readonly array: THREE.CompressedArrayTexture; readonly layer: number };
}
export interface SpeciesLook extends Pick<SpeciesDef, 'rigContract' | 'fur' | 'build' | 'pose' | 'gait' | 'postPose' | 'rig' | 'animate' | 'damageMul' | 'eyeGlow' | 'eyeGlowIntensity'> {
  id: string; species: string; kind: string;
  /** creature memory a specimen is stood up with in the Model Explorer (a creature that waits hidden is shown risen) */
  standMem?: Readonly<Record<string, number>>;
  variants?: Readonly<Record<string, Pick<VariantDef, 'tint' | 'fur' | 'traits'>>>;
  material?: (sky: Sky, glow?: [number, number, number], intensity?: number) => AnimalMaterial;
  /** with `material` on a low-poly level: the body stays faceted (flat facets, per-facet jitter) in one group, glowing eye
   *  faces marked by an `aGlow` attribute (1 on the eyes) for the material to read; absent, the smooth loft as before */
  faceted?: true;
  /** with a graph `material` (a classic copy drops its compile patches): the body every `material()` copy is made from
   *  (for a species of this eye glow). Every rig whose copies share it draws ONE body; each animal's own copy is its
   *  port (its tint, its hit flash), written into the drawn body before each of its draws. A graph (node) body is built
   *  once per material, so a copy per animal was a node build per animal: 33 frames of Driftwood's road entry on the
   *  Simulator (O15). */
  sharedBody?: (glow?: readonly [number, number, number]) => object;
  /** Decorate the existing instance materials after lighting is installed; preserve their hit-flash owners. */
  decorateMaterials?: (materials: readonly AnimalMaterial[]) => void;
  hasSkin?: (variant: VariantDef) => boolean;
  loadSkin?: (variant: VariantDef) => Promise<void>;
  preload?: () => Promise<void>;
  skin?: (variant: VariantDef, bones: readonly BoneDef[], eyes: readonly EyeSpot[]) => CreatureHull | null;
}

/** The legacy view/body adapter is assembled at the factory boundary, after kit registration. */
export function speciesWithLook(row: SpeciesRow, look: SpeciesLook): SpeciesDef {
  const variant = (value: VariantDef): VariantDef => ({ ...value, ...look.variants?.[value.id] });
  return { ...look, ...row, variants: row.variants.map(variant),
    ...(row.spawnOnly === undefined ? {} : { spawnOnly: row.spawnOnly.map(variant) }) };
}

interface Scoped<T> { value: T; scope: Scope }
/** Row/look registrations are resident-owned; resolution and cached adapters follow the active level. */
export class SpeciesService {
  private readonly rows: Scoped<SpeciesRow>[] = [];
  private readonly looks: Scoped<SpeciesLook>[] = [];
  /** skin work still running (a coat painted in slices), under the level that made the hull */
  private readonly unsettled: Scoped<Promise<void>>[] = [];
  private cache = new WeakMap<Scope, Map<string, SpeciesDef>>();
  private readonly active: () => Scope | null;
  constructor(active: () => Scope | null) { this.active = active; }
  registerRow(value: SpeciesRow, scope: Scope): void { this.add(this.rows, value, scope); }
  registerLook(value: SpeciesLook, scope: Scope): void {
    validateCreatureBones(`${value.species} (${value.kind})`, value.rigContract.sockets);
    this.add(this.looks, value, scope);
  }
  private add<T extends { id: string }>(list: Scoped<T>[], value: T, scope: Scope): void {
    if (scope.disposed) throw new Error('Cannot register species on a disposed scope');
    if (list.some((entry) => entry.scope === scope && entry.value.id === value.id)) throw new Error(`Duplicate species row: ${value.id}`);
    const entry = { value, scope }; list.push(entry); this.cache = new WeakMap();
    scope.onDispose(() => { const i = list.indexOf(entry); if (i !== -1) list.splice(i, 1); this.cache = new WeakMap(); });
  }
  get(kind: string): SpeciesDef | undefined {
    const scope = this.active(); if (scope === null) return undefined;
    const cached = this.cache.get(scope)?.get(kind); if (cached !== undefined) return cached;
    const row = this.rows.slice().reverse().find((entry) => entry.scope.belongsTo(scope) && entry.value.kind === kind)?.value;
    const look = this.looks.slice().reverse().find((entry) => entry.scope.belongsTo(scope) && entry.value.kind === kind)?.value;
    if (row === undefined && look === undefined) return undefined;
    let resolved: SpeciesDef;
    if (row !== undefined && look !== undefined) resolved = speciesWithLook(row, look);
    else {
      const base = registeredSpecies(kind);
      resolved = row !== undefined ? speciesWithLook(row, { ...base, id: `default.look.${kind}`, species: row.id,
        variants: Object.fromEntries([...base.variants, ...(base.spawnOnly ?? [])].map((v) => [v.id, {
          ...(v.tint === undefined ? {} : { tint: v.tint }), ...(v.fur === undefined ? {} : { fur: v.fur }),
          ...(v.traits === undefined ? {} : { traits: v.traits }),
        }])) })
        : look !== undefined ? speciesWithLook({ ...base, id: kind }, look) : base;
    }
    const map = this.cache.get(scope) ?? new Map<string, SpeciesDef>(); map.set(kind, resolved); this.cache.set(scope, map);
    return resolved;
  }
  look(kind: string): SpeciesLook | undefined {
    const scope = this.active();
    return scope === null ? undefined : this.looks.slice().reverse().find((entry) => entry.scope.belongsTo(scope) && entry.value.kind === kind)?.value;
  }
  preloads(): readonly (() => Promise<void>)[] {
    const scope = this.active(); if (scope === null) return [];
    return [...new Set(this.looks.filter((entry) => entry.scope.belongsTo(scope)).flatMap((entry) => entry.value.preload ? [entry.value.preload] : []))];
  }
  /** Work a look's `skin` started for a hull of the active level and finishes later (a coat painted in slices): `settles()`
   *  waits for it, so a herd is never shown in the stand-in. Runtime state, never a hook on the look row (SP3: rows are data). */
  track(work: Promise<void>): void {
    const scope = this.active(); if (scope === null) return;
    const entry = { value: work, scope }; this.unsettled.push(entry);
    const drop = (): void => { const i = this.unsettled.indexOf(entry); if (i !== -1) this.unsettled.splice(i, 1); };
    void work.then(drop, drop);
  }
  /** The active level's unfinished skin work (`track`), as one wait (none when everything is done). */
  settles(): readonly (() => Promise<void>)[] {
    const scope = this.active(); if (scope === null) return [];
    const work = this.unsettled.filter((entry) => entry.scope.belongsTo(scope)).map((entry) => entry.value);
    return work.length === 0 ? [] : [() => Promise.all(work).then(() => undefined)];
  }
  /** A registered model hull can be replaced by the look's procedural builder. */
  hasProceduralFallback(): boolean {
    const scope = this.active();
    return scope !== null && this.looks.some((entry) => entry.scope.belongsTo(scope) && entry.value.skin !== undefined);
  }
}
