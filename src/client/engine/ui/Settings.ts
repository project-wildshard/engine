import { saveStorage } from '../saves/slots';
// src/client/engine/ui/Settings.ts — persisted player toggles + sliders (localStorage 'settings'); the menu's Settings tab (src/client/engine/ui/Menu.ts) writes here.
//
//   getSetting('aimAssist')                          → boolean (default true)
//   setSetting('tracers', false)                     → persists + notifies subscribers
//   const off = onSetting('aimAssist', (v) => …)     → unsubscribe; fn is NOT called immediately
//   getNumber('volume') / setNumber('volume', 0.8) / onNumber('volume', fn)   → the sliders, clamped to NUM_RANGE: 0..1 volumes
//   (master, 'music' = the score's bus) and the 0.5..2× look multipliers ('look' = touch drag + mouse, 'swingLook' = extra
//   factor while a sword swing is running — TouchControls / Player.ts read them per event, nothing to subscribe)
//   The music style is not a setting (J304, AUDIO AU16): the engine plays its one style, piano, and the synth score only
//   where a recording fails. A save from before still holding `musicStyle` is ignored on load and dropped on the next save.
//   getSfxSet() → Best samples; missing samples retain the synth fallback (G221).
//
//
// The OPTIONS (E55) — every player-facing toggle that used to be a query param, one lookup for all of them:
//   setting('tier')                    → the value THIS page runs with: the URL's param when present (the agents' screenshot
//                                        harnesses depend on it), else the saved pick, else the default
//   savedSetting('tier') / saveSetting('tier', 'phone') / onSettingChange('time', fn)
//   BOOT_OPTIONS (quality tier, touch) are read once while the page loads: saving one changes only the
//   saved pick — main menu ▸ Settings (src/client/engine/ui/BootSettings.ts) shows them with APPLY & RELOAD (settingsReloadUrl drops
//   the overriding params so the reload builds the saved pick). The rest are LIVE (pause menu ▸ Settings, src/client/engine/ui/Menu.ts):
//   saving one changes setting() at once and notifies (main.ts hands it to the day clock's setTime).
//   The Look Lab switches the user has picked a winner for are gone (E136: island, edge, lighting, sky, post, lut, matte):
//   a value a player saved for one before is never read, and the next save drops it from savedStorage.
//
// localStorage is wrapped in try/catch (iOS private mode throws on write) — the in-memory copy is the truth for the session.
//
// A listener a resident shard adds while it builds or runs is removed when that shard is evicted (src/shared/engine/app/ownership.ts).
import { onOwnerDispose } from '../../../shared/engine/app/ownership';
import type { SfxSet } from '../../../shared/engine/audio/bootAudio';
import { isDev, onDev } from '../core/devMode';

export type SettingKey = 'aimAssist' | 'tracers' | 'haptics' | 'autoLock' | 'huntersEye' | 'holdLoading';
export type NumberKey = 'volume' | 'music' | 'look' | 'swingLook' | 'lockCam';

const STORE = 'settings';
// autoLock: a kill re-locks the next enemy (E50); huntersEye: the bow's dotted drop arc while drawing (Nalati, src/engine/player/Bow.ts) — on by default on touch, off with a mouse
const DEFAULTS: Record<SettingKey, boolean> = { aimAssist: true, tracers: true, haptics: true, autoLock: true, huntersEye: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  holdLoading: false }; // Developer-only completion hold; public entry ignores the saved pick.
const NUM_DEFAULTS: Record<NumberKey, number> = { volume: 0.8, music: 0.7, look: 1, swingLook: 0.7, lockCam: 0.5 }; // lockCam: the lock-on camera, Follow 1 / Gentle 0.5 / Off 0 (E50: Jake picked Gentle)
export const NUM_RANGE: Record<NumberKey, readonly [number, number]> = { volume: [0, 1], music: [0, 1], look: [0.5, 2], swingLook: [0.5, 2], lockCam: [0, 1] };
const clampNum = (k: NumberKey, v: number) => Math.min(NUM_RANGE[k][1], Math.max(NUM_RANGE[k][0], v));

function load(savedStorage: Pick<Storage, 'getItem'>): { bools: Record<SettingKey, boolean>; nums: Record<NumberKey, number>; parsed: Partial<Record<string, unknown>> } {
  const bools = { ...DEFAULTS }, nums = { ...NUM_DEFAULTS };
  let parsed: Partial<Record<string, unknown>> = {};
  try {
    const raw = savedStorage.getItem(STORE);
    if (raw) {
      parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
      for (const k of Object.keys(DEFAULTS) as SettingKey[]) if (typeof parsed[k] === 'boolean') bools[k] = parsed[k];
      for (const k of Object.keys(NUM_DEFAULTS) as NumberKey[]) { const v = parsed[k]; if (typeof v === 'number' && Number.isFinite(v)) nums[k] = clampNum(k, v); }
    }
  } catch { /* private mode / disabled storage: defaults */ }
  return { bools, nums, parsed };
}

