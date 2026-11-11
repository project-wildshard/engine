import { listenTap } from '../input/dom';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString, type EngineStringKey } from '../../../shared/engine/strings';
import { isDev, onDev } from '../core/devMode';
import { TIER, automaticTier, gfxPrefs, saveGfxPrefs } from '../core/tier';
import { graphicsMode, lowPowerOn, lowPowerRefusal, saveGraphicsMode, PIXELS_EVENT } from '../core/graphicsMode';
import { firstPlayDone, resetFirstPlay } from '../boot/firstPlayMark';
import { pendingReload, saveSetting, savedSetting } from './Settings';
import { reloadWithPicks } from './ReloadPrompt';
import { withOwner } from '../../../shared/engine/app/ownership';
import { GRAPHICS_SECTIONS, graphicsControls, onGraphicsControls, type GraphicsControl, type GraphicsSection } from './graphicsControls';
/**
 * The in-game Settings (J245, Jake 2026-11-10: "Settings, let's do A, like the bag. The tabs at the top, 5 tabs. Developer mode
 * is on, 6 tabs"): the Bag's own tab bar (one glyph over one short word, the cyan underline) over one tab at a time.
 *
 *   GRAPHICS · SOUND · CONTROLS · SAVES · SYSTEM, and DEV (amber) in Developer mode
 *
 * Each tab is a column of named groups (GROUPS); menuSettings.ts puts every row in its group with `put`, a game adds its own
 * with GameMenu.addSettingsSection(group, …). Graphics renders the graphicsControls.ts registry (the Low / High lane's
 * toggles go there), merged over the built-ins below. A group with nothing showing hides with its heading; a tab with
 * nothing showing hides its button (DEV outside Developer mode).
 */
