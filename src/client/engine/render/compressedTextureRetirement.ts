import type * as THREE from 'three';
import type { Renderer } from './renderer';
import { assertCompressedMipmapsUnchanged, finalizeCompressedMipmaps, immutableCompressedMipmaps } from './compressedMipmaps';
import { drawHooks, propertyHooks } from './drawHooks';

type DrawTarget = Pick<Renderer, 'properties' | 'renderBufferDirect'>;
const installed = new WeakMap<DrawTarget, WeakSet<THREE.Texture>>();
/** each observed renderer's record of the native allocation a retired texture was drawn with */
const allocations = new Set<WeakMap<THREE.Texture, unknown>>();

/** Observe completed first draws without importing upload scheduling or boot services.
 * Explicit immutable inputs need both native versions. Loader inputs keep their final-preparation fence. */
export function installCompressedTextureRetirement(renderer: DrawTarget): WeakSet<THREE.Texture> {
  let final = installed.get(renderer);
  if (final === undefined) { final = new WeakSet(); installed.set(renderer, final); observeDraws(renderer, final); }
  return final;
}

// A loader upload is not a draw: its caller may still change the sampler. Observe the
// textures Three actually binds, including shader-injected uniforms, and retire only
// after that first real draw succeeds. No source walk or second frame scheduler.
function observeDraws(renderer: DrawTarget, final: WeakSet<THREE.Texture>): void {
  const get = renderer.properties.get.bind(renderer.properties);
  const bound = new Set<THREE.Texture>();
  const retired = new WeakMap<THREE.Texture, unknown>();
  allocations.add(retired);
  /** the draw each texture was last checked in: a draw asks for a bound texture's properties several times, and the
   *  retirement checks (its sampler fields, its allocation) need one look a draw (G639); outside a draw, every time */
  const checked = new WeakMap<THREE.Texture, number>();
  const hooks = drawHooks(renderer);
  const finish = (complete: boolean): void => {
      // Empty Set.clear() still replaces V8's backing table. Most draws have
      // no pending compressed input after first-draw retirement; keep that
      // empty storage instead of allocating a table for every ordinary draw.
      if (bound.size > 0) {
        if (complete) for (const texture of bound) {
          const properties: unknown = get(texture);
          // A direct immutable draw has no earlier loader readiness fence. Retain
          // its bytes unless native texture and source versions both completed.
          if (immutableCompressedMipmaps(texture)) {
            const source: unknown = get(texture.source);
            if (typeof properties !== 'object' || properties === null || Reflect.get(properties, '__webglTexture') === undefined
              || Reflect.get(properties, '__version') !== texture.version || typeof source !== 'object' || source === null
              || Reflect.get(source, '__version') !== texture.source.version) continue;
          }
          if (typeof properties === 'object' && properties !== null) retired.set(texture, Reflect.get(properties, '__webglTexture'));
          finalizeCompressedMipmaps(texture); final.delete(texture);
        }
        bound.clear();
      }
  };
  propertyHooks(renderer).compressed = {
    before: object => {
      if (hooks.depth > 0 && checked.get(object) === hooks.generation) return;
      assertCompressedMipmapsUnchanged(object);
    },
    after: (object, properties) => {
      if (hooks.depth > 0 && checked.get(object) === hooks.generation) {
        if (final.has(object) || immutableCompressedMipmaps(object)) { bound.add(object); hooks.retire = finish; }
        return;
      }
      if (hooks.depth > 0) checked.set(object, hooks.generation);
      const native = retired.get(object);
      if (native !== undefined && (typeof properties !== 'object' || properties === null || Reflect.get(properties, '__webglTexture') !== native)) {
        throw new Error(`Compressed texture ${object.name || object.id} lost its allocation after mip retirement`);
      }
      if (hooks.depth > 0 && (final.has(object) || immutableCompressedMipmaps(object))) { bound.add(object); hooks.retire = finish; }
    },
  };

}
