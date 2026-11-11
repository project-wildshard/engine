import { authoredRows } from './authoredDebugRows';
import { engineString } from '../../../shared/engine/strings';
/**
 * The DEBUG menu's registry (E162, Jake 2026-09-25: "we are going to have an ungodly amount of toggles and we need to
 * organize them"). Every variant, taste toggle and developer aid the game has is declared here ONCE — its group, label,
 * choices, whether it applies live or reloads the page, the shards it applies to and a one-line note with its ask id.
 * pause ▸ Settings ▸ Debug (src/client/engine/ui/DebugMenu.ts) renders it: one collapsible section per group, only the rows that apply to
 * the shard you are in, a filter box on top. There are no URL switches (AGENTS.md "No URL switches, ever").
 *
 *   opt('weather', 'sky', 'Weather', [['live', 'Live'], ['rain', 'Rain']], { ask: 'E162', reviewBy: '2026-12-30', note: 'E162: aiming aid.' })
 *   action('clearDownloads', 'tools', 'Downloads', 'Clear', () => …, { ask: 'E172', reviewBy: '2026-12-30', note: 'E172 …' })   // a button row, not a pick
 *   DEBUG_READOUTS        → a live readout under a row, by row id (E172: Shards in memory's; both menus show it)
 *   DEBUG_ROWS            → every row, in menu order within its group
 *   DEBUG_GROUPS          → the groups, in menu order (never add one without need: a row belongs in an existing group)
 *
 * A row reads a saved option (src/client/engine/ui/Settings.ts OPTION_VALUES / OPTION_SPECS with `params: []`): the game reads it with
 * `setting(key)` (at load for a `reload` row) and `onSettingChange(key, fn)` (a live row).
 */
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { jsonSlot } from '../saves/slots';
import { clearDownloads, freedBytes, lastClear, mbText, storageUsed } from '../boot/clearDownloads';
import { EARLY_PROGRAMS_SLOT } from '../boot/earlyPrograms';
import { RELOAD_PARAM } from '../core/GpuRecovery';
import { leaveSaved, markReload } from '../boot/lastEnd';
import { showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';
import { OPTION_VALUES, saveSetting, setting, settingsReloadUrl } from './Settings';
import type { DebugRowSpec } from '../../../server/engine/level/context';
import { isDev, onDev } from '../core/devMode';

/** what "applies" reads: the shard you are in and the weapons you hold (re-read every time the menu opens) */
export interface DebugCtx { chunk: LevelSpec; weapons: ReadonlySet<string> }
type When = (c: DebugCtx) => boolean;

export type DebugGroupId = 'look' | 'cover' | 'sky' | 'audio' | 'combat' | 'creatures' | 'perf' | 'loading' | 'tools';
export interface DebugGroup { id: DebugGroupId; label: string; note?: string }
/** the groups, in menu order. Never add a group without need: put a new row in the group whose domain it is (lighting,
 *  shadows and post go in Look; water in Look too). Empty groups are hidden until an authored row uses them. */
export const DEBUG_GROUPS: readonly DebugGroup[] = [
  { id: 'look', label: engineString('s_a0de5719f595') },
  { id: 'sky', label: engineString('s_5672356bb3b5') },
  { id: 'audio', label: engineString('s_bc1b88907d3b') },
  { id: 'combat', label: engineString('s_6cb4be24e5ce') },
  { id: 'creatures', label: engineString('s_c57f1e7056cf') },
  { id: 'perf', label: engineString('s_442aded87a55') },
  { id: 'loading', label: engineString('s_f6d2705a823f') },
  { id: 'tools', label: engineString('s_96f0c06bbcb7') },
];

export interface DebugChoice { v: string; text: string }
export interface DebugRow {
  /** Diagnostic controls belong in Settings Developer, separately from comparison flags. */
  purpose?: 'developer';
  /** unique; the option key for an option row */
  id: string;
  group: DebugGroupId;
  label: string;
  /** a function: a choice's text may say what is live now (GPU textures: "Auto · now KTX2") */
  choices: () => readonly DebugChoice[];
  get: () => string;
  set: (v: string) => void;
  /** subscribe to outside changes (repaints the row); may do nothing */
  on: (fn: () => void) => void;
  /** a pick saves, then reloads the page (the thing is built once) */
  reload: boolean;
  /** shown only where this holds (the shard, the weapons) */
  when: When;
  /** one line: what it switches and the ask it came from */
  note: string;
  ask: `E${number}`;
  reviewBy: string;
  /** a button row (a one-shot: clear a cache, spawn something) instead of a pick; `choices` is empty */
  action?: DebugActionSpec;
}

/** A level owns its debug choices and their inverse; menus resolve the live catalog when opened. */
export function registerLevelDebugRow(spec: DebugRowSpec, levelId: string): () => void {
  const saved = jsonSlot(`debug.plugin.${levelId}.${spec.id}`, 'device');
  const value = saved.read();
  const read = (): string => {
    if (spec.purpose === 'developer' && !isDev()) return spec.initial;
    const next = saved.read();
    return typeof next === 'string' && spec.choices.some((choice) => choice.value === next) ? next : spec.initial;
  };
  let current = spec.purpose === 'developer' && !isDev() ? spec.initial
    : typeof value === 'string' && spec.choices.some((choice) => choice.value === value) ? value : spec.initial;
  let live = true;
  const listeners = new Set<() => void>();
  const row: DebugRow = { ...(spec.purpose === undefined ? {} : { purpose: spec.purpose }), id: spec.id, group: spec.group, label: spec.label, note: spec.note, ask: spec.ask, reviewBy: spec.reviewBy, reload: spec.reload ?? false,
    choices: () => spec.choices.map((choice) => ({ v: choice.value, text: choice.text })), get: () => current,
    set: (next) => {
      if (!live || (spec.purpose === 'developer' && !isDev()) || !spec.choices.some((choice) => choice.value === next)) return;
      current = next; saved.write(next); spec.change(next); for (const listener of listeners) listener();
    }, on: (listener) => { if (live) listeners.add(listener); }, when: (ctx) => ctx.chunk.id === levelId };
  authoredRows.add(row);
  if (current !== spec.initial) spec.change(current);
  const off = spec.purpose === 'developer' && typeof window !== 'undefined' ? onDev(() => {
    if (!live) return;
    const next = read(); if (next === current) return;
    current = next; spec.change(next); for (const listener of listeners) listener();
  }) : () => undefined;
  return () => { live = false; off(); authoredRows.delete(row); listeners.clear(); };
}

// Authored levels opt into each core option independently.
const always: When = () => true;

interface RowOpts { purpose?: 'developer'; reload?: boolean; when?: When; note: string; ask: `E${number}`; reviewBy: string }
/**
 * A button row's action. `run` may report through `say(button, status)` (the button's text, the line under the row).
 * E172: `confirm` makes it two taps — the first shows what `confirm()` returns ("Tap again to clear ~158 MB", it may
 * measure first), a second within a few seconds runs it, else it disarms; `status()` is the line under the row at rest.
 */
export interface DebugActionSpec {
  text: string;
  run: (say: (button: string, status: string) => void) => void | Promise<void>;
  confirm?: () => Promise<string>;
  status?: () => string;
}
/** a button row: `text` on the button, `run` on a tap (the button disables until a returned promise settles); `more`:
 *  the two-tap confirm and the status line (E172) */
export function action(id: string, group: DebugGroupId, label: string, text: string, run: DebugActionSpec['run'], o: RowOpts, more: Pick<DebugActionSpec, 'confirm' | 'status'> = {}): DebugRow {
  return {
    ...(o.purpose === undefined ? {} : { purpose: o.purpose }), id, group, label, choices: () => [], reload: o.reload ?? false, when: o.when ?? always, note: o.note, ask: o.ask, reviewBy: o.reviewBy,
    get: () => '', set: () => undefined, on: () => undefined, action: { text, run: (say) => o.purpose === 'developer' && !isDev() ? undefined : run(say), ...more },
  };
}

/** params that skip the title (dev / deep links): a reload meant to land on the title drops them (the title's Apply &
 *  reload, src/client/engine/ui/BootSettings.ts; Clear downloads) */
export const TITLE_SKIPPERS: string[] = ['skipintro', 'tour', 'explore', 'cam', 'model', 'at', RELOAD_PARAM, 'v'];

/** E172 (the user: "I need a button to nuke the cache so i can test it"): every downloaded file gone, the saves kept
 *  (src/client/engine/boot/clearDownloads.ts), then a reload to the title like a fresh launch — the running shard's ?chunk= stays */
const CLEAR_IDLE = engineString('s_e94f3b418bf5');
/** DL10: the level's baked entry programs linked from the renderer step and the title's compiler warm-up
 *  (src/client/engine/boot/earlyPrograms.ts); read once at boot, so a pick reloads. Default on since the throttled Simulator pair
 *  (11-04); kept as the off switch until Jake's iPhone confirms. */
const earlyProgramsSlot = jsonSlot(EARLY_PROGRAMS_SLOT, 'device');
const earlyProgramsRow: DebugRow = { id: 'earlyPrograms', group: 'loading', label: engineString('s_debug_early_programs'), reload: true, when: always,
  choices: () => [{ v: 'off', text: engineString('s_ca7981b46ecf') }, { v: 'on', text: engineString('s_130011756125') }],
  get: () => earlyProgramsSlot.read() === 'off' ? 'off' : 'on',
  set: (next) => { if (next === 'off' || next === 'on') earlyProgramsSlot.write(next); },
  on: () => undefined,
  note: 'DL10: compile the spawn view\'s shader programs during loading, as soon as the world is built; default off until a Simulator / iPhone reading.',
  ask: 'E526', reviewBy: '2026-12-30' };
const weatherWord = (value: string): value is (typeof OPTION_VALUES.weather)[number] => OPTION_VALUES.weather.some(choice => choice === value);
/** The Weather setting, live: a level that reads it hears it, and on the wire the server's sky does. */
const weatherRow: DebugRow = { purpose: 'developer', id: 'liveWeather', group: 'tools', label: engineString('s_debug_weather'), reload: false, when: always,
  choices: () => OPTION_VALUES.weather.map(v => ({ v, text: v })),
  get: () => setting('weather'),
  set: (next) => { if (weatherWord(next)) saveSetting('weather', next); },
  on: () => undefined,
  note: 'J130: the live Weather setting, which a flip proof presses. Fog and rain hold; live is the level\'s own programme.',
  ask: 'E535', reviewBy: '2026-12-30' };
const clearDownloadsRow = action('clearDownloads', 'tools', engineString('s_59cb301bb126'), engineString('s_59cb301bb126'), async (say) => {
  say('Clearing…', CLEAR_IDLE);
  const r = await clearDownloads();
  const freed = freedBytes(r);
  say(freed === null ? 'Cleared · reloading' : `Freed ${mbText(freed)} · reloading`,
    `${mbText(freed)} of downloads · ${r.caches} caches and ${r.workers} worker${r.workers === 1 ? '' : 's'} removed${r.httpCache ? ', HTTP cache cleared' : ''}. Reloading as a first visit.`);
  showReloading();
  leaveSaved(() => { leaveAfterPaint(() => { markReload('debug: clear downloads'); location.replace(settingsReloadUrl(location.href, TITLE_SKIPPERS)); }); });
}, { purpose: 'developer', ask: 'E172', reviewBy: '2026-12-30', note: engineString('s_510ecf1f03f4') }, {
  confirm: async () => { const used = await storageUsed(); return used === null ? 'Tap again to clear' : `Tap again to clear ~${mbText(used)}`; },
  status: () => {
    const last = lastClear(); // this page is the reload the last clear made: say what it freed
    return last === null ? CLEAR_IDLE : `Last clear freed ${mbText(freedBytes(last))} (${last.caches} caches, ${last.workers} worker${last.workers === 1 ? '' : 's'}). ${CLEAR_IDLE}`;
  },
});


/** A13 (meta MMO-FAILURE-MODES-PLAN): every screen a player sees when the world's link fails, as prototypes over this page. The
 *  entry answers the event only with Developer on, and only then downloads them (src/client/app/failScreens.ts). */
const failScreensRow = action('failScreens', 'tools', engineString('s_debug_fail_screens'), engineString('s_debug_fail_screens_open'), () => {
  document.dispatchEvent(new CustomEvent('ws:failscreen', { detail: 'gallery' }));
}, { purpose: 'developer', ask: 'E133', reviewBy: '2026-12-30', note: engineString('s_debug_fail_screens_note') });

export const DEBUG_ROWS: readonly DebugRow[] = [
  // ── Look ──



  // ── Combat & weapons ──

  // ── Creatures & NPCs ──

  // ── Performance ──

  // ── Loading & memory ──
  earlyProgramsRow,
  clearDownloadsRow,

  // ── Developer tools ──
  weatherRow,
  failScreensRow,

];

/** E172: a few live lines under a row (by row id), re-read while the row can be seen — in both menus */
export const DEBUG_READOUTS: Readonly<Partial<Record<string, () => string>>> = { clearDownloads: storageReadout };

let storageEstimate = 'usage / quota: checking';
let estimateAt = 0;
function storageReadout(): string {
  if (Date.now() - estimateAt > 10_000) {
    estimateAt = Date.now();
    try { void navigator.storage.estimate().then((value) => { storageEstimate = `${mbText(value.usage ?? null)} / ${mbText(value.quota ?? null)}`; return undefined; }).catch(() => { storageEstimate = 'usage / quota: unavailable'; }); }
    catch { storageEstimate = 'usage / quota: unavailable'; }
  }
  return engineString('s_eb6d1d4e42ba', [jsonSlot('storage.persisted', 'device').read() === true ? engineString('s_8a798890fe93') : engineString('s_9390298f3fb0'), storageEstimate]);
}

export function levelDebugRows(): readonly DebugRow[] { return [...DEBUG_ROWS, ...authoredRows]; }