/** a pick among fixed strings (the OPTIONS): saved under `key`, overridable by the URL for the
 *  page's life — the URL value wins until the player picks in the menu, and is never persisted on its own. A `boot` pick
 *  only changes what is saved: `value` stays what the page was built with until the reload. */
class Choice<T extends string> {
  private current: T | undefined;
  private pick: T | undefined;
  private readonly fallback: () => T;
  get stored(): T { return this.pick ?? this.fallback(); }
  get value(): T { return this.current ?? this.stored; }
  get hasSavedPick(): boolean { return this.pick !== undefined; }
  /** the URL set `value` for this load */
  readonly fromUrl: boolean;
  readonly listeners = new Set<(v: T) => void>();
  // plain fields, not constructor parameter properties: node's type stripping (the boot-pack bake imports this module
  // through the boot manifest) can't load parameter properties
  readonly key: string;
  readonly values: readonly T[];
  readonly boot: boolean;
  private readonly persist: () => void;
  constructor(key: string, values: readonly T[], fallback: T | (() => T), url: (q: URLSearchParams) => string | null, boot: boolean, ctx: { saved: Partial<Record<string, unknown>>; persist: () => void; search: () => string }) {
    this.key = key; this.values = values; this.boot = boot; this.persist = ctx.persist;
    this.fallback = typeof fallback === 'function' ? fallback : () => fallback;
    this.pick = this.valid(ctx.saved[key]);
    let u: T | undefined;
    try { u = this.valid(url(new URLSearchParams(ctx.search()))); } catch { u = undefined; }
    this.fromUrl = u !== undefined;
    this.current = u ?? (boot ? this.stored : undefined);
  }
  valid(v: unknown): T | undefined { return this.values.find((x) => x === v); }
  set(v: T): void {
    if (this.valid(v) === undefined) return;
    if (this.boot) {
      if (this.stored === v && this.hasSavedPick) return;
      const changed = this.stored !== v;
      this.pick = v;
      this.persist();
      if (changed) this.listeners.forEach((fn) => fn(v));
      return;
    }
    if (this.value === v && this.stored === v && this.hasSavedPick) return;
    const changed = this.value !== v;
    this.current = v; this.pick = v;
    this.persist();
    if (changed) this.listeners.forEach((fn) => fn(v));
  }
  override(v: T | null): void {
    if (this.boot) return;
    const previous = this.value;
    this.current = v ?? undefined;
    if (previous !== this.value) this.listeners.forEach((fn) => fn(this.value));
  }
  on(fn: (v: T) => void): () => void { this.listeners.add(fn); const off = (): void => { this.listeners.delete(fn); }; onOwnerDispose(off); return off; }
}

// ── the OPTIONS (E55): the player-facing toggles that were query params — see the header ──
export const OPTION_VALUES = {
  tier: ['auto', 'phone', 'desktop'],                  // quality tier (src/client/engine/core/tier.ts); auto = phone on a mobile UA
  touch: ['auto', 'on'],                               // on-screen controls (main.ts → TouchControls): auto = coarse pointer
  time: ['live', 'midday', 'golden', 'sunset', 'night'], // the day / night clock (the level backdrop's) — live
  weather: ['live', 'clear', 'fog', 'rain'],           // Pine Hollow: the weather (PH-L10, src/shards/pine-hollow/world/weather.ts) — live: dawn fog + showers; clear = none (the before); fog / rain hold one — live
} as const;
export type OptionKey = keyof typeof OPTION_VALUES;
export type OptionValue<K extends OptionKey> = (typeof OPTION_VALUES)[K][number];
/** read once while the page loads: main menu ▸ Settings, APPLY & RELOAD. Every other option applies live (pause menu). */
export const BOOT_OPTIONS: readonly OptionKey[] = ['tier', 'touch'];
/** per option: the default, the URL params that override it (dropped by settingsReloadUrl) and how they read */
const OPTION_SPECS: { [K in OptionKey]: { def: OptionValue<K> | null; params: readonly string[]; url: (q: URLSearchParams) => string | null } } = {
  tier: { def: 'auto', params: ['tier'], url: (q) => q.get('tier') },
  touch: { def: 'auto', params: ['touch'], url: (q) => (q.has('touch') ? 'on' : null) },               // ?touch (any value) forces them, as before
  time: { def: 'live', params: ['tod', 'clock'], url: (q) => (q.has('tod') || q.has('clock') ? 'live' : null) }, // ?tod= / ?clock= run the clock from the URL's phase / speed
  weather: { def: 'live', params: ['weather'], url: (q) => q.get('weather') },                         // ?weather=rain: a held shower (captures)
};
const OPTION_KEYS = Object.keys(OPTION_VALUES) as OptionKey[];
/** Diagnostic choices are ignored by the public build; their saved picks remain available in Developer mode. */
export const DEVELOPER_OPTIONS: readonly OptionKey[] = ['time', 'weather'];

