import * as THREE from 'three';
import { pageScope } from '../../../shared/engine/app/resources';
import { recordBootCheckpoint } from '../boot/bootTrace';
import { presenting } from '../../../shared/engine/core/framePacing';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import type { Renderer } from './renderer';
import { retainCompressedMipmaps, assertCompressedMipmapsUnchanged, compressedTextureKey } from './compressedMipmaps';
import { installCompressedTextureRetirement } from './compressedTextureRetirement';
import { clearCreationErrors } from './contextErrors';

/** The actual renderer operations needed to isolate a compressed texture upload. */
type UploadTarget = Pick<Renderer, 'initTexture' | 'getContext' | 'properties' | 'renderBufferDirect'>;
interface UploadState {
  tail: Promise<void>;
  /** SB32b: under the loader, when the current unpainted batch of uploads began (null: none open) */
  sliceAt: number | null;
  /** SB32b: the one painted frame the current loading batch resolves on */
  paint: Promise<void> | null;
  pending: WeakMap<THREE.Texture, { version: number; signature: string; promise: Promise<void> }>;
  final: WeakSet<THREE.Texture>;
  failed: WeakMap<THREE.Texture, { allocation: unknown; error: Error }>;
  /** uploads queued and not yet finished, this one included: the boot batch ends with the one that has none behind it */
  queued: number;
  /** QA 11-25 row 151: the open boot upload batch, checked once at its end (null: none open) */
  boot: { uploads: number; last: string; texture: THREE.Texture } | null;
}
const states = new WeakMap<UploadTarget, UploadState>();
const OUT_OF_MEMORY = 0x0505, CONTEXT_LOST_WEBGL = 0x9242;
// A painted frame between uploads belongs to no shard: the page's (SF57: never an ambient owner read mid-build).
const frame = (): Promise<void> => new Promise(resolve => {
  pageScope.raf(() => { pageScope.timeout(0, resolve); });
});
/** STAGING-BUGBASH SB32b (opus-pineload, 2026-11-16): under the loader (nothing presenting, no game frame on show) consecutive
 *  uploads share one painted frame until this long has passed since the batch's first, then the batch paints before the
 *  next upload. Each upload's error round trip still waits for the GPU (WebKit drains its queue there), so the clock sees
 *  the real cost. One upload a painted frame on each side cost Pine's arrival two frames for each of ~180 textures: 6 of
 *  its 16 s in a headless preview, its shaders step 2.4 s for 63 programs (Driftwood 0.29 s for 57). In play every upload
 *  keeps its own paint on each side. */
export const LOADING_UPLOAD_SLICE_MS = 32;
/** The current loading batch's painted frame, shared by every upload in it. The batch closes when that frame starts, so an
 *  upload queued between the frame and its task asks for a paint of its own; the next batch's slice starts there too. */
function batchPaint(queue: UploadState): Promise<void> {
  queue.paint ??= new Promise<void>(resolve => {
    pageScope.raf(() => { queue.paint = null; queue.sliceAt = diagnosticNow(); pageScope.timeout(0, resolve); });
  });
  return queue.paint;
}

/** QA 11-25 row 151: the most uploads one boot batch read covers (sp-o291 timed 16 Pine uploads on the Simulator). */
export const BOOT_BATCH_UPLOADS = 16;
/** QA 11-25 row 151: loading cards covering the world. Each holds the boot upload batch check (`ui/Loading.ts`) until it ends. */
let loadingCards = 0;
export function holdLoadingUploadChecks(): () => void {
  loadingCards++;
  let held = true;
  return () => { if (held) { held = false; loadingCards--; } };
}

/** QA 11-25 row 151: close the open boot upload batch with its one error read. A refusal fails the upload that closes it,
 *  naming the batch's last texture and how many uploads the read covered, and is kept against that texture. */
function settleBootBatch(renderer: UploadTarget, queue: UploadState): void {
  const batch = queue.boot;
  if (batch === null) return;
  queue.boot = null;
  const gl = renderer.getContext(), error = gl.getError();
  recordBootCheckpoint('texture:boot-batch', { uploads: batch.uploads, last: batch.texture.id, error });
  if (error === gl.NO_ERROR) return;
  const fault = new Error(`Graphics error ${String(error)} after compressed texture ${batch.last}, the last of ${String(batch.uploads)} boot upload${batch.uploads === 1 ? '' : 's'} checked together`);
  const properties: unknown = renderer.properties.get(batch.texture);
  queue.failed.set(batch.texture, { allocation: typeof properties === 'object' && properties !== null ? Reflect.get(properties, '__webglTexture') : undefined, error: fault });
  throw fault;
}

/** Upload one compressed 2D/array texture outside a draw, with a real paint on each side (under the loader, a batch's: SB32b)
 * and, while loading, an error round trip.
 * Concurrent warm-up and late-load callers share one queue. A consumer may bind the texture only after this resolves.
 * Already resident versions reuse the result; cancellation and graphics faults never publish readiness.
 * Loader fences retain mips through final sampler configuration and the first successful real draw. */
