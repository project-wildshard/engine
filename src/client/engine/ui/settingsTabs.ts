import { listenTap } from '../input/dom';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString, type EngineStringKey } from '../../../shared/engine/strings';
import { isDev, onDev } from '../core/devMode';
import { TIER, automaticTier, gfxPrefs, saveGfxPrefs } from '../core/tier';
import { graphicsMode, lowPowerOn, lowPowerRefusal, saveGraphicsMode, PIXELS_EVENT } from '../core/graphicsMode';
import { firstPlayDone, resetFirstPlay } from '../boot/firstPlayMark';
import { getNumber, onNumber, pendingReload, saveSetting, savedSetting, setNumber, type NumberKey } from './Settings';
import { reloadWithPicks } from './ReloadPrompt';
import type { SettingsLayout } from './settingsLayout';
/**
 * QA 49 prototypes (Jake, 2026-11-10: "a settings menu with a bunch of tabs at the top… Don't make it like a single scrollable
 * thing… we have a bag menu, whatever we do, we want to stick within one style"). Every layout re-parents the SAME rows the
 * shipped Settings builds (menuSettings.ts marks each with `data-sv`), so every switch keeps its listeners; `dispose()` puts
 * each row back where it came from. The Graphics rows are new here: the phone's Low / High (MG2, live, MG3's refusal) and the
 * boot-time picks the title's Settings holds today (quality, render scale, anti-aliasing, touch controls: on reload).
 *
 *   a  Bag tabs     the Bag's own icon tab bar (one glyph over one word) at the top
 *   b  Side rail    a narrow icon rail down the left, the tab's rows on the right (a wide rail on a desktop)
 *   c  Thumb tabs   the same icon tabs at the bottom of the sheet, under the thumb
 *   d  Quick + all  a quick card (Graphics, volume, music) over six tiles; a tile opens its tab with a Back bar
 *   e  Six words    six word tabs (Combat split from Controls), the shipped PAUSE tab style
 */

type RowKey = string;
interface Group { head: EngineStringKey | null; rows: readonly RowKey[] }
interface TabSpec { id: string; word: EngineStringKey; icon: string; groups: readonly Group[]; dev?: true; tile?: EngineStringKey }

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">${body}</svg>`;
/** a glyph's element, parsed as SVG (no HTML sink) */
const glyph = (markup: string): HTMLElement => {
  const box = el('ws-gmenu-svicon', 'i');
  box.append(document.importNode(new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement, true));
  return box;
};
/** the tab glyphs, drawn like the Bag's (icons.ts): 64-box primitives, currentColor */
const GLYPH = {
  graphics: svg(`<rect x="7" y="12" width="50" height="40" rx="3" ${S} stroke-width="3.6"/><path d="M11 48 L26 30 L35 40 L42 33 L53 48 Z"/><circle cx="45" cy="22" r="5"/>`),
  sound: svg(`<path d="M10 25 H20 L33 13 V51 L20 39 H10 Z"/><path d="M41 24 C45 28 45 36 41 40 M47 18 C55 25 55 39 47 46" ${S} stroke-width="3.6"/>`),
  controls: svg(`<path d="M18 20 H46 C55 20 60 30 60 40 C60 49 54 52 49 47 L43 40 H21 L15 47 C10 52 4 49 4 40 C4 30 9 20 18 20 Z"/><path d="M17 27 V37 M12 32 H22" stroke="#0b1520" stroke-width="3.4" stroke-linecap="round"/><circle cx="44" cy="28" r="3" fill="#0b1520"/><circle cx="50" cy="34" r="3" fill="#0b1520"/>`),
  saves: svg(`<path d="M10 10 H46 L54 18 V54 H10 Z"/><rect x="19" y="10" width="22" height="14" fill="#0b1520" opacity="0.6"/><rect x="18" y="34" width="28" height="20" rx="2" fill="#0b1520" opacity="0.6"/>`),
  system: svg(`<circle cx="32" cy="32" r="24" ${S} stroke-width="3.6"/><circle cx="32" cy="19" r="3.6"/><rect x="28.5" y="27" width="7" height="22" rx="2"/>`),
  dev: svg(`<path d="M22 18 L8 32 L22 46 M42 18 L56 32 L42 46 M36 12 L28 52" ${S} stroke-width="4.4"/>`),
  combat: svg(`<path d="M50 8 L56 8 L56 14 L30 40 L24 34 Z"/><path d="M18 34 L30 46 M22 42 L10 54" ${S} stroke-width="5"/>`),
};

