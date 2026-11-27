/** SF15 (J525): the cook's KTX2 encoder from a shardfile's own images. A shardfile carries one image per texture (JPG or
 * PNG, and GLBs holding them); the cook makes every KTX2 from it, so no shard carries a hand-made set. This is the hand-made
 * sets' recipe (sharddev `ktx2-settings.mjs` CLASS, `bake-ktx2.mjs` encode) run in basisu's own WebAssembly build
 * (`src/scripts/vendor/basisu/`, the build `astc6Wasm.ts` loads), so the box's cook job encodes with no child process:
 *
 *   srgb    UASTC LDR 4x4, level 2, no RDO, sRGB transfer and sRGB mips      colour, albedo, emissive, atlases, skies
 *   normal  UASTC LDR 4x4, level 2, the normal-map preset (linear mips)      tangent-space normal maps
 *   linear  UASTC LDR 4x4, level 2, linear                                    lightmaps, roughness, AO, ARM planes
 *
 * Every file gets its full mip chain (box filter, what the hand-made `-mipmap -mip_filter box` made) and Zstandard
 * supercompression. The hand-made sets put roughness and ARM planes in ETC1S; the cook keeps them UASTC, which looks at
 * least as good and is what the phone tier can trim and re-encode as ASTC 6x6 (`tierKtx2`), at about five times the
 * download of an ETC1S plane. A standalone image is Y-flipped at encode (`flip`: its loader drew the image with
 * `flipY = true`, and a compressed texture can't be flipped at upload); a GLB's images and a texture-array layer are not.
 *
 * `encode` is synchronous, as `shardHalf` calls it; `record` and `flush` run the same encodes on worker threads first, as
 * `wasmAstc6` does, and a cache folder keeps them across cooks and cook jobs (SF21, `encodeCache.ts`). */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createRequire} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {availableParallelism} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {Worker} from 'node:worker_threads';
import {BASISU_WASM_BUILD} from './astc6Wasm.ts';
import {encodeCacheDir, encodeKey, readKeptKtx2} from './encodeCache.ts';
import {encodeBudget, runLanes} from './encodeLanes.ts';
import type {TextureRole} from './tierTextures';

/** How one image is encoded: its texels' read and whether its loader flipped it. */
export interface ImageEncodeAs {readonly role: TextureRole; readonly flip: boolean}
/** A PNG or JPEG as a UASTC KTX2 with its full mip chain, or undefined when basisu can't read it. */
export type ImageKtx2Encode = (image: Uint8Array, as: ImageEncodeAs) => Uint8Array | undefined;

/** The encode's settings, in every cache key: a change is a new key, so no cook reads a file made with other settings. */
export const IMAGE_KTX2_SETTINGS = 'uastc-ldr-4x4 level 2, no rdo, box mips, zstd';
/** SF21: every key names the encoder and its tier, the build and the settings (`encodeCache.ts` adds the cook version). */
const KEY_PARTS = ['image-ktx2-wasm/2', 'desktop', BASISU_WASM_BUILD, IMAGE_KTX2_SETTINGS] as const;
const MAX_LANES = 6;
/** A UASTC encode's heap per texel (measured 2026-11-26: a 2048 JPG grew a heap by about 230 MB). */
const IMAGE_HEAP_PER_TEXEL = 60, HEAP_FLOOR = 32 << 20;
/** The heap a lane holds after encoding this image (the largest first, so a 4096 panorama never runs last). */
export function imageKtx2Heap(image: Uint8Array): number {
  const head = imageHead(image);
  return HEAP_FLOOR + (head === undefined ? 0 : head.width * head.height * IMAGE_HEAP_PER_TEXEL);
}
/** basisu's UASTC pack level 2 (`-uastc_level 2`): `cPackUASTCLevelDefault`. */
const UASTC_LEVEL_2 = 2;
/** basisu's box mip filter (`-mip_filter box`): index 0 of its filter table. */
const MIP_BOX = 0;

interface BasisEncoder {
  readonly setCreateKTX2File: (on: boolean) => void; readonly setKTX2UASTCSupercompression: (on: boolean) => void; readonly setDebug: (on: boolean) => void; readonly setStatusOutput: (on: boolean) => void;
  readonly setSliceSourceImage: (slice: number, image: Uint8Array, width: number, height: number, type: number) => boolean;
  readonly setFormatMode: (format: number) => void; readonly setFormatModeAndQualityEffort: (format: number, quality: number, effort: number, defaults: boolean) => void;
  readonly setSRGBPreset: () => void; readonly setLinearPreset: () => void; readonly setNormalMapPreset: () => void;
  readonly setPackUASTCFlags: (flags: number) => void; readonly setRDOUASTC: (on: boolean) => void; readonly setYFlip: (on: boolean) => void;
  readonly setMipGen: (on: boolean) => void; readonly setMipSRGB: (on: boolean) => void; readonly setMipFilter: (filter: number) => void;
  readonly setKTX2AndBasisSRGBTransferFunc: (srgb: boolean) => void;
  readonly encode: (out: Uint8Array) => number; readonly delete: () => void;
}
interface BasisModule {
  readonly initializeBasis: () => void;
  BasisEncoder: new () => BasisEncoder;
  basis_tex_format: {cUASTC_LDR_4x4: {value: number}};
  ldr_image_type: {cPNGImage: {value: number}; cJPGImage: {value: number}};
}
type BasisFactory = (options: {wasmBinary: Uint8Array; print: () => void; printErr: () => void}) => Promise<BasisModule>;

