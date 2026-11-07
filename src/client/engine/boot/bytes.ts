/**
 * Where the boot plan's bytes come from.
 *
 *  - `declareTotals(files)`: declared denominators per byte source, from the build's byte table
 *    (`bytes.generated.ts`) — known before the first byte, so DOWNLOAD never runs backwards.
 *  - `installByteCounter(plan, files)`: every `/assets/**` fetch (three's FileLoader / ImageBitmapLoader,
 *    our own texture loads) is teed and its bytes credited to the source that declared the file.
 *    Files a browser loads through `<img>` (GLTF textures on Safari) are credited on completion from
 *    resource timing — coarser, still real bytes.
 *  - `fetchImage(url)`: a texture as an ImageBitmap through that counted fetch, decoded off the main
 *    thread with the orientation three's ImageBitmapLoader uses.
 */
import type { Plan, ByteProgress } from './plan';
import type { BootStep, ByteKey } from '../../../shared/engine/boot/steps';
import { assetVersions, publicBytes } from '../../../shared/engine/boot/tables';
import { DefaultLoadingManager } from 'three';
import { TIER, TIER_CONFIG } from '../core/tier';
import { standIn, texMode, type TexMode } from './gpuFiles';
import { decodeImageBitmap } from './imageDecode';

import { pageScope } from '../../../shared/engine/app/resources';
import { presenting } from '../../../shared/engine/core/framePacing';
import { workSlice } from '../../../shared/engine/core/workSlice';
import { demandTextureResponse } from './texturePack';
import { readContent } from './contentRead';

export type ChunkFiles = Readonly<Record<ByteKey, readonly string[]>>;
type Bytes = Record<string, number>;
const EXTRA: Bytes = {};
/** Sizes of files outside public/assets that a boot declares (the bundle's hashed title / explore art, src/client/engine/boot/extras.ts). */
export function addBytes(extra: Readonly<Record<string, number>>): void { Object.assign(EXTRA, extra); }
const known = (f: string): boolean => f in EXTRA || f in publicBytes();
const sizeOf = (f: string): number | undefined => EXTRA[f] ?? publicBytes()[f];

export function declareTotals(files: ChunkFiles): Record<ByteKey, { bytes: number; files: number }> {
  const out = {} as Record<ByteKey, { bytes: number; files: number }>;
  for (const key of Object.keys(files) as ByteKey[]) {
    let bytes = 0;
    for (const f of files[key]) {
      if (!known(f)) throw new Error(`boot: ${key} declares ${f} but public/assets has no such file`);
      bytes += sizeOf(f) ?? 0;
    }
    out[key] = { bytes, files: files[key].length };
  }
  return out;
}

/**
 * The phone tier's copy of a file when the build has one (scripts/tex-tiers.mjs): `name.phone.webp` beside an image
 * (WebP ~20–25 % under the JPEG at lower error, ≤ 1024 px, AO / roughness / metalness planes at 512 px) and
 * `name.phone.glb` beside a GLB (its textures as WebP). `fetchImage` and three's loaders (the URL modifier below) fetch
 * through it and the boot manifest declares through it, so the bytes declared are the bytes downloaded. Any other
 * tier / file: as is.
 */
export function tierUrl(url: string, tex: TexMode = texMode()): string {
  const u = phoneUrl(url);
  // E157: a model whose textures ride as KTX2 (KHR_texture_basisu) when the page loads KTX2 — three's loaders, the boot
  // pack and the manifest all come through here, so they agree on the file (src/client/engine/boot/gpuFiles.ts; images: src/client/engine/core/ktx2.ts)
  return /\.(glb|gltf)$/.test(u) ? standIn(u, tex) ?? u : u;
}
/** the tier's copy of a file (`.phone.webp` / `.phone.glb`), whatever the textures ride as */
export function phoneUrl(url: string): string {
  if (TIER_CONFIG.maxTexture > 1024) return url;
  const m = /^(.*)\.(png|jpg|webp|glb)$/.exec(url);
  if (!m) return url;
  const u = `${m[1]}.phone.${m[2] === 'glb' ? 'glb' : 'webp'}`;
  return known(u) ? u : url;
}
/** the file this device downloads for `url` in mode `tex`: tierUrl's, or its KTX2 stand-in for an image (E157) — what the boot declares */
export function gpuUrl(url: string, tex: TexMode = texMode()): string {
  const u = tierUrl(url, tex);
  return standIn(u, tex) ?? u;
}
// three's GLTFLoader (props, cabin clutter, their textures) and every other loader on the default manager — the tier's copy,
// as the network names it (`?v=`: an <img>-loaded glTF texture on Safari never passes through the counted fetch)
DefaultLoadingManager.setURLModifier((url) => versionedUrl(tierUrl(url)));

const pathOf = (url: string): string => { try { return new URL(url, location.href).pathname; } catch { return url; } };

