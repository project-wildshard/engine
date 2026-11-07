/**
 * `listModel(model, options)` — a model whose copies a live system makes, not the world's layout (E306 / E315 M5): the
 * creatures the AnimalManager spawns and animates, the people a quest stands up, the gear the player holds, the arena's
 * training dummies. It registers the model's ONE catalog entry for the shard — the specimen built from the model in its
 * own space, its variants, its facts — and places no copies: the live system keeps drawing them exactly as it did (a
 * rigged creature is posed by its species' code, a weapon by its viewmodel, whose render queue and depth clear stay its
 * own). A shard lists its whole roster at boot (its species list: every creature it can spawn, alive right now or not —
 * the Captain, the Antler King, the flocks), so the Model Explorer always shows each one.
 *
 *   listModel(boar, { ctx, copies: () => animals.animals.filter((a) => a.kind === 'boar').length, drawnAs: 'skinned' });
 *   listModel(leverRifle, { ctx, copies: 1 });
 *
 * A model on the species rigs (`rig.species`) is stood up by the Explorer as an Animal of that kind, so its clip row
 * plays the species' gaits. A `shared/…` model (src/client/engine/models/) used by several shards says so on its card; `pipeline`
 * tells how THIS shard makes it when the model's own list covers them all (a boar: a lofted code rig on Driftwood, a
 * Hunyuan3D-2 hull on that rig in Pine Hollow).
 */
import { app } from '../app/runtime';
import * as THREE from 'three';
import { Rng } from '../../../shared/engine/core/rng';
import type { DrawnAs, ModelEntry, Pipeline, WorldRegistry } from '../world/registry';
import { withTier } from '../explore/tiers';
import type { Animal } from '../entities/AnimalView';
import { specimenReady, paramsOf, seedOf, type ModelContext, type ModelDef, type ModelPart } from './model';
import { resourceScope } from '../../../shared/engine/app/resources';
import { withOwner } from '../../../shared/engine/app/ownership';
import type { Scope } from '../../../shared/engine/app/scope';
import { loadingSpecimen } from './gear';

export interface ListOptions {
  readonly ctx: ModelContext;
  /** how many copies this shard has: a number, or read when the catalog is (the creatures alive now) */
  readonly copies?: number | (() => number);
  /** how they are drawn (default: `skinned` for a rigged model, else `single`) */
  readonly drawnAs?: DrawnAs;
  /** how this shard makes it, when it differs from the model's own list (a shared creature: its hull here, or none) */
  readonly pipeline?: Pipeline | readonly Pipeline[];
  /** VIEW IN WORLD: the world box of the live copy nearest `near` (none: the card has no world view) */
  readonly worldBox?: (near: THREE.Vector3) => THREE.Box3 | null;
  /** default: the running shard's registry */
  readonly registry?: WorldRegistry;
}

/** the catalog piece's id for a listed model */
const pieceId = (id: string): string => `model:${id}`;