/** A–D: five tabs (Jake's "about 5"), and Dev only in developer mode */
const FIVE: readonly TabSpec[] = [
  { id: 'graphics', word: 's_sv_t_graphics', icon: GLYPH.graphics, tile: 's_sv_d_graphics', groups: [
    { head: null, rows: ['gfxMode', 'gfxRefusal', 'gfxDesk'] },
    { head: 's_sv_g_quality', rows: ['tier', 'scale', 'aa', 'gfxReload'] },
    { head: null, rows: ['firstPlay'] }] },
  { id: 'sound', word: 's_sv_t_sound', icon: GLYPH.sound, tile: 's_sv_d_sound', groups: [
    { head: 's_sv_g_volume', rows: ['volume', 'music'] },
    { head: 's_sv_g_music', rows: ['musicStyle', 'creditMusic', 'creditSfx'] }] },
  { id: 'controls', word: 's_sv_t_controls', icon: GLYPH.controls, tile: 's_sv_d_controls', groups: [
    { head: 's_sv_g_camera', rows: ['look', 'swingLook'] },
    { head: 's_sv_g_lock', rows: ['lockCam', 'autoLock', 'lockNote'] },
    { head: 's_sv_g_aim', rows: ['aimAssist', 'huntersEye', 'tracers'] },
    { head: 's_sv_g_touch', rows: ['touch', 'haptics', 'touchReload'] },
    { head: null, rows: ['keys'] }] },
  { id: 'saves', word: 's_sv_t_saves', icon: GLYPH.saves, tile: 's_sv_d_saves', groups: [
    { head: null, rows: ['@saves'] },
    { head: null, rows: ['saveFile'] }] },
  { id: 'system', word: 's_sv_t_system', icon: GLYPH.system, tile: 's_sv_d_system', groups: [
    { head: null, rows: ['connection', 'build', 'offline'] },
    { head: null, rows: ['review'] },
    { head: null, rows: ['devSwitch'] },
    { head: 's_2a6b24ad2872', rows: ['creditModel'] }] },
  { id: 'dev', word: 's_sv_t_dev', icon: GLYPH.dev, dev: true, tile: 's_sv_d_dev', groups: [{ head: null, rows: ['devtools', 'debug'] }] },
];
/** E: six word tabs, Combat apart from Controls */
const SIX: readonly TabSpec[] = [
  FIVE[0] as TabSpec, FIVE[1] as TabSpec,
  { id: 'controls', word: 's_sv_t_controls', icon: GLYPH.controls, groups: [
    { head: 's_sv_g_camera', rows: ['look', 'swingLook'] },
    { head: 's_sv_g_touch', rows: ['touch', 'haptics', 'touchReload'] },
    { head: null, rows: ['keys'] }] },
  { id: 'combat', word: 's_sv_t_combat', icon: GLYPH.combat, groups: [
    { head: 's_sv_g_lock', rows: ['lockCam', 'autoLock', 'lockNote'] },
    { head: 's_sv_g_aim', rows: ['aimAssist', 'huntersEye', 'tracers'] }] },
  FIVE[3] as TabSpec, FIVE[4] as TabSpec, FIVE[5] as TabSpec,
];