/**
 * The URL the network sees for a file under public/assets whose name is not content-addressed (vite.config.ts
 * `writeVersionsModule`; E160 — it was public/assets/nalati/ alone): `<path>?v=<content hash>`, so a changed file is a new
 * URL to the HTTP cache and the service worker, and an unchanged one keeps its URL and its cached copy across deploys.
 * Everything above the network (the byte counter, the pack, the prefetch queue) keys files by path and never sees the
 * query. A content-named file (a pack, the audio), any other URL, or one that already carries a query: as is.
 */
export function versionedUrl(url: string): string {
  if (!url.includes('/assets/') || url.includes('?')) return url;
  const v = assetVersions()[pathOf(url)];
  return v === undefined ? url : `${url}?v=${v}`;
}
/** `fetch` with `versionedUrl` applied (three's FileLoader hands fetch a Request) */
function versionedFetch(net: typeof window.fetch): typeof window.fetch {
  return (input, init) => {
    const packed = demandTextureResponse(input, init, net);
    if (packed !== undefined) return packed;
    if (typeof input === 'string') return net(versionedUrl(input), init);
    if (input instanceof URL) return net(versionedUrl(input.href), init);
    const u = versionedUrl(input.url);
    return net(u === input.url ? input : new Request(u, input), init);
  };
}

/** the running boot's counter (one per shard build — E155 builds several in one page; the fetch layer is installed once) */
interface Counting { sourceOf: Map<string, ByteKey>; reader: (k: ByteKey) => ByteProgress; seen: Set<string>; finished: Set<string>; plan: Plan<BootStep>;
  resourceBatches: PerformanceObserverEntryList[]; drainingResources: boolean }
let counting: Counting | null = null;
let counterFetch: typeof window.fetch | undefined;
let counterObserver: PerformanceObserver | undefined;

export function installByteCounter(plan: Plan<BootStep>, files: ChunkFiles): void {
  const sourceOf = new Map<string, ByteKey>();
  for (const key of Object.keys(files) as ByteKey[]) for (const f of files[key]) sourceOf.set(f, key);
  // These extras use their own URLs, outside the world's streaming pack.
  // Declare the selected inventory before either prefetch or decoding starts.
  for (const f of [...files.art, ...files.music, ...files.sfx]) {
    const bytes = sizeOf(f);
    if (bytes === undefined) throw new Error(`boot: missing download size for ${f}`);

  }
  const readers = new Map<ByteKey, ByteProgress>();
  const reader = (k: ByteKey): ByteProgress => { let r = readers.get(k); if (!r) { r = plan.reader(k); readers.set(k, r); } return r; };
  // files whose bytes were counted by the tee / credited at all — per build: a later shard's bar counts its own
  counting = { sourceOf, reader, seen: new Set<string>(), finished: new Set<string>(), plan, resourceBatches: [], drainingResources: false };
  installCounter();
}

/** the boot is done: later fetches are nobody's bar (and the plan — with everything its steps closed over — can go) */
export function releaseByteCounter(): void { counting = null; }

function creditResource(c: Counting, entry: PerformanceResourceTiming): ByteKey | undefined {
  const path = pathOf(entry.name), key = c.sourceOf.get(path);
  if (!key || c.seen.has(path) || c.finished.has(path)) return undefined;
  c.finished.add(path);
  c.reader(key).add(entry.encodedBodySize || entry.transferSize || (sizeOf(path) ?? 0) || 0);
  return key;
}

/** Keep the batch's original counter, including across a later boot/counter release.
 * Live phone observers only enqueue: native list extraction and progress painting start in a paced task.
 * Desktop and loading remain synchronous. One extraction or sink publication is still atomic. */
function creditResources(c: Counting, list: PerformanceObserverEntryList): void {
  if (!c.drainingResources && (TIER !== 'phone' || !presenting())) {
    for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
      const key = creditResource(c, entry);if (key !== undefined) c.plan.fileDone(key);
    }
    return;
  }
  c.resourceBatches.push(list);
  if (c.drainingResources) return;
  c.drainingResources = true;
  const slice = workSlice(undefined, pageScope);
  const drain = async (): Promise<void> => {
    try {
      await slice.yield();
      for (let batch = c.resourceBatches.shift(); batch !== undefined; batch = c.resourceBatches.shift()) for (const entry of batch.getEntries() as PerformanceResourceTiming[]) {
        const pause = slice.check();if (pause !== undefined) await pause;
        const key = creditResource(c, entry);
        if (key !== undefined) {
          const beforeFile = slice.check();if (beforeFile !== undefined) await beforeFile;
          c.plan.fileDone(key);
        }
      }
    } finally { c.drainingResources = false; }
  };
  void drain();
}