/** the URL params that override option `k` */
export function settingParams(k: OptionKey): readonly string[] { return OPTION_SPECS[k].params; }
/** `href` without any param that overrides an option (and the music / sfx picks) nor the `extra` ones: APPLY & RELOAD
 *  loads this, so the saved picks win (the chunk and every other dev param stay) */
export function settingsReloadUrl(href: string, extra: readonly string[] = []): string {
  const u = new URL(href);
  for (const p of [...OPTION_KEYS.flatMap((k) => OPTION_SPECS[k].params), ...extra]) u.searchParams.delete(p);
  return u.toString();
}

/** a page's settings (createSettings): the options, the toggles, the numbers and the sfx set */
export interface Settings {
  setting: <K extends OptionKey>(k: K) => OptionValue<K>;
  savedSetting: <K extends OptionKey>(k: K) => OptionValue<K>;
  saveSetting: <K extends OptionKey>(k: K, v: OptionValue<K>) => void;
  overrideSetting: <K extends OptionKey>(k: K, v: OptionValue<K> | null) => void;
  onSettingChange: <K extends OptionKey>(k: K, fn: (v: OptionValue<K>) => void) => () => void;
  settingFromUrl: (k: OptionKey) => boolean;
  pendingReload: () => OptionKey[];
  getSetting: (k: SettingKey) => boolean;
  setSetting: (k: SettingKey, v: boolean) => void;
  getNumber: (k: NumberKey) => number;
  setNumber: (k: NumberKey, raw: number) => void;
  onNumber: (k: NumberKey, fn: (v: number) => void) => () => void;
  onSetting: (k: SettingKey, fn: (v: boolean) => void) => () => void;
  getSfxSet: () => SfxSet;
}

const ISOLATED_DEVELOPER = { enabled: (): boolean => true };

/**
 * One set of settings over a storage: what the page reads (the page's, below, over the global save storage and the URL);
 * a test builds its own over a fixture storage instead of reloading the module (E422).
 * The page injects its Developer gate; isolated fixtures may supply their own mode and change subscription.
 */