export interface SettingsTabsHost {
  readonly scope: Scope;
  /** the Settings panel (panels.settings): the shipped rail + pane are hidden while a layout is on */
  readonly panel: HTMLElement;
  /** a desktop-sized window (SETTINGS_DESK_QUERY) */
  readonly desk: () => boolean;
  /** widen the sheet (layout B on a desktop) */
  readonly wide: (on: boolean) => void;
}
export interface SettingsTabsView {
  readonly layout: SettingsLayout;
  /** pick up rows that arrived since (a game's section) and show only the groups and tabs that have something to show */
  sync: () => void;
  /** put every row back and remove the layout */
  dispose: () => void;
}

function el(cls: string, tag = 'div'): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
const words = (cls: string, key: EngineStringKey, tag = 'div', args: readonly unknown[] = []): HTMLElement => { const e = el(cls, tag); e.textContent = engineString(key, args); return e; };
const shown = (e: Element): boolean => (e as HTMLElement).hidden !== true;

export function mountSettingsTabs(host: SettingsTabsHost, layout: Exclude<SettingsLayout, 'today'>): SettingsTabsView {
  const scope = host.scope.child(`settingsTabs.${layout}`);
  const tabs = layout === 'e' ? SIX : FIVE;
  const moved: { node: HTMLElement; parent: ParentNode; next: Node | null }[] = [];
  const gfx = graphicsRows(scope);
  const root = el(`ws-gmenu-sv ws-gmenu-sv-${layout}`);
  const iconTabs = layout !== 'e';
  const strip = el(`ws-gmenu-svtabs${iconTabs ? ' icons' : ' words'}`, 'nav');
  if (!iconTabs) strip.dataset['scroll'] = ''; // E's words scroll sideways (index.html swallows touchmove outside [data-scroll])
  const body = el('ws-gmenu-svbody');
  const buttons = new Map<string, HTMLButtonElement>(), panes = new Map<string, HTMLElement>();
  const slots: { key: RowKey; slot: HTMLElement }[] = [];
  const groupEls: { head: HTMLElement | null; slot: HTMLElement }[] = [];
  let selected = tabs[0]?.id ?? 'graphics';
  let home = layout === 'd';
  let quick: ReturnType<typeof quickHome> | null = null, back: HTMLElement | null = null;
  const paint = (): void => {
    for (const [id, pane] of panes) pane.classList.toggle('active', id === selected && !home);
    for (const [id, button] of buttons) { const on = id === selected; button.classList.toggle('active', on); button.setAttribute('aria-selected', String(on)); }
    root.classList.toggle('home', home);
    if (quick !== null) quick.root.hidden = !home;
    if (back !== null) back.hidden = home;
    strip.hidden = layout === 'd';
    host.wide(layout === 'b' && host.desk());
  };
  const select = (id: string): void => { selected = id; panes.get(id)?.scrollTo({ top: 0 }); paint(); };

  for (const tab of tabs) {
    const button = el('ws-gmenu-svtab', 'button') as HTMLButtonElement; button.type = 'button'; button.dataset['svTab'] = tab.id;
    if (tab.dev === true) button.classList.add('dev');
    if (iconTabs) button.append(glyph(tab.icon));
    button.append(words('ws-gmenu-svword', tab.word, 'span'));
    listenTap(scope, button, () => { select(tab.id); });
    buttons.set(tab.id, button); strip.append(button);
    const pane = el('ws-gmenu-svpane'); pane.dataset['scroll'] = ''; pane.dataset['svPane'] = tab.id;
    if (layout === 'b' || layout === 'd') pane.append(words('ws-gmenu-svhead', tab.word));
    for (const group of tab.groups) {
      const head = group.head === null ? null : words('ws-gmenu-label', group.head);
      const slot = el('ws-gmenu-svgroup');
      if (head !== null) pane.append(head);
      pane.append(slot); groupEls.push({ head, slot });
      for (const key of group.rows) {
        const own = gfx.rows[key];
        if (own !== undefined) slot.append(own); else slots.push({ key, slot });
      }
    }
    panes.set(tab.id, pane); body.append(pane);
  }

  // D: the first level, a quick card and one tile per tab; a tile opens its tab under a Back bar
  if (layout === 'd') {
    quick = quickHome(scope, tabs, (id) => { home = false; select(id); });
    back = el('ws-gmenu-svback');
    const b = words('ws-gmenu-svbackbtn', 's_sv_back', 'button') as HTMLButtonElement; b.type = 'button';
    listenTap(scope, b, () => { home = true; quick?.paint(); paint(); });
    back.append(b);
  }

  if (layout === 'c') root.append(body, strip);
  else if (layout === 'd' && quick !== null && back !== null) root.append(quick.root, back, body);
  else root.append(strip, body);
  host.panel.classList.add('ws-gmenu-svon');
  host.panel.append(root);

  /** move each marked row into its slot; idempotent (a row already in the layout stays) */
  const collect = (): void => {
    for (const { key, slot } of slots) {
      const found = key === '@saves'
        ? [...host.panel.querySelectorAll<HTMLElement>('[data-cat="save"]:not([data-sv]):not(.ws-gmenu-cat)')].filter((node) => node.parentElement !== slot && node.parentElement?.closest('[data-cat="save"]') === null)
        : [...host.panel.querySelectorAll<HTMLElement>(`[data-sv="${key}"]`)].filter((node) => node.parentElement !== slot);
      for (const node of found) {
        // the Save panel's own sub-rows (offline, connection, build) leave it for System; it keeps export / import
        moved.push({ node, parent: node.parentNode ?? host.panel, next: node.nextSibling });
        slot.append(node);
      }
    }
  };
  const sync = (): void => {
    collect(); gfx.paint();
    for (const { head, slot } of groupEls) {
      const any = [...slot.children].some(shown);
      slot.hidden = !any; if (head !== null) head.hidden = !any;
    }
    for (const tab of tabs) {
      const pane = panes.get(tab.id), button = buttons.get(tab.id);
      const any = (tab.dev !== true || isDev()) && pane !== undefined && [...pane.querySelectorAll('.ws-gmenu-svgroup')].some(shown);
      if (button !== undefined) button.hidden = !any;
      quick?.tiles.get(tab.id)?.toggleAttribute('hidden', !any);
    }
    if (buttons.get(selected)?.hidden === true) selected = tabs.find((tab) => buttons.get(tab.id)?.hidden !== true)?.id ?? selected;
    strip.style.setProperty('--ws-gmenu-svcount', String([...buttons.values()].filter((b) => b.hidden !== true).length));
    quick?.paint(); paint();
  };
  scope.onDispose(onDev(() => { sync(); }));
  sync();
  return {
    layout,
    sync,
    dispose: () => {
      for (const { node, parent, next } of moved.reverse()) { if (next !== null && next.parentNode === parent) (next as ChildNode).before(node); else parent.append(node); }
      root.remove(); host.panel.classList.remove('ws-gmenu-svon'); host.wide(false);
      scope.dispose();
    },
  };
}