/** Bind the fetch layer and resource watch to the current transport; both read the running boot's counter. */
function installCounter(): void {
  if (counterFetch !== undefined && window.fetch === counterFetch) return;
  counterObserver?.disconnect();
  counterObserver = undefined;

  const orig = versionedFetch(window.fetch.bind(window)); // the innermost layer: the network sees `?v=` (versionedUrl)
  const counted: typeof window.fetch = async (input, init) => {
    const c = counting;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const p = pathOf(url);
    const key = c?.sourceOf.get(p);
    if (!c || !key || c.seen.has(p)) return orig(input, init);
    c.seen.add(p);
    const res = await orig(input, init);
    if (!res.ok || !res.body) { return res; }
    const r = c.reader(key);
    const [a, b] = res.body.tee();
    // drain the twin, crediting bytes as they land; the caller consumes `a` untouched
    (async () => {
      const rd = b.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; r.add(value.byteLength); }
      c.finished.add(p); c.plan.fileDone(key);
    })().catch(() => undefined);
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
  };

  window.fetch = counted;
  counterFetch = counted;

  // <img>-loaded files never pass through fetch: credit them when resource timing reports them done.
  if ('PerformanceObserver' in window) {
    const po = new PerformanceObserver((list) => {
      const c = counting;
      if (!c) return;
      creditResources(c, list);
    });
    po.observe({ type: 'resource', buffered: true });
    counterObserver = po;
  }
}

/**
 * Decode an image off the main thread through the counted fetch, downscaled to `maxSize` when the
 * file is larger (the phone tier's 1024 cap) — or, with `exact`, scaled to exactly maxSize² either way
 * (a texture-array layer fed by a half-resolution phone ARM plane). `flip` matches three's
 * ImageBitmapLoader (then texture.flipY must be false); pass false for canvas work that keeps the
 * file's orientation.
 */
export async function fetchImage(file: string, maxSize: typeof Infinity = Infinity, flip = true, exact = false): Promise<ImageBitmap | HTMLImageElement> {
  const url = tierUrl(file);
  let type = '';
  const bytes = await readContent(url, 25_000_000, {fetch: (address, init) => fetch(address, init),
    response: response => {type = response.headers.get('content-type') ?? '';}});
  const blob = new Blob([bytes], {type});
  if (typeof createImageBitmap === 'function') {
    try {
      const opts: ImageBitmapOptions = { imageOrientation: flip ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
      if (Number.isFinite(maxSize)) {
        // one decode at natural size to learn the dimensions is what we are avoiding: probe the header cheaply
        const dim = await imageSize(blob);
        if (dim && exact && (dim.w !== maxSize || dim.h !== maxSize)) {
          opts.resizeWidth = maxSize; opts.resizeHeight = maxSize; opts.resizeQuality = 'medium';
        } else if (dim && Math.max(dim.w, dim.h) > maxSize) {
          const k = maxSize / Math.max(dim.w, dim.h);
          opts.resizeWidth = Math.round(dim.w * k); opts.resizeHeight = Math.round(dim.h * k); opts.resizeQuality = 'medium';
        }
      }
      return await decodeImageBitmap(blob, opts);
    } catch { /* fall through */ }
  }
  const src = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => { resolve(img); }; img.onerror = reject; img.src = src; });
  } finally { URL.revokeObjectURL(src); }
}

/** Width/height from the JPEG / PNG / WebP header — a few bytes, no decode. */
async function imageSize(blob: Blob): Promise<{ w: number; h: number } | null> {
  const head = new DataView(await blob.slice(0, 65536).arrayBuffer());
  if (head.byteLength > 24 && head.getUint32(0) === 0x89504e47) return { w: head.getUint32(16), h: head.getUint32(20) }; // PNG IHDR
  if (head.byteLength > 30 && head.getUint32(0) === 0x52494646 && head.getUint32(8) === 0x57454250) { // RIFF…WEBP
    const chunk = head.getUint32(12);
    if (chunk === 0x56503820) return { w: head.getUint16(26, true) & 0x3fff, h: head.getUint16(28, true) & 0x3fff }; // 'VP8 '
    if (chunk === 0x5650384c) { const b = head.getUint32(21, true); return { w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 }; } // 'VP8L'
    if (chunk === 0x56503858) return { w: (head.getUint32(24, true) & 0xffffff) + 1, h: (head.getUint32(27, true) & 0xffffff) + 1 }; // 'VP8X'
    return null;
  }
  if (head.byteLength > 4 && head.getUint16(0) === 0xffd8) { // JPEG: walk the segments to SOF0/2
    let o = 2;
    while (o + 9 < head.byteLength) {
      if (head.getUint8(o) !== 0xff) return null;
      const marker = head.getUint8(o + 1);
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { h: head.getUint16(o + 5), w: head.getUint16(o + 7) };
      o += 2 + head.getUint16(o + 2);
    }
  }
  return null;
}
