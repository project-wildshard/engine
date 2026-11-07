import type { IUniform, Material, Texture } from 'three';
import type { ToonLook } from '@wildshard/engine/render/families/toon';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import type { Scope } from '@wildshard/engine/app/scope';
import { enteredOwner } from '@wildshard/engine/app/ownership';

/**
 * Lent looks (SHARD-PLATFORM W2 C2): a shard's runtime compiles its look.materials graphs (`runtimeLookMaterials`) and
 * lends them here for the scope that owns them; the world's modules read a compiled look, its params and its lent textures
 * by catalogue id instead of each keeping a setter of its own. Several lends may be live at once (a second compile pass,
 * an entered world): a look id resolves to the newest lend that compiled it, preferring one whose scope owns the caller
 * (G580 T1: two live copies of one product lend the same ids, and each copy's systems run under its own scope). A read
 * before the lend refuses, so a module
 * built before its look was compiled fails loudly; a param write before it is a no-op.
 *
 *   lendLooks(scope, await runtimeLookMaterials(ctx, source, true, ids));   // the runtime, before the world
 *   new THREE.Mesh(geometry, lentLook('reef'));                                  // a world module
 *   setLentParam('hearth-smoke', 'sunColour', [r, g, b]);                             // once a frame
 *
 * Resident world construction and entered presentation share the same compiled material book.
 */

/** One compile pass as lent: its materials, their param and texture writers, a mesh-map binder and its live toon look. */
export interface LentLooks {
  readonly materials: ReadonlyMap<string, Material>;
  readonly setParam: (id: string, name: string, value: GraphLiteral) => void;
  readonly setTexture: (id: string, name: string, texture: Texture) => void;
  /** a look worn over a source's own maps (a material's colour, normal, roughness and AO; a texture as its colour map) */
  readonly bindMeshMap: (id: string, map: Texture | Material) => Material;
  /** the pass's live toon family, when it compiled toon looks (a shard's day clock turns it, once a frame) */
  readonly toon?: ToonLook;
  /** a further compile of graph look `id` with its own params (a pooled effect's copy that moves alone) */
  readonly instance?: (id: string) => LookInstance;
  /** compile the still-deferred looks among `ids`, one build step each */
  readonly prepare?: (ids: readonly string[]) => Promise<void>;
}
/** One compiled copy of a graph look: its own material and its own param writer (checked as the look's are). */
export interface LookInstance {
  readonly material: Material;
  readonly setParam: (name: string, value: GraphLiteral) => void;
}

/** `follows`: the lend takes its owner line's param writes but never answers a lookup (`lendLooks`) */
const lends: { readonly looks: LentLooks; readonly scope: Scope | null; readonly follows: boolean }[] = [];
const liveLends = new WeakSet<LentLooks>();
/** bumped whenever a lend starts or ends: the param writers below are cached per lend set */
let lendGeneration = 0;
const sceneMaterials = new WeakMap<Scope, Map<string, ReadonlyMap<string, Material>>>();

/** Internal terrain loan, isolated to its resident and product identity. Scene
 * construction can overlap other worlds that happen to name the same family. */
export function lendSceneMaterials(scope: Scope, slug: string, materials: ReadonlyMap<string, Material>): void {
  if (scope.disposed) throw new Error('Scene material loan needs a live resident');
  let rows = sceneMaterials.get(scope);
  if (rows === undefined) { rows = new Map(); sceneMaterials.set(scope, rows); scope.onDispose(() => { sceneMaterials.delete(scope); }); }
  if (rows.has(slug)) throw new Error('Scene material book is already lent');
  rows.set(slug, materials);
}

/** A loan is optional; an unloaned graph still follows normal scene compilation. */
export function sceneMaterial(scope: Scope, slug: string, id: string): Material | undefined {
  return sceneMaterials.get(scope)?.get(slug)?.get(id);
}

/** Lend a compile pass's looks until `scope` ends. `follows` lends a pass that draws only its own meshes (NT4: a coarse
 *  cover's compile): its looks take the param writes made on `scope`'s line, but a lookup never hands them out, so the
 *  world's meshes keep the compile they were built with. */