const PRESET = {srgb: 'setSRGBPreset', linear: 'setLinearPreset', normal: 'setNormalMapPreset'} as const satisfies Record<TextureRole, keyof BasisEncoder>;

/** The image's kind and size from its header: a PNG's IHDR, a WebP's VP8, VP8L or VP8X chunk (SF19), or a JPEG's first
 *  frame marker. Undefined for anything else. */
export function imageHead(bytes: Uint8Array): {readonly kind: 'png' | 'jpg' | 'webp'; readonly width: number; readonly height: number} | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return {kind: 'png', width: view.getUint32(16), height: view.getUint32(20)};
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) return webpHead(bytes, view);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0, length = view.getUint16(at + 2);
    // SOF0 to SOF15, less DHT (C4), JPG (C8) and DAC (CC): the frame header holds the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return {kind: 'jpg', width: view.getUint16(at + 7), height: view.getUint16(at + 5)};
    at += 2 + length;
  }
  return undefined;
}

/** SF19: a WebP's size from its first chunk: lossy (`VP8 `: 14 bits each after the frame's start code), lossless (`VP8L`:
 *  14 bits each, less one, after its signature) or extended (`VP8X`: the canvas, 24 bits each, less one). */
function webpHead(bytes: Uint8Array, view: DataView): {readonly kind: 'webp'; readonly width: number; readonly height: number} | undefined {
  const chunk = view.getUint32(12);
  if (chunk === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return {kind: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff};
  if (chunk === 0x5650384c && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); return {kind: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1}; }
  if (chunk === 0x56503858) return {kind: 'webp', width: (view.getUint32(24, true) & 0xffffff) + 1, height: (view.getUint32(27, true) & 0xffffff) + 1};
  return undefined;
}

/** SF19: basisu reads PNG and JPEG only, so a WebP is encoded from a PNG of its pixels. The PNGs are made ahead
 *  (`decodeWebp`, async: sharp has no synchronous decode) and kept per thread by the WebP's hash; `encode` stays
 *  synchronous, and a WebP no pass decoded stays an image, as every WebP did before SF19. */
const webpPngs = new Map<string, Uint8Array>();
const webpKey = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** The PNG `decodeWebp` made for this WebP, if any. */
export const decodedWebp = (bytes: Uint8Array): Uint8Array | undefined => webpPngs.get(webpKey(bytes));
/** Decode each WebP among `images` to a PNG of its pixels (lossless, alpha kept) for `encode` to read. False when sharp
 *  can't load here (the encodes then leave WebP as images); a WebP sharp refuses is left out. */
export async function decodeWebp(images: Iterable<Uint8Array>): Promise<boolean> {
  const todo = [...images].filter(bytes => imageHead(bytes)?.kind === 'webp' && !webpPngs.has(webpKey(bytes)));
  if (todo.length === 0) return true;
  let sharp: ((input: Uint8Array) => {png: (options: {compressionLevel: number}) => {toBuffer: () => Promise<Buffer>}}) | undefined;
  try { sharp = ((await import('sharp')) as unknown as {default: typeof sharp}).default; } catch { return false; }
  if (sharp === undefined) return false;
  const decode = sharp;
  await Promise.all(todo.map(async bytes => {
    try { webpPngs.set(webpKey(bytes), new Uint8Array(await decode(bytes).png({compressionLevel: 1}).toBuffer())); } catch { /* left an image */ }
  }));
  return true;
}

/** One encoder on this thread. */
export async function loadBasisuImageKtx2(): Promise<ImageKtx2Encode> {
  const require = createRequire(import.meta.url);
  const factory = require('../../scripts/vendor/basisu/basis_encoder.cjs') as BasisFactory;
  const wasm = new Uint8Array(readFileSync(new URL('../../scripts/vendor/basisu/basis_encoder.wasm', import.meta.url)));
  const basis = await factory({wasmBinary: wasm, print: () => undefined, printErr: () => undefined});
  basis.initializeBasis();
  const uastc = basis.basis_tex_format.cUASTC_LDR_4x4.value;
  return (input, {role, flip}) => {
    const first = imageHead(input), image = first?.kind === 'webp' ? decodedWebp(input) : input;
    const head = image === undefined ? undefined : imageHead(image);
    if (head === undefined || image === undefined || head.kind === 'webp') return undefined;
    const encoder = new basis.BasisEncoder();
    try {
      encoder.setDebug(false); encoder.setStatusOutput(false);
      encoder.setCreateKTX2File(true); encoder.setKTX2UASTCSupercompression(true);
      if (!encoder.setSliceSourceImage(0, image, 0, 0, head.kind === 'png' ? basis.ldr_image_type.cPNGImage.value : basis.ldr_image_type.cJPGImage.value)) return undefined;
      // The CLI's order (`astc6Wasm.ts`): the format, the role's preset, then the settings over both.
      encoder.setFormatMode(uastc);
      encoder[PRESET[role]]();
      encoder.setFormatModeAndQualityEffort(uastc, -1, -1, false);
      encoder.setPackUASTCFlags(UASTC_LEVEL_2); encoder.setRDOUASTC(false);
      encoder.setKTX2AndBasisSRGBTransferFunc(role === 'srgb');
      encoder.setMipGen(true); encoder.setMipSRGB(role === 'srgb'); encoder.setMipFilter(MIP_BOX);
      encoder.setYFlip(flip);
      const out = new Uint8Array(head.width * head.height * 2 + (1 << 20)), length = encoder.encode(out);
      return length > 0 ? out.slice(0, length) : undefined;
    } finally { encoder.delete(); }
  };
}