export const SETTINGS_TABS = ['graphics', 'sound', 'controls', 'saves', 'system', 'dev'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
export type SettingsGroup = `graphics.${GraphicsSection}` | 'sound.volume' | 'sound.music' | 'controls.camera' | 'controls.lock' | 'controls.aim' | 'controls.touch' | 'controls.keys'
  | 'saves.game' | 'saves.file' | 'system.link' | 'system.review' | 'system.developer' | 'system.credits' | 'dev.tools';
/** every group, in screen order within its tab; `head` is its section label */
const GROUPS: readonly { id: SettingsGroup; head: EngineStringKey | null }[] = [
  { id: 'graphics.main', head: null }, { id: 'graphics.effects', head: 's_st_g_effects' }, { id: 'graphics.advanced', head: 's_st_g_advanced' }, { id: 'graphics.setup', head: null },
  { id: 'sound.volume', head: 's_st_g_volume' }, { id: 'sound.music', head: 's_st_g_music' },
  { id: 'controls.camera', head: 's_st_g_camera' }, { id: 'controls.lock', head: 's_st_g_lock' }, { id: 'controls.aim', head: 's_st_g_aim' }, { id: 'controls.touch', head: 's_st_g_touch' }, { id: 'controls.keys', head: null },
  { id: 'saves.game', head: null }, { id: 'saves.file', head: null },
  { id: 'system.link', head: null }, { id: 'system.review', head: null }, { id: 'system.developer', head: null }, { id: 'system.credits', head: 's_2a6b24ad2872' },
  { id: 'dev.tools', head: null },
];

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">${body}</svg>`;
/** the tab glyphs, drawn like the Bag's (icons.ts): 64-box primitives, currentColor */
const TABS: readonly { id: SettingsTab; word: EngineStringKey; glyph: string }[] = [
  { id: 'graphics', word: 's_st_t_graphics', glyph: svg(`<rect x="7" y="12" width="50" height="40" rx="3" ${S} stroke-width="3.6"/><path d="M11 48 L26 30 L35 40 L42 33 L53 48 Z"/><circle cx="45" cy="22" r="5"/>`) },
  { id: 'sound', word: 's_st_t_sound', glyph: svg(`<path d="M10 25 H20 L33 13 V51 L20 39 H10 Z"/><path d="M41 24 C45 28 45 36 41 40 M47 18 C55 25 55 39 47 46" ${S} stroke-width="3.6"/>`) },
  { id: 'controls', word: 's_st_t_controls', glyph: svg(`<path d="M18 20 H46 C55 20 60 30 60 40 C60 49 54 52 49 47 L43 40 H21 L15 47 C10 52 4 49 4 40 C4 30 9 20 18 20 Z"/><path d="M17 27 V37 M12 32 H22" stroke="#0b1520" stroke-width="3.4" stroke-linecap="round"/><circle cx="44" cy="28" r="3" fill="#0b1520"/><circle cx="50" cy="34" r="3" fill="#0b1520"/>`) },
  { id: 'saves', word: 's_st_t_saves', glyph: svg(`<path d="M10 10 H46 L54 18 V54 H10 Z"/><rect x="19" y="10" width="22" height="14" fill="#0b1520" opacity="0.6"/><rect x="18" y="34" width="28" height="20" rx="2" fill="#0b1520" opacity="0.6"/>`) },
  { id: 'system', word: 's_st_t_system', glyph: svg(`<circle cx="32" cy="32" r="24" ${S} stroke-width="3.6"/><circle cx="32" cy="19" r="3.6"/><rect x="28.5" y="27" width="7" height="22" rx="2"/>`) },
  { id: 'dev', word: 's_st_t_dev', glyph: svg(`<path d="M22 18 L8 32 L22 46 M42 18 L56 32 L42 46 M36 12 L28 52" ${S} stroke-width="4.4"/>`) },
];

export interface SettingsTabsView {
  /** the tab bar and the panes: GameMenu mounts it in its Settings panel */
  readonly root: HTMLElement;
  readonly selected: SettingsTab;
  /** add rows to a group (at its top with `first`) */
  put: (group: SettingsGroup, els: readonly HTMLElement[], first?: boolean) => void;
  select: (tab: SettingsTab) => void;
  /** re-read Graphics (the registry, each control's `refresh` and `when`) and show only the groups and tabs with something to show */
  sync: () => void;
}
export interface SettingsTabsOptions {
  /** stage the Debug cards' pending picks before a Graphics reload (it reloads the page) */
  readonly applyPending: () => void;
}

function el(cls: string, tag = 'div'): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
const words = (cls: string, key: EngineStringKey, tag = 'div', args: readonly unknown[] = []): HTMLElement => { const e = el(cls, tag); e.textContent = engineString(key, args); return e; };
const shown = (e: Element): boolean => (e as HTMLElement).hidden !== true;
/** a glyph's element, parsed as SVG (no HTML sink) */
const glyph = (markup: string): HTMLElement => {
  const box = el('ws-gmenu-svicon', 'i');
  box.append(document.importNode(new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement, true));
  return box;
};
/** the render-scale / AA picks this page was built with (read once at load: the pending count survives a rebuilt menu) */
const BOOT_GFX = { ...gfxPrefs };
export const tabOf = (group: SettingsGroup): SettingsTab => group.slice(0, group.indexOf('.')) as SettingsTab;

export function buildSettingsTabs(scope: Scope, opts: SettingsTabsOptions): SettingsTabsView {
  const root = el('ws-gmenu-sv');
  const strip = el('ws-gmenu-svtabs', 'nav'); strip.setAttribute('role', 'tablist');
  const body = el('ws-gmenu-svbody');
  const buttons = new Map<SettingsTab, HTMLButtonElement>(), panes = new Map<SettingsTab, HTMLElement>();
  const groups = new Map<SettingsGroup, { head: HTMLElement | null; slot: HTMLElement }>();
  let selected: SettingsTab = 'graphics';
  const paint = (): void => {
    for (const [id, pane] of panes) pane.classList.toggle('active', id === selected);
    for (const [id, button] of buttons) { const on = id === selected; button.classList.toggle('active', on); button.setAttribute('aria-selected', String(on)); }
  };
  const select = (tab: SettingsTab): void => { selected = tab; panes.get(tab)?.scrollTo({ top: 0 }); paint(); };
  for (const tab of TABS) {
    const button = el('ws-gmenu-svtab', 'button') as HTMLButtonElement; button.type = 'button'; button.dataset['svTab'] = tab.id; button.setAttribute('role', 'tab');
    if (tab.id === 'dev') button.classList.add('dev');
    button.append(glyph(tab.glyph), words('ws-gmenu-svword', tab.word, 'span'));
    listenTap(scope, button, () => { select(tab.id); });
    buttons.set(tab.id, button); strip.append(button);
    const pane = el('ws-gmenu-svpane'); pane.dataset['scroll'] = ''; pane.dataset['svPane'] = tab.id; pane.setAttribute('role', 'tabpanel');
    panes.set(tab.id, pane); body.append(pane);
  }
  for (const group of GROUPS) {
    const pane = panes.get(tabOf(group.id)); if (pane === undefined) continue;
    const head = group.head === null ? null : words('ws-gmenu-label', group.head);
    const slot = el('ws-gmenu-svgroup'); slot.dataset['svGroup'] = group.id;
    if (head !== null) pane.append(head);
    pane.append(slot); groups.set(group.id, { head, slot });
  }
  root.append(strip, body);

  // ── GRAPHICS: the registry over the built-ins, built once each, re-laid when a registration comes or goes ──
  const builtins = builtinGraphics(scope, opts.applyPending);
  // each control is built under its own child of the menu's scope (Codex review): replacing or unregistering one disposes
  // its listeners with its row, and a late registration's subscriptions belong to the menu, not to whoever registered it
  const built = new Map<string, { control: GraphicsControl; row: HTMLElement; owner: Scope }>();
  const layGraphics = (): void => {
    const merged = new Map<string, GraphicsControl>(builtins.controls.map((control) => [control.id, control]));
    for (const control of graphicsControls()) merged.set(control.id, control);
    for (const [id, { control, row, owner }] of built) if (merged.get(id) !== control) { row.remove(); owner.dispose(); built.delete(id); }
    const order = [...merged.values()].sort((a, b) => GRAPHICS_SECTIONS.indexOf(a.section) - GRAPHICS_SECTIONS.indexOf(b.section) || a.order - b.order);
    for (const control of order) {
      let entry = built.get(control.id);
      if (entry === undefined) {
        const owner = scope.child(`gfx.${control.id}`), row = withOwner(owner, () => control.build(owner));
        row.dataset['gfx'] = control.id; entry = { control, row, owner }; built.set(control.id, entry);
      }
      groups.get(`graphics.${control.section}`)?.slot.append(entry.row);
    }
  };
  layGraphics();
  scope.onDispose(onGraphicsControls(layGraphics));

  const sync = (): void => {
    for (const { control, row } of built.values()) { control.refresh?.(); row.hidden = control.when?.() === false; }
    builtins.paint(); // after `when`: the reload row hides itself while nothing is pending
    for (const { head, slot } of groups.values()) {
      const any = [...slot.children].some(shown);
      slot.hidden = !any; if (head !== null) head.hidden = !any;
    }
    for (const tab of TABS) {
      const pane = panes.get(tab.id), button = buttons.get(tab.id);
      const any = (tab.id !== 'dev' || isDev()) && pane !== undefined && [...pane.querySelectorAll('.ws-gmenu-svgroup')].some(shown);
      if (button !== undefined) button.hidden = !any;
    }
    if (buttons.get(selected)?.hidden === true) selected = 'graphics';
    paint();
  };
  scope.onDispose(onDev(() => { sync(); }));
  scope.listen(document, PIXELS_EVENT, () => { builtins.paint(); });
  paint();
  return {
    root,
    get selected() { return selected; },
    put: (group, els, first = false) => {
      const slot = groups.get(group)?.slot;
      if (slot === undefined) throw new Error(`Settings: no group ${group}`);
      if (first) slot.prepend(...els); else slot.append(...els);
    },
    select,
    sync,
  };
}

/** Graphics's built-ins: the phone's Low / High (MG2, live; MG3's refusal), the boot-time picks (on reload) and the replay */
function builtinGraphics(scope: Scope, applyPending: () => void): { controls: GraphicsControl[]; paint: () => void } {
  const phone = TIER === 'phone';
  const paints: (() => void)[] = [];
  const paint = (): void => { for (const p of paints) p(); };
  const seg = (label: EngineStringKey, options: readonly (readonly [string, EngineStringKey, unknown[]?])[], get: () => string, set: (v: string) => void): HTMLElement => {
    const row = el('ws-gmenu-row'); row.append(words('ws-gmenu-swlabel', label, 'span'));
    const box = el('ws-gmenu-seg');
    for (const [v, text, args] of options) {
      const b = words('ws-gmenu-segbtn', text, 'button', args ?? []) as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = v;
      listenTap(scope, b, () => { set(v); paint(); });
      box.append(b);
    }
    paints.push(() => { for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === get()); });
    row.append(box); return row;
  };
  const controls: GraphicsControl[] = [
    { id: 'mode', section: 'main', order: 0, when: () => phone, build: () => {
      const wrap = el('ws-gmenu-svmodewrap'), cards = el('ws-gmenu-svmode'), note = el('ws-gmenu-note'); note.textContent = lowPowerRefusal();
      let refused = false;
      for (const mode of ['low', 'high'] as const) {
        const card = el('ws-gmenu-svmodecard', 'button') as HTMLButtonElement; card.type = 'button'; card.dataset['mode'] = mode;
        card.append(words('ws-gmenu-svmodeword', mode === 'low' ? 's_st_low' : 's_st_high', 'b'), words('ws-gmenu-svsub', mode === 'low' ? 's_st_low_sub' : 's_st_high_sub', 'small'));
        listenTap(scope, card, () => { refused = !saveGraphicsMode(mode); paint(); });
        cards.append(card);
      }
      paints.push(() => {
        const now = graphicsMode(), locked = lowPowerOn();
        for (const card of cards.children) {
          const mode = (card as HTMLElement).dataset['mode'], on = mode === now;
          card.classList.toggle('active', on); card.setAttribute('aria-pressed', String(on)); card.classList.toggle('locked', locked && mode === 'high');
        }
        note.hidden = !refused && !locked;
      });
      wrap.append(cards, note); return wrap;
    } },
    { id: 'deskNote', section: 'main', order: 0, when: () => !phone, build: () => words('ws-gmenu-note', 's_st_gfx_desk') },
    { id: 'tier', section: 'advanced', order: 10, build: () => seg('s_1b2c08a8733d', [['auto', 's_2e7e5df64556', [automaticTier]], ['phone', 's_63dceb8800b2'], ['desktop', 's_9bd88f2485ac']], () => savedSetting('tier'),
      (v) => { if (v === 'auto' || v === 'phone' || v === 'desktop') saveSetting('tier', v); }) },
    { id: 'scale', section: 'advanced', order: 20, when: () => !phone || isDev(), build: () => seg('s_2dee7435d0fe', [['1', 's_aa23e5562422'], ['1.25', 's_dfbe15a4b4a5'], ['1.5', 's_79105e58c657'], ['2', 's_d1ce94426019'], ['native', 's_d509e4938852'], ['auto', 's_0286249762f7']], () => gfxPrefs.dpr,
      (v) => { if (v === 'auto' || v === '1' || v === '1.25' || v === '1.5' || v === '2' || v === 'native') { gfxPrefs.dpr = v; saveGfxPrefs(); } }) },
    { id: 'aa', section: 'advanced', order: 30, build: () => seg('s_c77c3af22c64', [['on', 's_130011756125'], ['off', 's_ca7981b46ecf'], ['auto', 's_0286249762f7']], () => gfxPrefs.aa,
      (v) => { if (v === 'auto' || v === 'on' || v === 'off') { gfxPrefs.aa = v; saveGfxPrefs(); } }) },
    { id: 'reload', section: 'advanced', order: 90, build: () => {
      const row = el('ws-gmenu-row ws-gmenu-svreload'), note = el('ws-gmenu-swlabel', 'span');
      const b = words('ws-gmenu-segbtn', 's_st_reload', 'button') as HTMLButtonElement; b.type = 'button';
      listenTap(scope, b, () => { applyPending(); reloadWithPicks('settings ▸ graphics: reload to apply', b); });
      paints.push(() => {
        const count = pendingReload().filter((k) => k === 'tier').length + (gfxPrefs.dpr === BOOT_GFX.dpr ? 0 : 1) + (gfxPrefs.aa === BOOT_GFX.aa ? 0 : 1);
        row.hidden = count === 0; note.textContent = engineString('s_st_reload_note', [count]);
      });
      row.append(note, b); return row;
    } },
    { id: 'firstPlay', section: 'setup', order: 0, when: () => phone, build: () => {
      const row = el('ws-gmenu-row'); row.append(words('ws-gmenu-swlabel', 's_st_first_play', 'span'));
      const b = words('ws-gmenu-segbtn', 's_first_play_replay', 'button') as HTMLButtonElement; b.type = 'button';
      paints.push(() => { const armed = !firstPlayDone(); b.disabled = armed; b.textContent = engineString(armed ? 's_first_play_armed' : 's_first_play_replay'); });
      listenTap(scope, b, () => { resetFirstPlay(); paint(); });
      row.append(b); return row;
    } },
  ];
  return { controls, paint };
}

