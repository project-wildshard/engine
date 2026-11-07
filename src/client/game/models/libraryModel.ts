import { Group, type BufferGeometry, type Material } from 'three';
import type { ColliderSpec, ModelContext, ModelDef } from '@wildshard/engine/models/model';
import { UnitParts, type UnitDrawn, type WeldPart } from '@wildshard/engine/models/weld';
import { loadingSpecimen } from '@wildshard/engine/models/gear';

/**
 * A model drawn from a shard's whole-geometry library (SHARD-PLATFORM W2): a baked, site-fitted or authored piece whose
 * parts are named geometries the shard already read (`readWholeGeometry`, `@wildshard/engine/game/plugin/geometry`), each on a
 * material the shard names by key, merged by the engine's weld unit (`UnitParts`: one mesh per material and band, the
 * position-only shadow proxies of its `'proxy'` parts). It is the `build` and `colliders` of an ordinary model, so
 * `place` draws, registers and lists it (its Explorer card, its floors and colliders) like any other:
 *
 *   export const pier = defineModel({ id: '<slug>/pier', …, ...libraryModel({ draws, geometry, material, colliders }) });
 *
 * `draws` gives a copy's parts by its params, `geometry` a fresh geometry for a library name (`D`: a shard's own table's
 * keys, or any string; the unit merges it),
 * `material` the material for a key, `colliders` (optional) the copy's own-space colliders, `finish` (optional) tags the drawn
 * meshes and proxies (a shard's distance bands, a tier's shadows) before `place` takes them, and `loading` (optional) is
 * for a library that may load after a copy is asked for (an Explorer card opened before the shard's world hook): the
 * model `prepare`s by its `load`, and until `ready()` a copy is a loading specimen about `size` big that fills once it
 * resolves. A copy's draws are asked for at once, so params that name no library piece throw before any load.
 */

/** One part of a library model's copy: a library geometry by name, its material's key and its weld flags. */
export interface LibraryDraw<K extends string, D extends string = string> extends Omit<WeldPart, 'material' | 'geometries'> {
  readonly draw: D;
  readonly material: K;
}

/** What a library model is built from (see the module comment). */
export interface LibraryModelSpec<P extends object, K extends string, D extends string = string> {
  readonly draws: (params: P) => readonly LibraryDraw<K, D>[];
  readonly geometry: (ctx: ModelContext, draw: D) => BufferGeometry;
  readonly material: (ctx: ModelContext, key: K) => Material;
  readonly colliders?: (params: P) => readonly ColliderSpec[];
  readonly finish?: (drawn: UnitDrawn, params: P) => void;
  readonly loading?: LibraryLoading<P>;
}

/** A library that loads late (see the module comment): the model's id (its card's `ws:model-ready`), its state and size. */
export interface LibraryLoading<P extends object> {
  readonly id: string;
  readonly ready: () => boolean;
  readonly load: () => Promise<void>;
  readonly size: (params: P) => readonly [number, number, number];
}

/** The `build` and `colliders` (and `prepare`, for a library that loads late) of a model drawn from a whole-geometry library. */
export function libraryModel<P extends object, K extends string, D extends string = string>(spec: LibraryModelSpec<P, K, D>): Pick<ModelDef<P>, 'build' | 'colliders' | 'prepare'> {
  const { loading } = spec;
  return {
    build: (ctx, params) => {
      const draws = spec.draws(params);
      const make = (): Group => {
        const unit = new UnitParts(), root = new Group();
        for (const { draw, material, ...flags } of draws) unit.add([{ ...flags, material: spec.material(ctx, material), geometries: [spec.geometry(ctx, draw)] }]);
        const drawn = unit.draw(root, false); // never inside `finish?.(…)`: an absent finish would skip the draw
        spec.finish?.(drawn, params);
        return root;
      };
      if (loading === undefined || loading.ready()) return make();
      return loadingSpecimen(loading.id, loading.size(params), async () => { await loading.load(); return make(); });
    },
    ...(spec.colliders === undefined ? {} : { colliders: spec.colliders }),
    ...(loading === undefined ? {} : { prepare: loading.load }),
  };
}
