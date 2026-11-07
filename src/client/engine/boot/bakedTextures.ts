/**
 * Baked procedural textures (project/archive/2026-09-22-load-perf.md §P2). Fur, clouds, planet bands, blade atlases…
 * are drawn on a canvas or into a DataTexture at every launch — a few hundred ms of the phone's CPU
 * for images that never change. `bakedTexture(name, make)` returns the committed image under
 * public/assets/baked/<slug>/tex/<name>.{png,jpg} when the build has it (preloaded by
 * `preloadBakedTextures()` at the head of the terrain step, counted under the `baked` byte source),
 * else runs `make()`. The sky's files are baked offline from the engine's pure painters
 * (scripts/bake-textures.mjs renders `world/skyTextures.ts` on a bake page; SF87, G320); the game exports nothing.
 *
 * Contract for `make()`: the texture's `image` must be a canvas, an ImageData-backed DataTexture or
 * anything drawImage accepts; filters / wrap / colorSpace / anisotropy set on it are copied onto the
 * baked one (the file only carries pixels). Names are per chunk; use `common/` for chunk-independent
 * ones via `commonTexture`.
 */
import { publicBytes } from '../../../shared/engine/boot/tables';
import { bootFileList } from './filePolicy';
import * as THREE from 'three';
import { fetchImage, tierUrl, versionedUrl } from './bytes';
import { TIER } from '../core/tier';
import { ktx2Texture } from '../core/ktx2';
import { activeLevel } from '../../../shared/engine/level/selection';
import { levelBakedId } from '../../../shared/engine/level/spec';
import { labelAsset, labelClone } from '../render/gpuLabels';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const NOBAKE = params.has('nobake');

const loaded = new Map<string, ImageBitmap | HTMLImageElement | THREE.CompressedTexture>();
const raw = new Map<string, Uint8Array>();

const dir = (slug: string) => `/assets/baked/${slug}/tex/`;
/** chunk-independent lossless bakes (raw bytes, never given phone / KTX2 copies): fetched when the level's boot declares them */
const COMMON = '/assets/baked/common/';

/** Every baked texture file the build has for this chunk that its boot reads (declared in the boot manifest). */
export function bakedTextureUrls(slug: string, unread?: RegExp): string[] {
  const p = dir(slug);
  // phone copies: through tierUrl
  return Object.keys(publicBytes()).filter((k) => k.startsWith(p) && !k.includes('.phone.') && (unread === undefined || !unread.test(k)));
}

function urlFor(slug: string, name: string): string | null {
  const p = dir(slug);
  for (const ext of ['png', 'jpg']) { const u = `${p}${name}.${ext}`; if (u in publicBytes()) return u; }
  return null;
}

/** Fetch + decode every baked texture of the active chunk (one round of parallel fetches, ~ms from the SW cache). */
export async function preloadBakedTextures(): Promise<number> {
  if (NOBAKE) return 0;
  const level = activeLevel();
  const slug = levelBakedId(level);
  const urls = bakedTextureUrls(slug, level.boot.bakedUnread);
  const common = bootFileList(level.boot.files, TIER).filter((u) => u.startsWith(COMMON) && u.endsWith('.bin'));
  await Promise.all([...common.map(async (u) => {
    try {
      const r = await fetch(versionedUrl(u));
      if (r.ok) raw.set(u, new Uint8Array(await r.arrayBuffer()));
    } catch (e) { console.warn(`[baked] ${u}: ${(e as Error).message}`); }
  }), ...urls.map(async (u) => {
    // E157: the KTX2 stand-in when there is one (Y-flipped at encode, like fetchImage's bitmap)
    try { loaded.set(u, (await ktx2Texture(tierUrl(u))) ?? await fetchImage(u, Infinity, true)); }
    catch (e) { console.warn(`[baked] ${u}: ${(e as Error).message}`); }
  })]);
  return urls.length + common.length;
}

/**
 * Fetch a lossless common bake (`/assets/baked/common/*.bin`) the build has, when no boot has loaded it, so a later
 * `bakedBytes` finds it (op-hitch47: a grid region's cloud layer on a page whose level never declared the cloud field
 * marched the fbm on the main thread, 37-53 ms of the frame its cell's sky attached in). A missing file resolves too.
 */
export async function loadCommonBytes(url: string): Promise<void> {
  if (NOBAKE || raw.has(url) || !url.startsWith(COMMON) || !(url in publicBytes())) return;
  try {
    const r = await fetch(versionedUrl(url));
    if (r.ok) raw.set(url, new Uint8Array(await r.arrayBuffer()));
  } catch (e) { console.warn(`[baked] ${url}: ${(e as Error).message}`); }
}

/**
 * A lossless common bake's bytes (`/assets/baked/common/*.bin`) when the level declared it and it arrived with exactly
 * `length` bytes, else null (the caller computes the same bytes itself). The bytes are shared: never write into them.
 */
export function bakedBytes(url: string, length: number): Uint8Array | null {
  if (NOBAKE) return null;
  const bytes = raw.get(url);
  return bytes?.length === length ? bytes : null;
}

/**
 * The baked image as a texture (settings copied from a throw-away `make()`-free template), or
 * `make()`'s result.
 */
export function bakedTexture(name: string, make: () => THREE.Texture): THREE.Texture {
  const slug = levelBakedId(activeLevel());
  const url = NOBAKE ? null : urlFor(slug, name);
  const image = url ? loaded.get(url) : undefined;
  if (image instanceof THREE.CompressedTexture) { // mips come with the file; callers set wrap / filters / colorSpace as for an image
    const t = image.clone();
    t.needsUpdate = true;
    return labelClone(t, image, 'engine/bakedTexture', url ?? `generated/baked/${slug}/${name}`);
  }
  if (image) {
    // settings come from the procedural template: build it cheaply? No — `make` is the expensive part.
    // Callers set filters/wrap/colorSpace on the returned texture themselves (see the call sites).
    const t = new THREE.Texture(image);
    t.flipY = false; // fetchImage flips at decode (ImageBitmapLoader convention)
    t.needsUpdate = true;
    return labelAsset(t, 'engine/bakedTexture', url ?? `generated/baked/${slug}/${name}`);
  }
  const t = make();
  return labelAsset(t, 'engine/bakedTexture', `generated/baked/${slug}/${name}`);
}