export function lendLooks(scope: { onDispose: (run: () => void) => unknown }, looks: LentLooks, options: { readonly follows?: boolean } = {}): void {
  const lend = { looks, scope: 'belongsTo' in scope && typeof scope.belongsTo === 'function' ? scope as Scope : null, follows: options.follows === true };
  lends.push(lend); liveLends.add(looks); lendGeneration++;
  scope.onDispose(() => { const at = lends.indexOf(lend); if (at !== -1) {
    lends.splice(at, 1); lendGeneration++;
    // One compiled book may be lent more than once. Retirement, unlike each
    // frame's parameter writes, can scan for its remaining loan.
    if (!lends.some(row => row.looks === looks)) liveLends.delete(looks);
  } });
}

/** the newest lend that compiled `id` within the caller's owner, else the newest that compiled it, or null */
function holder(id: string): LentLooks | null {
  const owner = enteredOwner();
  let newest: LentLooks | null = null;
  for (let i = lends.length - 1; i >= 0; i--) {
    const lend = lends[i]; if (lend === undefined || lend.follows || !lend.looks.materials.has(id)) continue;
    if (owner === null || (lend.scope !== null && owner.belongsTo(lend.scope))) return lend.looks;
    newest ??= lend.looks;
  }
  return newest;
}

/** The lend that compiled `id`; throws when none did (the runtime lends its looks before the world builds). */
export function lentLooksOf(id: string): LentLooks {
  const lend = holder(id);
  if (lend === null) throw new Error(`No lent look ${id}: the runtime compiles and lends its looks before the world builds`);
  return lend;
}

/** Compile the still-deferred lent looks among `ids` one build step each, before a synchronous pass touches them all (a
 *  deferred graph look otherwise compiles inside its first lookup's frame, several in one task); ids no lend holds, or
 *  whose lend compiles eagerly, are skipped. */
export async function prepareLentLooks(ids: readonly string[]): Promise<void> {
  const held = new Map<LentLooks, string[]>();
  for (const id of new Set(ids)) {
    const lend = holder(id); if (lend?.prepare === undefined) continue;
    const owned = held.get(lend);
    if (owned === undefined) held.set(lend, [id]); else owned.push(id);
  }
  for (const [lend, owned] of held) await lend.prepare?.(owned);
}

/** Whether `looks` is still lent (its scope has not ended): a holder kept across visits must not write a retired lend. */
export function isLent(looks: LentLooks): boolean { return liveLends.has(looks); }

/** Whether a compiled look `id` is lent (a module that may build outside its world draws nothing without it). */
export function hasLentLook(id: string): boolean { return holder(id) !== null; }

/** A compiled look by its catalogue id; throws when none is lent. */
export function lentLook(id: string): Material {
  const material = lentLooksOf(id).materials.get(id);
  if (material === undefined) throw new Error(`No lent look ${id}`);
  return material;
}

/** A lent look worn over `source`'s own maps, one per look and source; throws when none is lent. */
export function lentMappedLook(id: string, source: Texture | Material): Material { return lentLooksOf(id).bindMeshMap(id, source); }

/** Set a lent look's param (checked against its declared type and range) on every live compile of it on the caller's
 *  owner's line (its scope holds the owner or the owner holds it), else (and with no owner: G580, one product's two copies)
 *  on the newest; a no-op before the lend. A material keeps the compile it was read from, and a later or narrower lend of the same id must not
 *  take its writes (lend audit after QF21: Pine's hearth smoke and cave crag drew the page's compile while frames under
 *  the level wrote the runtime's; Driftwood's moored rope read a lend a newer one then shadowed). */
export function setLentParam(id: string, name: string, value: GraphLiteral): void {
  for (const looks of paramWriters(id)) looks.setParam(id, name, value);
}

