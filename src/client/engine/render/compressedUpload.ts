import * as THREE from 'three';
import { pageScope } from '../../../shared/engine/app/resources';
import { recordBootCheckpoint } from '../boot/bootTrace';
import { presenting } from '../../../shared/engine/core/framePacing';
import type { Renderer } from './renderer';
import { retainCompressedMipmaps, assertCompressedMipmapsUnchanged, compressedTextureKey } from './compressedMipmaps';
import { installCompressedTextureRetirement } from './compressedTextureRetirement';

/** The actual renderer operations needed to isolate a compressed texture upload. */
type UploadTarget = Pick<Renderer, 'initTexture' | 'getContext' | 'properties' | 'renderBufferDirect'>;
interface UploadState {
  tail: Promise<void>;
  pending: WeakMap<THREE.Texture, { version: number; signature: string; promise: Promise<void> }>;
  final: WeakSet<THREE.Texture>;
  failed: WeakMap<THREE.Texture, { allocation: unknown; error: Error }>;
}
const states = new WeakMap<UploadTarget, UploadState>();
// A painted frame between uploads belongs to no shard: the page's (SF57: never an ambient owner read mid-build).
const frame = (): Promise<void> => new Promise(resolve => {
  pageScope.raf(() => { pageScope.timeout(0, resolve); });
});

/** Upload one compressed 2D/array texture outside a draw, with a real paint on each side and, while loading, an error round trip.
 * Concurrent warm-up and late-load callers share one queue. A consumer may bind the texture only after this resolves.
 * Already resident versions reuse the result; cancellation and graphics faults never publish readiness.
 * Loader fences retain mips through final sampler configuration and the first successful real draw. */
export function uploadCompressedTexture(renderer: UploadTarget, texture: THREE.Texture,
  current: () => boolean = () => true, final = true): Promise<void> {
  if (!(texture instanceof THREE.CompressedTexture)) return Promise.resolve();
  try { assertCompressedMipmapsUnchanged(texture); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  let state = states.get(renderer);
  if (state === undefined) {
    state = { tail: Promise.resolve(), pending: new WeakMap(), failed: new WeakMap(), final: installCompressedTextureRetirement(renderer) };
    states.set(renderer, state);
  }
  const queue = state, version = texture.version, signature = compressedTextureKey(texture);
  const allocation = (): unknown => {
    const properties: unknown = renderer.properties.get(texture);
    return typeof properties === 'object' && properties !== null ? Reflect.get(properties, '__webglTexture') : undefined;
  };
  const resident = (): boolean => {
    const properties: unknown = renderer.properties.get(texture);
    const source: unknown = renderer.properties.get(texture.source);
    return typeof properties === 'object' && properties !== null
      && Reflect.get(properties, '__webglTexture') !== undefined
      && Reflect.get(properties, '__version') === version
      // Three binds an unchanged version without reevaluating its sampler key.
      // After retirement, the guarded live allocation is still that exact draw's
      // storage; asking for another upload would require pixels already released.
      && (texture.mipmaps.length === 0 || Reflect.get(properties, '__cacheKey') === signature)
      && typeof source === 'object' && source !== null && Reflect.get(source, '__version') === texture.source.version;
  };
  const check = (): void => {
    if (renderer.getContext().isContextLost()) throw new Error('Graphics context lost before compressed texture readiness');
    if (!current()) throw new Error('Shader warm-up owner left');
    if (texture.version !== version || compressedTextureKey(texture) !== signature) throw new Error('Compressed texture changed before upload completed');
  };
  const publish = (): void => { check(); if (final) queue.final.add(texture); };
  const pending = queue.pending.get(texture);
  if (pending?.version === version && pending.signature === signature) return pending.promise.then(publish);
  const failure = queue.failed.get(texture);
  if (failure !== undefined && allocation() === failure.allocation) return Promise.reject(failure.error);
  try { if (resident()) { publish(); return Promise.resolve(); } }
  catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  const promise = queue.tail.then(async () => {
    check(); await frame(); check();
    // Another caller or a draw may have uploaded this version while it waited in the queue.
    if (resident()) return undefined;
    if (texture.mipmaps.length === 0) throw new Error(`Compressed texture ${texture.name || texture.id} has no mipmaps and is not resident on this renderer`);
    retainCompressedMipmaps(texture);
    recordBootCheckpoint('texture:upload', { id: texture.id, version, name: texture.name, format: texture.format,
      mips: texture.mipmaps.length, width: texture.mipmaps[0]?.width ?? 0, height: texture.mipmaps[0]?.height ?? 0 });
    // The error round trip is synchronous: on WebKit `getError` waits for the GPU process to drain every queued command,
    // the upload and the frame before it (sp-o291: 16 Pine road-entry uploads waited 247 ms on the Simulator, one 54 ms
    // stall inside a travel frame). Loading keeps the check; a live upload between drawn frames skips the wait (the
    // format was already vetted by the KTX2 probe). An error already queued before the upload (a draw, a uniform, a link
    // since the last read) fails the same way but says so: one read after the upload could not tell them apart (the
    // public Pine smoke's 'Graphics error 1282 after compressed texture 37808' named no stage or texture).
    const gl = renderer.getContext(), checked = !presenting();
    const label = `${texture.name || texture.format} (#${String(texture.id)}, ${String(texture.mipmaps[0]?.width ?? 0)}x${String(texture.mipmaps[0]?.height ?? 0)}, ${String(texture.mipmaps.length)} mips)`;
    const fail = (error: number, when: 'before' | 'after'): Error => {
      const fault = new Error(`Graphics error ${String(error)} ${when} compressed texture ${label}`);
      queue.failed.set(texture, { allocation: allocation(), error: fault });
      return fault;
    };
    const prior = checked ? gl.getError() : gl.NO_ERROR;
    if (prior !== gl.NO_ERROR) throw fail(prior, 'before');
    renderer.initTexture(texture);
    const error = checked ? gl.getError() : gl.NO_ERROR;
    if (error !== gl.NO_ERROR) throw fail(error, 'after');
    queue.failed.delete(texture);
    await frame(); check();
    return undefined;
  });
  queue.pending.set(texture, { version, signature, promise });
  const clear = (): void => { if (queue.pending.get(texture)?.promise === promise) queue.pending.delete(texture); };
  void promise.then(clear, clear);
  queue.tail = promise.catch(() => undefined);
  return promise.then(publish);
}