/** D's first level: the three things players change most, then a tile per tab */
function quickHome(scope: Scope, tabs: readonly TabSpec[], open: (id: string) => void): { root: HTMLElement; tiles: Map<string, HTMLElement>; paint: () => void } {
  const root = el('ws-gmenu-svhome'); root.dataset['scroll'] = '';
  const card = el('ws-gmenu-svquick');
  card.append(words('ws-gmenu-label', 's_sv_quick'));
  const mode = TIER === 'phone' ? modeChooser(scope) : null;
  if (mode !== null) card.append(mode.root);
  const sliders = (['volume', 'music'] as const).map((key) => slider(scope, key, key === 'volume' ? 's_sv_volume' : 's_sv_music'));
  for (const s of sliders) card.append(s.root);
  root.append(card, words('ws-gmenu-label', 's_sv_all'));
  const grid = el('ws-gmenu-svtiles'), tiles = new Map<string, HTMLElement>();
  for (const tab of tabs) {
    const tile = el(`ws-gmenu-svtile${tab.dev === true ? ' dev' : ''}`, 'button') as HTMLButtonElement; tile.type = 'button'; tile.dataset['svTab'] = tab.id;
    tile.append(glyph(tab.icon), words('ws-gmenu-svword', tab.word, 'span'));
    if (tab.tile !== undefined) tile.append(words('ws-gmenu-svsub', tab.tile, 'small'));
    listenTap(scope, tile, () => { open(tab.id); });
    tiles.set(tab.id, tile); grid.append(tile);
  }
  root.append(grid);
  return { root, tiles, paint: () => { mode?.paint(); for (const s of sliders) s.paint(); } };
}