export function uploadCompressedTexture(renderer: UploadTarget, texture: THREE.Texture,
  current: () => boolean = () => true, final = true): Promise<void> {
  if (!(texture instanceof THREE.CompressedTexture)) return Promise.resolve();
  try { assertCompressedMipmapsUnchanged(texture); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
  let state = states.get(renderer);
  if (state === undefined) {
    state = { tail: Promise.resolve(), sliceAt: null, paint: null, pending: new WeakMap(), failed: new WeakMap(), final: installCompressedTextureRetirement(renderer), queued: 0, boot: null };
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
  // `true`: uploaded under the loader, its painted frame still owed (the batch's, after the queue moves on)
  const upload = async (): Promise<boolean> => {
    check();
    const loading = !presenting();
    if (!loading) { queue.sliceAt = null; await frame(); }
    else if (queue.sliceAt === null || diagnosticNow() - queue.sliceAt >= LOADING_UPLOAD_SLICE_MS) await batchPaint(queue);
    check();
    // Another caller or a draw may have uploaded this version while it waited in the queue.
    if (resident()) return false;
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
    // QA 11-25 row 151: the grid boot draws frames while it loads, so it is presenting, yet a refused upload there is a
    // blank texture nobody hears of. While a loading card covers the world (`holdLoadingUploadChecks`: the grid boot's
    // card, under which Nine assembles; the boot trace runs only on traced phone boots), uploads queued back to back are
    // one batch: a drain as it opens, one read as it closes (after the upload with nothing queued behind it), naming
    // that batch's last texture.
    const gl = renderer.getContext(), checked = !presenting(), opens = !checked && queue.boot === null && loadingCards > 0;
    const batched = opens || (!checked && queue.boot !== null);
    const label = `${texture.name || texture.format} (#${String(texture.id)}, ${String(texture.mipmaps[0]?.width ?? 0)}x${String(texture.mipmaps[0]?.height ?? 0)}, ${String(texture.mipmaps.length)} mips)`;
    const fail = (error: number, when: 'before' | 'after'): Error => {
      const fault = new Error(`Graphics error ${String(error)} ${when} compressed texture ${label}`);
      queue.failed.set(texture, { allocation: allocation(), error: fault });
      return fault;
    };
    // ES 3.0 §2.5: a command that raised any error but OUT_OF_MEMORY had no effect, so a flag an earlier call left queued
    // touched nothing this upload uses (opus-tex1): drain and name it. Out of memory or a lost context still fails.
    if (checked && queue.boot !== null) settleBootBatch(renderer, queue); // the page stopped presenting mid-batch: read it first
    const prior = checked || opens ? clearCreationErrors(gl) : [];
    if (prior.length > 0) recordBootCheckpoint('texture:stale-gl-error', { id: texture.id, errors: prior.join(',') });
    const fatal = prior.find(code => code === OUT_OF_MEMORY || code === CONTEXT_LOST_WEBGL);
    if (fatal !== undefined) throw fail(fatal, 'before');
    if (prior.length > 0) console.warn(`Graphics error ${prior.join(', ')} left queued before compressed texture ${label} by an earlier call; drained, upload continues`);
    renderer.initTexture(texture);
    if (batched) {
      queue.boot = { uploads: (queue.boot?.uploads ?? 0) + 1, last: label, texture };
      // nothing queued behind it, or a full batch (the grid streams tiles under its card, so its queue may never drain)
      if (queue.queued === 1 || queue.boot.uploads >= BOOT_BATCH_UPLOADS) settleBootBatch(renderer, queue);
    }
    const error = checked ? gl.getError() : gl.NO_ERROR;
    if (error !== gl.NO_ERROR) throw fail(error, 'after');
    queue.failed.delete(texture);
    if (loading) return true;
    await frame(); check();
    return false;
  };
  queue.queued++;
  // the last upload queued closes an open boot batch, whichever way it left (resident already, owner gone, failed)
  const uploaded = queue.tail.then(async (): Promise<boolean> => {
    try {
      const owed = await upload();
      if (queue.queued === 1) settleBootBatch(renderer, queue);
      return owed;
    } catch (error) {
      if (queue.queued === 1) {
        try { settleBootBatch(renderer, queue); } catch { /* this upload's own failure is the one it reports; the batch's is kept in `failed` */ }
      }
      throw error;
    } finally { queue.queued--; }
  });
  const promise = (async (): Promise<void> => { if (await uploaded) { await batchPaint(queue); check(); } })();
  queue.pending.set(texture, { version, signature, promise });
  const clear = (): void => { if (queue.pending.get(texture)?.promise === promise) queue.pending.delete(texture); };
  void promise.then(clear, clear);
  queue.tail = uploaded.then(() => undefined, () => undefined);
  return promise.then(publish);
}
