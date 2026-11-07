import { TIER_TABLE, type EngineTierKnobs } from '../render/tiers';
import type { TierKnobs } from '../../../shared/engine/level/spec';
import { saveStorage } from '../saves/slots';
/**
 * Quality tier, picked once at boot. Phones get smaller textures, fewer shadow cascades, no AO and a
 * DPR cap — the difference between "loads in minutes then dies" and playable. `?tier=phone|desktop`
 * overrides for testing, else main menu ▸ Settings ▸ Quality (E55, `setting('tier')`). Every knob below is measured in
 * project/archive/2026-09-22-play-perf.md.
 */
import { arrivalTier, mobileDevice } from '../boot/titleArrival';

const savedStorage = saveStorage('global');

export type Tier = 'phone' | 'desktop';

const mobileUA = mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

/** the tier 'auto' picks on this device (Settings shows it) */
export let automaticTier: Tier = mobileUA ? 'phone' : 'desktop';
export let TIER: Tier = automaticTier;


export const TIER_CONFIG: EngineTierKnobs & Partial<Record<`${string}.${string}`, number | boolean>> = { ...TIER_TABLE[TIER] };

let buildingAs: Tier | null = null;
/** the tier a model builds at: TIER, or the one Explore's DETAIL TIERS builds it as (explore/tiers.ts `withTier`). A level's
 *  own knob tables (its scatter counts, its detail levels) index by this, as the engine's read TIER_CONFIG. */
export function buildTier(): Tier { return buildingAs ?? TIER; }
/** @internal — explore/tiers.ts `withTier` only */
export function _buildAs(tier: Tier | null): void { buildingAs = tier; }

/**
 * The player's graphics prefs — the menu's Settings ▸ Graphics rows (src/client/engine/ui/Menu.ts), read once at boot, so a
 * change needs a restart. 'auto' = the tier default above. The old DBG pill kept a tier / dpr / aa / meter
 * override under 'ws.debug'; the pill is gone and that key is dropped once so a stale override stops applying.
 */
export interface GfxPrefs { dpr: 'auto' | '1' | '1.25' | '1.5' | '2' | 'native'; aa: 'auto' | 'on' | 'off' }
const GFX_KEY = 'gfx';
function readGfxPrefs(): GfxPrefs {
  const prefs: GfxPrefs = { dpr: 'auto', aa: 'auto' };
  try {
    const raw = JSON.parse(savedStorage.getItem(GFX_KEY) ?? '{}') as Partial<Record<string, unknown>>;
    const dpr = raw['dpr'], aa = raw['aa'];
    if (dpr === '1' || dpr === '1.25' || dpr === '1.5' || dpr === '2' || dpr === 'native') prefs.dpr = dpr;
    if (aa === 'on' || aa === 'off') prefs.aa = aa;
  } catch { /* private mode / disabled storage: tier defaults */ }
  return prefs;
}
export const gfxPrefs: GfxPrefs = readGfxPrefs();
export function saveGfxPrefs(): void { try { savedStorage.setItem(GFX_KEY, JSON.stringify(gfxPrefs)); } catch { /* private mode */ } }

// 'native' = the screen's own density (the renderer caps at min(devicePixelRatio, dpr)): sharpest, and the costliest fill
export let MOBILE_DEVICE: boolean = mobileUA || TIER === 'phone';

export function initializeTier(tier: Tier): void;
export function initializeTier(): Promise<void>;
export function initializeTier(tier?: Tier): void | Promise<void> {
  // Bakers and tier comparisons already name a tier and must retain their synchronous data path.
  if (tier !== undefined) { configureTier(tier); return; }
  return import('../render/tierBoot').then(async ({ bootTier }) => {
    const picked = await bootTier();
    if (picked.via !== 'harness' && picked.via !== 'setting') automaticTier = picked.tier;
    configureTier(picked.tier);
    return undefined;
  });
}
function resetTierConfig(): void {
  for (const key of Object.keys(TIER_CONFIG)) if (key.includes('.')) Reflect.deleteProperty(TIER_CONFIG, key);
  Object.assign(TIER_CONFIG, TIER_TABLE[TIER]);
}
function configureTier(tier: Tier): void {
  TIER = tier;
  arrivalTier.current = tier;
  resetTierConfig();
  if (gfxPrefs.dpr !== 'auto') TIER_CONFIG.dpr = gfxPrefs.dpr === 'native' ? 4 : Number(gfxPrefs.dpr);
  if (gfxPrefs.aa === 'on' && TIER_CONFIG.smaa === 'off') TIER_CONFIG.smaa = 'low';
  if (gfxPrefs.aa === 'off') TIER_CONFIG.smaa = 'off';
  MOBILE_DEVICE = mobileUA || TIER === 'phone';
}

/** Resolve the numeric tier row before the level builds sky, forest and carpet. */
export function applyLevelTier(knobs: TierKnobs | undefined): void {
  resetTierConfig();
  for (const key of Object.keys(TIER_TABLE[TIER]) as (keyof EngineTierKnobs)[]) {
    const value = knobs?.[key];
    if (value !== undefined) Reflect.set(TIER_CONFIG, key, value);
  }
  for (const [key, value] of Object.entries(knobs ?? {})) if (key.includes('.') && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))) Reflect.set(TIER_CONFIG, key, value);
  if (gfxPrefs.dpr !== 'auto') TIER_CONFIG.dpr = gfxPrefs.dpr === 'native' ? 4 : Number(gfxPrefs.dpr);
  if (gfxPrefs.aa === 'on' && TIER_CONFIG.smaa === 'off') TIER_CONFIG.smaa = 'low';
  if (gfxPrefs.aa === 'off') TIER_CONFIG.smaa = 'off';
}

/** a phone or tablet (its user agent), or the phone tier on any device (a headless phone run renders what the phone does) */


/** the on-device perf probe's uncapped rows (src/client/engine/ui/perfProbe.ts): the frame's real cost, for the probe's own seconds only */
export const frameProbe = { uncapped: false };

/**
 * The frame cap in fps, 0 = none (the display's own rate). Only the capture harness overrides auto.
 *
 * G896 (Jake, 2026-10-29, battery audit: 60 fps doubled the work and a hot phone throttled to 17 fps; "30 always on the
 * phone") supersedes G876's 60: every mobile shard caps at 30 in every state, including the practice arena (E193's cap,
 * back). The held-build floor is 30 fps too. The probe's uncapped rows and the capture harness's `?fps=60` still measure
 * the uncapped cost.
 * Desktop uses the display's rate unless the capture harness explicitly caps it at 30. Stored menu picks do not apply.
 */
/** The practice arena is open; G896 gives every mobile shard the same 30 fps cap. */
export const practiceFps = { on: false };
// Capture protocol only: retired stored Frame cap picks never affect play.
let fpsSearch: string | undefined, harnessFps: string | null = null;

export function frameCapFps(): number {
  if (frameProbe.uncapped) return 0;
  const search = typeof location === 'undefined' ? '' : location.search;
  if (search !== fpsSearch) { fpsSearch = search; harnessFps = new URLSearchParams(search).get('fps'); }
  if (MOBILE_DEVICE) return harnessFps === '60' ? 0 : 30;
  return harnessFps === '30' ? 30 : 0;
}
