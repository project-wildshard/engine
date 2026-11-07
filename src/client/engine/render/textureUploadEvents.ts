import type { Texture } from 'three';
import type { Renderer } from './renderer';
import { drawHooks, invalidatePropertyObservation, propertyHooks } from './drawHooks';

const listeners = new WeakMap<Texture, Set<(texture: Texture) => void>>();
const installed = new WeakSet();

/** One notification after native upload completion. Never replaces Texture.onUpdate.
 * Unuploaded textures and their listeners remain weakly owned by the texture. */
export function onceTextureUploaded(texture: Texture, run: (texture: Texture) => void): void {
  let rows = listeners.get(texture);
  if (rows === undefined) { rows = new Set(); listeners.set(texture, rows); }
  rows.add(run);
  invalidatePropertyObservation(texture);
}

export interface TextureUploadRenderer extends Partial<Pick<Renderer, 'renderBufferDirect'>> {
  readonly properties: Pick<Renderer['properties'], 'get'>;
  initTexture: Renderer['initTexture'];
  render: Renderer['render'];
}
function directDraw(renderer: TextureUploadRenderer): renderer is TextureUploadRenderer & Pick<Renderer, 'renderBufferDirect'> {
  return typeof renderer.renderBufferDirect === 'function';
}

/** Observe r186's completed texture/source versions after its original calls.
 * Explicit warm-up uploads and ordinary material draws use the same channel.
 * A failed upload, changed source or throwing native callback cannot release it. */
export function installTextureUploadEvents(renderer: TextureUploadRenderer): void {
  if (installed.has(renderer)) return;
  installed.add(renderer);
  const direct = directDraw(renderer) ? drawHooks(renderer) : undefined;
  const pending = new Set<WeakRef<Texture>>(), queued = new WeakMap<Texture, WeakRef<Texture>>();
  const get = renderer.properties.get.bind(renderer.properties);
  propertyHooks(renderer).uploaded = object => {
    if (listeners.has(object) && !queued.has(object)) {
      const ref = new WeakRef(object); queued.set(object, ref); pending.add(ref);
      if (direct !== undefined) direct.uploads = flush;
    }
  };
  const version = (object: object): unknown => {
    const row: unknown = get(object);
    return typeof row === 'object' && row !== null ? Reflect.get(row, '__version') : undefined;
  };
  function flush(): void {
    if (pending.size === 0) return;
    for (const ref of pending) {
      const texture = ref.deref();
      if (texture === undefined) { pending.delete(ref); continue; }
      if (version(texture) !== texture.version || version(texture.source) !== texture.source.version) continue;
      pending.delete(ref); queued.delete(texture);
      const rows = listeners.get(texture); listeners.delete(texture);
      if (rows !== undefined) for (const run of rows) run(texture);
    }
    if (pending.size === 0 && direct !== undefined) direct.uploads = undefined;
  }
  const init = renderer.initTexture.bind(renderer), draw = renderer.render.bind(renderer);
  renderer.initTexture = texture => { init(texture); flush(); };
  renderer.render = (scene, camera) => { draw(scene, camera); flush(); };
}