/** A worker thread's loop around `loadBasisuImageKtx2` (module hooks are per thread: `astc6Wasm.ts` WORKER). */
const WORKER = `const {parentPort, workerData} = process.getBuiltinModule('node:worker_threads');
import(workerData.hook).then(() => import(workerData.module)).then(async module => {
  const encode = await module.loadBasisuImageKtx2();
  parentPort.on('message', ({id, bytes, as}) => { let out; try { out = encode(bytes, as); } catch { out = undefined; } parentPort.postMessage({id, out}); });
  parentPort.postMessage({ready: true});
});`;

export interface WasmImageKtx2 {
  readonly encode: ImageKtx2Encode;
  /** Collects an input for `flush` and answers undefined, so a recording pass makes no file of its own. */
  readonly record: ImageKtx2Encode;
  readonly flush: () => Promise<void>;
  readonly stats: {encoded: number; reused: number; failed: number};
}

/** The cook's image encoder: `lanes` worker threads for `flush`, this thread for anything `flush` didn't see. */
export async function wasmImageKtx2(options: {readonly cacheDir?: string; readonly lanes?: number} = {}): Promise<WasmImageKtx2> {
  const cacheDir = encodeCacheDir(options.cacheDir), lanes = Math.max(1, Math.min(MAX_LANES, options.lanes ?? availableParallelism() - 2));
  if (cacheDir !== undefined) mkdirSync(cacheDir, {recursive: true});
  const stats = {encoded: 0, reused: 0, failed: 0};
  const keyOf = (image: Uint8Array, as: ImageEncodeAs): string => encodeKey([...KEY_PARTS, as.role, as.flip ? 'flip' : 'keep'], image);
  const done = new Map<string, Uint8Array | null>(), pending = new Map<string, {bytes: Uint8Array; as: ImageEncodeAs}>();
  const stored = (key: string): Uint8Array | undefined => cacheDir === undefined ? undefined : readKeptKtx2(join(cacheDir, `${key}.ktx2`));
  const keep = (key: string, out: Uint8Array | undefined): void => {
    done.set(key, out ?? null);
    if (out === undefined) { stats.failed++; return; }
    stats.encoded++;
    if (cacheDir !== undefined) { const path = join(cacheDir, `${key}.ktx2`), temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, out); renameSync(temp, path); }
  };
  const here = await loadBasisuImageKtx2();
  const encode: ImageKtx2Encode = (image, as) => {
    const key = keyOf(image, as), kept = done.get(key);
    if (kept !== undefined) return kept ?? undefined;
    const hit = stored(key);
    if (hit !== undefined) { stats.reused++; done.set(key, hit); return hit; }
    let out: Uint8Array | undefined;
    try { out = here(image, as); } catch { out = undefined; }
    keep(key, out);
    return out;
  };
  const record: ImageKtx2Encode = (image, as) => {
    const key = keyOf(image, as);
    if (done.has(key)) return undefined;
    const hit = stored(key);
    if (hit === undefined) pending.set(key, {bytes: new Uint8Array(image), as});
    else { stats.reused++; done.set(key, hit); }
    return undefined;
  };
  const flush = async (): Promise<void> => {
    const jobs = [...pending]; pending.clear();
    if (jobs.length === 0) return;
    // SF19: a worker thread has no PNG of a WebP, so it is sent the PNG (the key stays the WebP's)
    await decodeWebp(jobs.map(([, input]) => input.bytes));
    const module = new URL('imageKtx2Wasm.ts', import.meta.url).href;
    const hook = new URL('../../scripts/format-hook.mjs', import.meta.url).href;
    // SF15: lanes bounded by their heaps as well as their count (`encodeLanes.ts`). A lane's refusal isn't kept: the real
    // pass encodes that input again on this thread, and counts a failure there.
    await runLanes(jobs.map(([key, input]) => ({key, input, heap: imageKtx2Heap(input.bytes)})), {
      lanes, budget: encodeBudget(),
      spawn: () => new Worker(WORKER, {eval: true, workerData: {module, hook}}),
      message: (job, id) => ({id, bytes: decodedWebp(job.input.bytes) ?? job.input.bytes, as: job.input.as}),
      done: (job, out) => { if (out !== undefined) keep(job.key, out); },
    });
  };
  return {encode, record, flush, stats};
}
