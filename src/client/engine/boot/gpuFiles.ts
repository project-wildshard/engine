/**
 * GPU-compressed textures (E157): which file a loader fetches when textures ride as KTX2 instead of images.
 *
 * A JPEG / WebP decodes to RGBA8 on the GPU — 4 bytes a texel, ~5.3 with mips — however small the file was. KTX2 / Basis
 * Universal files (scripts/bake-ktx2.mjs) are transcoded to a format the GPU samples compressed: ASTC 4×4 on the iPhone
 * (1 byte a texel), ASTC 4×4 on an Apple Silicon Mac's Chrome too (ANGLE Metal exposes no BPTC), BC7 on a desktop GPU that
 * has it, ETC2 for the ETC1S planes (½ byte; BC1 / BC3 where there is no ETC2). Same pictures, a quarter of the memory,
 * no decode on the main thread and no mipmap generation — which is what lets several shards stay resident on a phone.
 * Both tiers have their own set (E173: the desktop's at the full-res files' size; Pine Hollow 950 → 360 MB of textures).
 *
 * `gpuFile(served)` maps a URL the tier already fetches (after `tierUrl`: the phone's `.phone.webp` / `.phone.glb`) to its
 * KTX2 stand-in (`/assets/gpu/…-<hash8>.ktx2|glb|gltf`, content-addressed), or undefined — no stand-in, or this page
 * loads images. Images: the texture loaders ask (src/client/engine/core/ktx2.ts); models: `tierUrl` itself swaps a .glb / .gltf
 * (src/client/engine/boot/bytes.ts), so three's loaders, the boot pack and the manifest all see the same file. Every lookup also takes
 * an explicit mode (`standIn(served, tex)`), so a list can be computed for the OTHER mode (the background download).
 *
 * WHICH mode a resident build loads with (G188 supersedes the universal E157 images-first rule; G386 retired the
 * Debug ▸ GPU textures row, so only a test or capture pins a mode, through `__wildshardHarness.textures`):
 *   harness pin textures = 'img'    never KTX2;
 *                        = 'ktx2'   always KTX2 (a set not cached yet downloads with the boot);
 *   no pin (every player)           a measured over-cap phone estimate selects KTX2 immediately;
 *                                                      otherwise the tier policy wins, or KTX2 whenever THIS shard has a
 *                                                      KTX2 set for this tier, from the first visit (DL17, G1000: textures
 *                                                      are in their final format at control; the old "images until the set
 *                                                      is cached" rule drew images and swapped on the next visit). The set
 *                                                      downloads with the boot; src/client/engine/boot/shardPrefetch.ts still
 *                                                      caches and marks it (the marker's hash) for the record.
 * G188: a measured images-first playing estimate above the phone cap selects KTX2 on the first visit.
 * A harness pin still wins; desktop is unchanged.
 * Whatever picks KTX2, the KTX2 capability probe (src/client/engine/render/ktx2Probe.ts) runs once first and turns it into Images
 * when this GPU samples mipmapped compressed textures wrong in every compressed format the transcoder could target.
 * OF17 (one form per device and tier): a shard this device has read as KTX2 stays KTX2 on every page of this tier, where the
 * page's own rule would pick images (a grid page's over-cap estimate counts its residents, a one-shard page's doesn't, so
 * the two disagreed on Nine Dragon and the offline page asked for images it never cached). Only towards KTX2: it is never
 * the bigger form. And when one form of a file fails to read and the cache holds the other, the loader reads the held
 * one (core/ktx2.ts `readHeldForm`), so a form the warm visit never read can't park LOAD on RETRY.
 * Resolved once per SHARD BUILD, on the build's first question (`texMode()`), and never changed inside it: no swap in a
 * running resident. A grid page can build multiple residents, each with its own TexturePolicyBinding.
 * The harness pin applies to that page's build. The
 * resolver that checks the marker is registered by shardPrefetch.ts (it owns the set's list); a page that never loads it
 * (dev pages, the bake scripts in Node) reads Auto as Images.
 */

import { GPU_FILES as ENGINE_GPU_FILES } from './ktx2.generated';
import { TIER } from '../core/tier';
import { pageURL } from './contentBase';
import { CONTENT_CAPS, PAGE_LEVEL } from '../../../shared/engine/core/config';
import { harnessPins } from '../../../shared/engine/app/identity';
import { ktx2Probe, ktx2ProbeResult, type Ktx2Probe } from '../render/ktx2Probe';

export interface Ktx2Table { readonly phone: Readonly<Record<string, string>>; readonly desktop: Readonly<Record<string, string>> }
const GPU_FILES = { phone: { ...ENGINE_GPU_FILES.phone }, desktop: { ...ENGINE_GPU_FILES.desktop } };
let registered = { phone: new Set(Object.values(GPU_FILES.phone)), desktop: new Set(Object.values(GPU_FILES.desktop)) };
export function registerGpuFiles(table: Ktx2Table): void {
  Object.assign(GPU_FILES.phone, table.phone);
  Object.assign(GPU_FILES.desktop, table.desktop);
  registered = { phone: new Set(Object.values(GPU_FILES.phone)), desktop: new Set(Object.values(GPU_FILES.desktop)) };
}