export function createSettings(savedStorage: Pick<Storage, 'getItem' | 'setItem'>, search: () => string = () => (typeof location === 'undefined' ? '' : location.search),
  developer: { enabled: () => boolean; on?: (changed: () => void) => () => void } = ISOLATED_DEVELOPER): Settings {
  const { bools: state, nums, parsed: saved } = load(savedStorage);
  // the choices persist through this, bound once they exist (they and the save record need each other)
  const writer = { persist: (): void => undefined };
  const ctx = { saved, persist: (): void => { writer.persist(); }, search };
  const defaultOption = <K extends OptionKey>(k: K): OptionValue<K> => {
    const value = OPTION_SPECS[k].def ?? OPTION_VALUES[k][0];
    if (value === undefined) throw new Error(`Settings: option ${k} has no default`);
    return value;
  };
  const option = <K extends OptionKey>(k: K): Choice<OptionValue<K>> => {
    const values: readonly OptionValue<K>[] = OPTION_VALUES[k];
    const def = (): OptionValue<K> => defaultOption(k);
    return new Choice<OptionValue<K>>(k, values, def, OPTION_SPECS[k].url, BOOT_OPTIONS.includes(k), ctx);
  };
  const options: { [K in OptionKey]: Choice<OptionValue<K>> } = {
    tier: option('tier'), touch: option('touch'), time: option('time'),
    weather: option('weather'),
  };
  const persist = (): void => {
    const picks: Partial<Record<string, string>> = {};
    for (const k of OPTION_KEYS) picks[k] = options[k].stored;
    try { savedStorage.setItem(STORE, JSON.stringify({ ...state, ...nums, ...picks })); } catch { /* not persisted this session */ }
  };
  writer.persist = persist;
  const readOption = <K extends OptionKey>(key: K): OptionValue<K> => {
    if (developer.enabled() || !DEVELOPER_OPTIONS.includes(key) || options[key].fromUrl) return options[key].value;
    return defaultOption(key);
  };
  const listeners = new Map<SettingKey, Set<(v: boolean) => void>>();
  const numListeners = new Map<NumberKey, Set<(v: number) => void>>();
  const subscribe = <K, V>(map: Map<K, Set<(v: V) => void>>, k: K, fn: (v: V) => void): (() => void) => {
    let set = map.get(k);
    if (!set) { set = new Set(); map.set(k, set); }
    set.add(fn);
    const s = set;
    const off = (): void => { s.delete(fn); };
    onOwnerDispose(off);
    return off;
  };
  return {
    /** the value this page runs with: the URL's param if present, else the saved pick, else the default */
    setting: readOption,
    /** the player's saved pick (what the next load builds when the URL does not override it) */
    savedSetting: <K extends OptionKey>(k: K): OptionValue<K> => options[k].stored,
    /** save a pick: a live option applies at once (subscribers fire), a boot option only on the next load */
    saveSetting: <K extends OptionKey>(k: K, v: OptionValue<K>): void => {
      if (!DEVELOPER_OPTIONS.includes(k) || developer.enabled()) options[k].set(v);
    },
    /** a live option's value for this page only, never saved; `null` returns it to the saved pick */
    overrideSetting: <K extends OptionKey>(k: K, v: OptionValue<K> | null): void => {
      options[k].override(v);
    },
    onSettingChange: <K extends OptionKey>(k: K, fn: (v: OptionValue<K>) => void): (() => void) => {
      const off = options[k].on((value) => { fn(!developer.enabled() && DEVELOPER_OPTIONS.includes(k) && !options[k].fromUrl ? readOption(k) : value); });
      const modeOff = DEVELOPER_OPTIONS.includes(k) ? developer.on?.(() => { fn(readOption(k)); }) : undefined;
      const unsubscribe = (): void => { off(); modeOff?.(); };
      onOwnerDispose(unsubscribe); return unsubscribe;
    },
    settingFromUrl: (k: OptionKey): boolean => options[k].fromUrl,
    pendingReload: (): OptionKey[] => BOOT_OPTIONS.filter((k) => options[k].stored !== options[k].value),
    getSetting: (k: SettingKey): boolean => state[k],
    setSetting: (k: SettingKey, v: boolean): void => {
      if (state[k] === v) return;
      state[k] = v;
      persist();
      listeners.get(k)?.forEach((fn) => fn(v));
    },
    getNumber: (k: NumberKey): number => nums[k],
    setNumber: (k: NumberKey, raw: number): void => {
      const v = clampNum(k, raw);
      if (nums[k] === v) return;
      nums[k] = v;
      persist();
      numListeners.get(k)?.forEach((fn) => fn(v));
    },
    onNumber: (k: NumberKey, fn: (v: number) => void): (() => void) => subscribe(numListeners, k, fn),
    onSetting: (k: SettingKey, fn: (v: boolean) => void): (() => void) => subscribe(listeners, k, fn),
    getSfxSet: (): SfxSet => 'best',
  };
}

/** the page's settings: the global save storage, the page's URL */
const page = createSettings(saveStorage('global'), undefined, { enabled: isDev, on: onDev });
/** the value this page runs with: the URL's param if present, else the saved pick, else the default */
export function setting<K extends OptionKey>(k: K): OptionValue<K> { return page.setting(k); }
/** the player's saved pick (what the next load builds when the URL does not override it) */
export function savedSetting<K extends OptionKey>(k: K): OptionValue<K> { return page.savedSetting(k); }
/** save a pick: a live option applies at once (subscribers fire), a boot option only on the next load */
export function saveSetting<K extends OptionKey>(k: K, v: OptionValue<K>): void { page.saveSetting(k, v); }
/**
 * A live option's value for this page only, never saved (src/client/engine/ui/perfProbe.ts uncaps the frame for its rows); `null`
 * returns it to the saved pick. Subscribers fire on a change.
 */
export function overrideSetting<K extends OptionKey>(k: K, v: OptionValue<K> | null): void { page.overrideSetting(k, v); }
/** fires on a live option's change, and with the new saved pick for a boot option; not called immediately */
export function onSettingChange<K extends OptionKey>(k: K, fn: (v: OptionValue<K>) => void): () => void { return page.onSettingChange(k, fn); }
/** the URL overrides this option for this load (the menus say so) */
export function settingFromUrl(k: OptionKey): boolean { return page.settingFromUrl(k); }
/** boot options whose saved pick differs from what this page was built with */
export function pendingReload(): OptionKey[] { return page.pendingReload(); }
export function getSetting(k: SettingKey): boolean { return page.getSetting(k); }
export function setSetting(k: SettingKey, v: boolean): void { page.setSetting(k, v); }
export function getNumber(k: NumberKey): number { return page.getNumber(k); }
export function setNumber(k: NumberKey, raw: number): void { page.setNumber(k, raw); }
export function onNumber(k: NumberKey, fn: (v: number) => void): () => void { return page.onNumber(k, fn); }
export function onSetting(k: SettingKey, fn: (v: boolean) => void): () => void { return page.onSetting(k, fn); }
export function getSfxSet(): SfxSet { return page.getSfxSet(); }