function slider(scope: Scope, key: NumberKey, label: EngineStringKey): { root: HTMLElement; paint: () => void } {
  const row = el('ws-gmenu-row'); row.append(words('ws-gmenu-swlabel', label, 'span'));
  const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.className = 'ws-gmenu-slider';
  const paint = (): void => { input.value = String(Math.round(getNumber(key) * 100)); };
  scope.listen(input, 'input', () => { setNumber(key, Number(input.value) / 100); });
  scope.listen(input, 'pointerdown', (event) => { event.stopPropagation(); });
  scope.onDispose(onNumber(key, paint));
  paint(); row.append(input);
  return { root: row, paint };
}

/** MG2's Low / High as two big cards (live, saved per device); MG3: under Low Power Mode, High is refused with the reason */
function modeChooser(scope: Scope): { root: HTMLElement; note: HTMLElement; paint: () => void } {
  const root = el('ws-gmenu-svmode');
  const note = el('ws-gmenu-note'); note.textContent = lowPowerRefusal();
  let refused = false;
  const cards: HTMLButtonElement[] = [];
  const paint = (): void => {
    const now = graphicsMode(), locked = lowPowerOn();
    for (const card of cards) { const on = card.dataset['mode'] === now; card.classList.toggle('active', on); card.setAttribute('aria-pressed', String(on)); card.classList.toggle('locked', locked && card.dataset['mode'] === 'high'); }
    note.hidden = !refused && !locked;
  };
  for (const mode of ['low', 'high'] as const) {
    const card = el('ws-gmenu-svmodecard', 'button') as HTMLButtonElement; card.type = 'button'; card.dataset['mode'] = mode;
    card.append(words('ws-gmenu-svmodeword', mode === 'low' ? 's_sv_low' : 's_sv_high', 'b'), words('ws-gmenu-svsub', mode === 'low' ? 's_sv_low_sub' : 's_sv_high_sub', 'small'));
    listenTap(scope, card, () => { refused = !saveGraphicsMode(mode); paint(); });
    root.append(card); cards.push(card);
  }
  scope.listen(document, PIXELS_EVENT, paint);
  paint();
  return { root, note, paint };
}