// NF15: the day and channel feeds write lent params every frame, and each write scanned every lend and walked the owner's
// scope line. The writers of an id depend only on the lend set and the owner (a scope's line never changes, and a lend's
// materials are compiled before it is lent), so they are found once per owner until a lend starts or ends.
const writerCache = new Map<Scope | null, Map<string, readonly LentLooks[]>>();
let writerGeneration = -1;
// Consecutive world writes usually share one owner. Keep that book without
// repeating its outer lookup; generation changes still invalidate every book.
let writerOwner: Scope | null | undefined;
let ownerWriters = new Map<string, readonly LentLooks[]>();
function paramWriters(id: string): readonly LentLooks[] {
  if (writerGeneration !== lendGeneration) { writerCache.clear(); writerGeneration = lendGeneration; writerOwner = undefined; }
  const owner = enteredOwner();
  if (owner !== writerOwner) {
    let byId = writerCache.get(owner);
    if (byId === undefined) { byId = new Map(); writerCache.set(owner, byId); }
    writerOwner = owner; ownerWriters = byId;
  }
  const byId = ownerWriters;
  const cached = byId.get(id);
  if (cached !== undefined) return cached;
  const line = (a: Scope | null, b: Scope | null): boolean => a !== null && b !== null && (a.belongsTo(b) || b.belongsTo(a));
  const held = lends.filter(lend => lend.looks.materials.has(id)).reverse();
  const chosen = held.filter(lend => !lend.follows && line(owner, lend.scope));
  const newest = held.find(lend => !lend.follows);
  if (chosen.length === 0 && newest !== undefined) chosen.push(newest);
  // a following compile takes the writes made on its line: the owner's, or a chosen lend's (the frame feeds write with no
  // owner, so they reach the newest lend alone)
  const followers = held.filter(lend => lend.follows && (line(owner, lend.scope) || chosen.some(writer => line(writer.scope, lend.scope))));
  const writers = [...chosen, ...followers].map(lend => lend.looks);
  byId.set(id, writers);
  return writers;
}

/** Lend a look's `role: 'lent'` texture param a texture the runtime made (no program change); throws when none is lent. */
export function setLentTexture(id: string, name: string, texture: Texture): void { lentLooksOf(id).setTexture(id, name, texture); }

/** A further copy of lent graph look `id` (its own material and params, owned by the lend's scope); throws when none is
 *  lent or the lend compiles no copies. */
export function lentLookInstance(id: string): LookInstance {
  const lend = lentLooksOf(id);
  if (lend.instance === undefined) throw new Error(`Lent look ${id} has no instances`);
  return lend.instance(id);
}

/** The live toon look of the lend that compiled `id`; throws when none is lent. */
export function lentToon(id: string): ToonLook {
  const toon = lentLooksOf(id).toon;
  if (toon === undefined) throw new Error(`Lent look ${id} has no toon family`);
  return toon;
}

const lentParams: { setParam: (id: string, name: string, value: GraphLiteral) => void; } = { setParam: setLentParam };
/** Push a channel group's graph params (`graphParamRoots(...)`) into the lent looks. */
export function pushLentParams(params: { readonly push: (looks: typeof lentParams) => void }): void { params.push(lentParams); }

const uniformLends: { readonly id: string; readonly uniforms: Readonly<Record<string, IUniform>>; readonly scope: Scope }[] = [];
/** Lend a live uniform set (one `{ value }` object per name, the same objects its programs read) as `id` until `scope` ends. */
export function lendUniforms(scope: Scope, id: string, uniforms: Readonly<Record<string, IUniform>>): void {
  if (scope.disposed) throw new Error('Uniform loan needs a live scope');
  const lend = { id, uniforms, scope };
  uniformLends.push(lend);
  scope.onDispose(() => { const at = uniformLends.indexOf(lend); if (at !== -1) uniformLends.splice(at, 1); });
}
/** The newest lent uniform set `id` within the caller's owner, else the newest; throws when none is lent. */
export function lentUniforms(id: string): Readonly<Record<string, IUniform>> {
  const owner = enteredOwner();
  let newest: Readonly<Record<string, IUniform>> | null = null;
  for (let i = uniformLends.length - 1; i >= 0; i--) {
    const lend = uniformLends[i]; if (lend?.id !== id) continue;
    if (owner === null || owner.belongsTo(lend.scope)) return lend.uniforms;
    newest ??= lend.uniforms;
  }
  if (newest === null) throw new Error(`No lent uniforms ${id}: the world lends them before its look composes`);
  return newest;
}