/** Controls ▸ Touch's boot-time pick (Touch controls: Auto / Always) and its own reload row. */
export function touchRows(scope: Scope, applyPending: () => void): HTMLElement[] {
  const row = el('ws-gmenu-row'); row.append(words('ws-gmenu-swlabel', 's_25a35084fbc3', 'span'));
  const box = el('ws-gmenu-seg');
  const reload = el('ws-gmenu-row ws-gmenu-svreload'), note = el('ws-gmenu-swlabel', 'span');
  const now = words('ws-gmenu-segbtn', 's_st_reload', 'button') as HTMLButtonElement; now.type = 'button';
  const paint = (): void => {
    for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === savedSetting('touch'));
    const count = pendingReload().filter((k) => k === 'touch').length; reload.hidden = count === 0; note.textContent = engineString('s_st_reload_note', [count]);
  };
  for (const [v, text] of [['auto', 's_0286249762f7'], ['on', 's_de9f057a471c']] as const) {
    const b = words('ws-gmenu-segbtn', text, 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = v;
    listenTap(scope, b, () => { saveSetting('touch', v); paint(); });
    box.append(b);
  }
  listenTap(scope, now, () => { applyPending(); reloadWithPicks('settings ▸ controls: reload to apply', now); });
  row.append(box); reload.append(note, now); paint();
  return [row, reload];
}