/** the Graphics tab's own rows (and Controls' touch row): the live Low / High, then the picks a reload builds */
function graphicsRows(scope: Scope): { rows: Partial<Record<RowKey, HTMLElement>>; paint: () => void } {
  const phone = TIER === 'phone';
  const boot = { ...gfxPrefs };
  const paints: (() => void)[] = [];
  const seg = (label: EngineStringKey, options: readonly (readonly [string, EngineStringKey, unknown[]?])[], get: () => string, set: (v: string) => void): HTMLElement => {
    const row = el('ws-gmenu-row'); row.append(words('ws-gmenu-swlabel', label, 'span'));
    const box = el('ws-gmenu-seg');
    const paint = (): void => { for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === get()); };
    for (const [v, text, args] of options) {
      const b = words('ws-gmenu-segbtn', text, 'button', args ?? []) as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = v;
      listenTap(scope, b, () => { set(v); for (const p of paints) p(); });
      box.append(b);
    }
    paints.push(paint); row.append(box); return row;
  };
  const mode = phone ? modeChooser(scope) : null;
  if (mode !== null) paints.push(mode.paint);
  const desk = phone ? null : words('ws-gmenu-note', 's_sv_gfx_desk');
  const tier = seg('s_1b2c08a8733d', [['auto', 's_2e7e5df64556', [automaticTier]], ['phone', 's_63dceb8800b2'], ['desktop', 's_9bd88f2485ac']], () => savedSetting('tier'),
    (v) => { if (v === 'auto' || v === 'phone' || v === 'desktop') saveSetting('tier', v); });
  const scale = seg('s_2dee7435d0fe', [['1', 's_aa23e5562422'], ['1.25', 's_dfbe15a4b4a5'], ['1.5', 's_79105e58c657'], ['2', 's_d1ce94426019'], ['native', 's_d509e4938852'], ['auto', 's_0286249762f7']], () => gfxPrefs.dpr,
    (v) => { if (v === 'auto' || v === '1' || v === '1.25' || v === '1.5' || v === '2' || v === 'native') { gfxPrefs.dpr = v; saveGfxPrefs(); } });
  const aa = seg('s_c77c3af22c64', [['on', 's_130011756125'], ['off', 's_ca7981b46ecf'], ['auto', 's_0286249762f7']], () => gfxPrefs.aa,
    (v) => { if (v === 'auto' || v === 'on' || v === 'off') { gfxPrefs.aa = v; saveGfxPrefs(); } });
  const touch = seg('s_25a35084fbc3', [['auto', 's_0286249762f7'], ['on', 's_de9f057a471c']], () => savedSetting('touch'),
    (v) => { if (v === 'auto' || v === 'on') saveSetting('touch', v); });
  const reloadRow = (): { row: HTMLElement; paint: () => void } => {
    const row = el('ws-gmenu-row ws-gmenu-svreload'), note = el('ws-gmenu-swlabel', 'span');
    const b = words('ws-gmenu-segbtn', 's_sv_reload', 'button') as HTMLButtonElement; b.type = 'button';
    listenTap(scope, b, () => { reloadWithPicks('settings tabs: reload to apply', b); });
    row.append(note, b);
    return { row, paint: () => {
      const count = pendingReload().length + (gfxPrefs.dpr === boot.dpr ? 0 : 1) + (gfxPrefs.aa === boot.aa ? 0 : 1);
      row.hidden = count === 0; note.textContent = engineString('s_sv_reload_note', [count]);
    } };
  };
  const gfxReload = reloadRow(), touchReload = reloadRow();
  paints.push(gfxReload.paint, touchReload.paint);
  const replay = phone ? (() => {
    const row = el('ws-gmenu-row'); row.append(words('ws-gmenu-swlabel', 's_sv_first_play', 'span'));
    const b = words('ws-gmenu-segbtn', 's_first_play_replay', 'button') as HTMLButtonElement; b.type = 'button';
    const paint = (): void => { const armed = !firstPlayDone(); b.disabled = armed; b.textContent = engineString(armed ? 's_first_play_armed' : 's_first_play_replay'); };
    listenTap(scope, b, () => { resetFirstPlay(); paint(); });
    paints.push(paint); row.append(b); return row;
  })() : null;
  paints.push(() => { scale.hidden = phone && !isDev(); });
  const rows: Partial<Record<RowKey, HTMLElement>> = { tier, scale, aa, touch, gfxReload: gfxReload.row, touchReload: touchReload.row };
  if (mode !== null) { rows['gfxMode'] = mode.root; rows['gfxRefusal'] = mode.note; }
  if (desk !== null) rows['gfxDesk'] = desk;
  if (replay !== null) rows['firstPlay'] = replay;
  const paint = (): void => { for (const p of paints) p(); };
  paint();
  return { rows, paint };
}