/** List a live model in this shard's Model Explorer (see the header). Listing the same model again is a no-op. */
export function listModel<P extends object>(def: ModelDef<P>, o: ListOptions): void {
  const registry = o.registry ?? app.registry;
  if (registry.get(pieceId(def.id)) !== undefined) return;
  const specimen = new THREE.Group();
  specimen.name = `model:${def.id}`;
  const parent = resourceScope(), owners = new Set<Scope>();
  // Direct listings, unlike roster listings, can reach a card before its sources are prepared.
  const scoped = def.specimenLifetime === 'view' || def.prepare !== undefined;
  const build = (variant?: string): THREE.Object3D => {
    const owner = scoped ? parent.child(`specimen/${def.id}`) : undefined;
    if (owner !== undefined) owners.add(owner);
    const make = () => def.build(owner === undefined ? o.ctx : { ...o.ctx, specimenScope: owner }, paramsOf(def, variant, undefined), new Rng(seedOf(def)));
    const prepared = def.prepare;
    if (prepared !== undefined && owner !== undefined) {
      return loadingSpecimen(def.id, [1, 1, 1], async () => {
        await prepared();
        if (owner.disposed || owner.disposing) throw new Error('Specimen view retired during preparation');
        const made = withOwner(owner, make);
        const obj = Array.isArray(made) ? group((made as readonly ModelPart[]).map(meshOf), def.id) : made as THREE.Object3D;
        owner.onDispose(() => { obj.removeFromParent(); });
        if (def.specimenYaw !== undefined) obj.rotation.y = def.specimenYaw;
        await specimenReady(obj);
        return obj;
      }, owner);
    }
    let built: ReturnType<typeof make>;
    try { built = owner === undefined ? make() : withOwner(owner, make); }
    catch (error) { owner?.dispose(); if (owner !== undefined) owners.delete(owner); throw error; }
    const obj = Array.isArray(built) ? group((built as readonly ModelPart[]).map(meshOf), def.id) : built as THREE.Object3D;
    owner?.onDispose(() => { obj.removeFromParent(); });
    if (def.specimenYaw !== undefined) obj.rotation.y = def.specimenYaw;
    return obj;
  };
  // Retained builders keep their variants; scoped builders keep only the shown
  // choice and any temporary tier comparison until the view closes.
  const specimens = new Map<string, THREE.Object3D>();
  const release = (): void => {
    specimen.removeFromParent(); specimen.clear(); specimens.clear();
    for (const owner of owners) owner.dispose(); owners.clear();
  };
  if (scoped) parent.onDispose(release);
  const kept = (variant?: string): THREE.Object3D => {
    const key = variant ?? '';
    let obj = specimens.get(key);
    if (obj === undefined) { obj = build(variant); specimens.set(key, obj); }
    return obj;
  };
  const { copies } = o;
  const entry: ModelEntry = {
    ...(scoped ? { release, ready: () => specimenReady(specimen) } : {}),
    id: def.id, category: def.category, live: false, pipeline: o.pipeline ?? def.pipeline, drawnAs: o.drawnAs ?? (def.rig ? 'skinned' : 'single'),
    object: () => { if (specimen.children.length === 0) specimen.add(kept()); return specimen; },
    buildAt: (tier) => withTier(tier, () => build()),
    get copies(): number { return typeof copies === 'function' ? copies() : copies ?? 1; },
    ...(o.worldBox === undefined ? { worldView: false } : { worldBox: o.worldBox }),
    ...(def.rig?.species === undefined ? {} : { species: def.rig.species }),
    ...(def.rig?.dress === undefined ? {} : { dress: ((dress) => (a: Animal): void => { dress(a, o.ctx); })(def.rig.dress) }),
  };
  const visibleVariants = def.variants?.filter(variant => variant.hidden !== true);
  if (visibleVariants !== undefined && visibleVariants.length > 0) {
    entry.variants = visibleVariants.map((v) => ({ id: v.id, label: v.label }));
    entry.rebuild = (variant?: string): void => {
      const container = specimen.parent;
      if (scoped) release();
      specimen.clear();
      specimen.add(kept(variant));
      container?.add(specimen);
      if ('document' in globalThis) document.dispatchEvent(new CustomEvent('ws:model-ready', { detail: { id: def.id } }));
    };
  }
  registry.add({ id: pieceId(def.id), name: def.name, category: def.category, file: def.file, model: entry });
}

function meshOf(part: ModelPart): THREE.Mesh {
  const m = new THREE.Mesh(part.geometry, part.material);
  m.castShadow = part.castShadow ?? false;
  m.receiveShadow = part.receiveShadow ?? false;
  if (part.customDepthMaterial) m.customDepthMaterial = part.customDepthMaterial;
  if (part.renderOrder !== undefined) m.renderOrder = part.renderOrder;
  return m;
}

function group(objects: readonly THREE.Object3D[], name: string): THREE.Object3D {
  if (objects.length === 1 && objects[0]) return objects[0];
  const g = new THREE.Group();
  g.name = name;
  for (const o of objects) g.add(o);
  return g;
}

/** one live model a shard has: its catalog listing, made by `live(model, …)` (the model's params type stays inside) */
export interface RosterEntry {
  readonly id: string;
  /** Owned optional preparation, run before listing the synchronous specimen. */
  readonly prepare?: () => Promise<void>;
  /** the species of a creature on the species rigs (its copies are the live animals of that kind) */
  readonly species?: string;
  readonly list: (ctx: ModelContext, animals: () => readonly { readonly kind: string }[], registry?: WorldRegistry) => void;
}

/**
 * A roster entry: `pipeline` how this shard makes it (a shared model), `planned` the copies it stands up when none is
 * alive (a boss that comes at night; default 1), `copies` a count of its own (the gear held: 1; the people of a camp).
 */
export function live<P extends object>(def: ModelDef<P>, o: { pipeline?: Pipeline | readonly Pipeline[]; planned?: number; copies?: number | (() => number); drawnAs?: DrawnAs; } = {}): RosterEntry {
  const kind = def.rig?.species;
  return {
    id: def.id, ...(kind === undefined ? {} : { species: kind }), ...(def.prepare === undefined ? {} : { prepare: def.prepare }),
    list: (ctx, animals, registry) => {
      const alive = (): number => {
        let n = 0;
        if (kind !== undefined) for (const a of animals()) if (a.kind === kind) n++;
        return n;
      };
      const own = o.copies;
      listModel(def, {
        ctx, ...(registry === undefined ? {} : { registry }), ...(o.pipeline === undefined ? {} : { pipeline: o.pipeline }), ...(o.drawnAs === undefined ? {} : { drawnAs: o.drawnAs }),
        copies: own ?? ((): number => { const n = alive(); return n > 0 ? n : o.planned ?? 1; }),
      });
    },
  };
}

/** List a shard's live roster in its Model Explorer (its species list, its people, its gear — alive right now or not). */
export function listRoster(roster: readonly RosterEntry[], ctx: ModelContext, animals: () => readonly { readonly kind: string }[] = () => [], registry?: WorldRegistry): void {
  for (const r of roster) r.list(ctx, animals, registry);
}