/** Whether this tier's registered KTX2 mappings name a URL, including shard overlays outside /assets/gpu/. */
export function isRegisteredGpuFile(url: string): boolean {
  return registered[TIER].has(url.replace(/[?#].*$/u, ''));
}

/** WILDSHARD-GAME-89: stand-ins a table names but the host does not serve (a shardfile that left them out). Never
 *  asked for again on this page: `standIn` answers undefined, so the tier's own file loads. */
const retired = new Set<string>();
/** Retire a registered stand-in that answered 404 (an absolute URL, a content-base URL or a path; query and origin are
 *  ignored). 'new': first retired now, so the caller reports it once; 'retired': an earlier caller did (three shares one
 *  read among concurrent loads and fails them all); either way the caller retries the served file. undefined: no stand-in. */
export function retireGpuFile(url: string): 'new' | 'retired' | undefined {
  let path = url.replace(/[?#].*$/u, '');
  try { path = new URL(pageURL(path), 'http://page.invalid').pathname; } catch { /* keep the path as given */ }
  if (retired.has(path)) return 'retired';
  if (!isRegisteredGpuFile(path)) return undefined;
  retired.add(path);
  return 'new';
}

export type TexMode = 'ktx2' | 'img';

/** the one level selected for this page (core/config's PAGE_LEVEL: captured by the registry's first apply) */
/** the level a build's texture policy is for (setTexturePolicy); the page's level when unset */
interface TexturePolicyState {
  readonly level: string | undefined;
  readonly policy: { mode: TexMode; why: string } | undefined;
  resolved: { mode: TexMode; why: string } | null;
  /** OF17: this build's KTX2 read is already in the device's memory */
  kept?: boolean;
}
let pagePolicy: TexturePolicyState = { level: undefined, policy: undefined, resolved: null };
const policyFrames: { state: TexturePolicyState }[] = [];
const activePolicy = (): TexturePolicyState => policyFrames.at(-1)?.state ?? pagePolicy;
/** the mode a test or capture pinned before the boot (`__wildshardHarness.textures`, G386), else 'auto': the shipped policy */
export function texturePin(): TexMode | 'auto' { return harnessPins()?.textures ?? 'auto'; }

let autoReady: ((slug: string) => boolean) | null = null;
/** shardPrefetch.ts: how Auto learns that a shard's KTX2 set is cached (the marker check) */
export function setAutoKtx2Check(fn: (slug: string) => boolean): void { autoReady = fn; }

/** OF17: the device's memory of the shards it has read as KTX2 on this tier (shardPrefetch.ts keeps it with the markers) */
export interface DeviceTexForm { read: (slug: string) => boolean; keep: (slug: string) => void }
let deviceForm: DeviceTexForm | null = null;
export function setDeviceTexForm(memory: DeviceTexForm | null): void { deviceForm = memory; }

/** G188's automatic tier policy: measured over-cap phone builds use KTX2 before the first visit, never desktop. */
export function autoTexturePolicy(mode: TexMode | undefined, imagesFirstPlayingBytes?: number): { mode: TexMode; why: string } | undefined {
  if (imagesFirstPlayingBytes !== undefined && (!Number.isSafeInteger(imagesFirstPlayingBytes) || imagesFirstPlayingBytes < 0)) throw new RangeError('Invalid images-first playing estimate');
  if (TIER === 'phone' && imagesFirstPlayingBytes !== undefined && imagesFirstPlayingBytes > CONTENT_CAPS.playing) {
    return { mode: 'ktx2', why: `auto: images-first playing estimate ${imagesFirstPlayingBytes} exceeds ${CONTENT_CAPS.playing}` };
  }
  return mode === undefined ? undefined : { mode, why: 'auto: level tier texture policy' };
}
/** The composition root installs tier data before this build resolves its file list. */
/** a build's texture policy (its tier's `textures`) and the level it is for (the page's level when omitted); the mode resolves afresh */
export function setTexturePolicy(mode: TexMode | undefined, level?: string, imagesFirstPlayingBytes?: number): void {
  pagePolicy = { level, policy: autoTexturePolicy(mode, imagesFirstPlayingBytes), resolved: null };
}
/**
 * One resident's immutable texture choice, resolved once with the ordinary Debug/Auto precedence.
 * Enter with its frame or exclusive asset-build scope and release before another frame resumes.
 * Nested and out-of-order leaves preserve both the resident choice and the configured home choice.
 */
export class TexturePolicyBinding {
  private readonly state: TexturePolicyState;
  constructor(mode: TexMode | undefined, level: string, imagesFirstPlayingBytes?: number) {
    this.state = { level, policy: autoTexturePolicy(mode, imagesFirstPlayingBytes), resolved: null };
  }
  enter(): () => void {
    const frame = { state: this.state }; policyFrames.push(frame);
    return () => { const index = policyFrames.indexOf(frame); if (index !== -1) policyFrames.splice(index, 1); };
  }
}
let resolving = false;
/** A phone-tier GPU that can't sample raw ASTC: absent, or read wrong by the probe (the iOS Simulator has the extension and
 *  zeroes sRGB mips). No verdict (no page, or a measurement pin) changes nothing. The transcoder reads this same probe. */
const noRawAstc = (probe: Ktx2Probe): boolean => probe.ran && probe.families.astc !== true;
/** S4: an overlay's raw ASTC 6×6 files have no transcode, so a phone-tier GPU that can't sample ASTC loads images.
 *  S12d: the cook's phone files (`<name>.t<size>-<hash8>.<ext>`) are 6×6 too, and replace the hand-made overlay. */
const RAW_ASTC = /\/astc6\/|\.t[0-9]+-[a-f0-9]{8}\.(?:ktx2|glb)$/u;
export function rawAstcVeto(probe: Ktx2Probe): string | null {
  if (TIER !== 'phone' || !noRawAstc(probe) || ![...registered.phone].some(url => RAW_ASTC.test(url))) return null;
  return 'this table names raw ASTC 6×6 and the GPU has no ASTC';
}
/** S4: which tier's splat layers this device draws. A phone's are raw ASTC 6×6, so a phone that can't sample ASTC draws the
 *  desktop's Basis set, read whole from the blobs only by such a device. Needs no renderer: products are admitted before one. */
export function splatTierOn(tier: 'phone' | 'desktop', probe: () => Ktx2Probe): 'phone' | 'desktop' { return tier === 'phone' && noRawAstc(probe()) ? 'desktop' : tier; }
export function splatDrawTier(): 'phone' | 'desktop' { return splatTierOn(TIER, ktx2Probe); }
/** the mode this page loads with, and why (fixed on the first call) */
export function texModeWhy(): { mode: TexMode; why: string } {
  const state = activePolicy();
  if (state.resolved !== null) return state.resolved;
  if (resolving) throw new Error('texMode(): asked while it is being resolved — pass the mode explicitly');
  resolving = true;
  try {
    const picked = texturePin();
    if (picked !== 'auto') state.resolved = { mode: picked, why: `pinned (harness textures: ${picked})` };
    else {
      const slug = state.level ?? PAGE_LEVEL;
      if (state.policy !== undefined) state.resolved = state.policy;
      // DL17 (G1000): textures are in their final format at control, so a shard with a KTX2 set boots with it from the first
      // visit (its stand-ins download with the boot) instead of drawing images and swapping on the next visit
      else state.resolved = autoReady?.(slug) === true ? { mode: 'ktx2', why: `auto: ${slug} has a KTX2 set (its final format from the first visit)` } : { mode: 'img', why: `auto: ${slug} has no KTX2 set for this tier` };
      // OF17: a shard this device has read as KTX2 keeps that form on this page too (the grid's choice on a one-shard page)
      if (state.resolved.mode === 'img' && deviceForm?.read(slug) === true) state.resolved = { mode: 'ktx2', why: `auto: this device read ${slug} as KTX2 (OF17)` };
    }
    // last, whatever picked KTX2 (a harness pin included): a GPU that samples the transcoder's only compressed targets
    // wrong when mipmapped loads images (render/ktx2Probe.ts — the iOS Simulator's zeroed sRGB ASTC / ETC2 mips; a
    // measurement-only harness pin skips the probe there, G386)
    if (state.resolved.mode === 'ktx2') {
      const probe = ktx2Probe(), veto = probe.veto ?? rawAstcVeto(probe);
      if (veto !== null) state.resolved = { mode: 'img', why: `${state.resolved.why}; overruled: ${veto}` };
    }
  } finally { resolving = false; }
  return state.resolved;
}
export const texMode = (): TexMode => texModeWhy().mode;

/** what this page's textures load as and why, with the KTX2 capability probe's result (`__wildshard.textures()`, the perf panel) */
export function textureReport(): { mode: TexMode; why: string; probe: Ktx2Probe | null } {
  return { ...texModeWhy(), probe: ktx2ProbeResult() };
}

/** the KTX2 stand-in of `served` (a path, after tierUrl) in mode `tex`, or undefined */
export function standIn(served: string, tex: TexMode): string | undefined {
  const file = tex === 'ktx2' ? GPU_FILES[TIER][served] : undefined;
  return file === undefined || retired.has(file) ? undefined : file;
}
/** the KTX2 stand-in of a file this tier fetches, when this page loads KTX2 */
export function gpuFile(served: string): string | undefined {
  const file = standIn(served, texMode());
  if (file !== undefined) keepKtx2Read();
  return file;
}
/** OF17: this build reads a KTX2 stand-in under Auto: the device remembers the shard's form (once per build) */
function keepKtx2Read(): void {
  const state = activePolicy();
  if (state.kept === true || deviceForm === null || texturePin() !== 'auto') return;
  state.kept = true;
  deviceForm.keep(state.level ?? PAGE_LEVEL);
}
