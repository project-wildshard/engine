import { listenTap } from '../input/dom';
import { uiScope, mountUi } from './ownership';
import { app } from '../app/runtime';
import type { UiHandle } from './layers';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
/**
 * Main menu ▸ SETTINGS (E55): the picks that are read once while the page loads — renderer, quality tier, render scale,
 * anti-aliasing, touch controls — with APPLY & RELOAD. The title's SETTINGS link (src/client/engine/ui/HUD.ts showIntro) opens it.
 * The live toggles (audio, look speed, time of day, painted horizon) are the pause menu's (src/client/engine/ui/Menu.ts); the user,
 * 2026-09-23: "Settings in the main menu can be different from settings in the pause menu, to reduce chaos."
 *
 *   openBootSettings()   // one overlay on <body>, built on first open; Close / Esc / the backdrop close it
 *
 * Every pick is saved at once (src/client/engine/ui/Settings.ts OPTIONS, src/client/engine/core/tier.ts gfxPrefs) but only a reload builds it:
 * APPLY & RELOAD loads the page without the URL params that would override the saved picks (`settingsReloadUrl`) nor the
 * ones that skip the title, so the reload lands back on this title screen. Reuses the in-game menu's look (gmenu.css).
 */
import { automaticTier, TIER, gfxPrefs, saveGfxPrefs } from '../core/tier';
import { graphicsMode, saveGraphicsMode } from '../render/graphicsMode';

import { isDev, onDev } from '../core/devMode';
import { activeLevel } from '../../../shared/engine/level/selection';
import { devSwitchRows } from './devSwitch';
import { foldCard } from './cards';
import { buildDebugMenu, type DebugMenu } from './DebugMenu';
import { TITLE_SKIPPERS } from './debugOptions';
import { MODEL_CREDIT, MUSIC_CREDIT, sfxCredit } from '../audio/credits';
import { BOOT_OPTIONS, getSfxSet, pendingReload, saveSetting, savedSetting, settingFromUrl, settingParams, settingsReloadUrl, type OptionKey, type OptionValue } from './Settings';
import { leaveSaved, markReload } from '../boot/lastEnd';
import { showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';
import { buildOfflineRow } from './offlineDownload';
import { buildConnectionRow } from './errorScreen';
import { buildBuildRow } from './buildRow';
import { buildMusicStyleRow } from './musicStyleRow';

const el = (cls: string, html = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
const words = (cls: string, text: string, tag = 'div'): HTMLElement => { const node = el(cls, '', tag); node.textContent = text; return node; };

type BootKey = 'tier' | 'touch';
interface Row<K extends BootKey> { label: string; experimental?: boolean; options: { v: OptionValue<K>; text: string }[] }
const LABELS: { [K in BootKey]: Row<K> } = {
  tier: { label: engineString('s_1b2c08a8733d'), options: [{ v: 'auto', text: engineString('s_2e7e5df64556', [automaticTier]) }, { v: 'phone', text: engineString('s_63dceb8800b2') }, { v: 'desktop', text: engineString('s_9bd88f2485ac') }] },
  touch: { label: engineString('s_25a35084fbc3'), options: [{ v: 'auto', text: engineString('s_0286249762f7') }, { v: 'on', text: engineString('s_de9f057a471c') }] },
};
const optionLabel = (k: OptionKey): string => (k === 'tier' || k === 'touch' ? LABELS[k].label : k);
/** the render scale / AA picks this page was built with (tier.ts applied them at import) */
const BOOT_GFX = { ...gfxPrefs };

let root: HTMLElement | undefined;
let refresh: (() => void) | undefined;
/** the Debug registry (E162), the same one the pause menu renders (E172) */
let debug: DebugMenu | null = null;
let developerTools: DebugMenu | null = null;
/** G727 / I9: the Offline play row, when the game installed its download */
let offline: ReturnType<typeof buildOfflineRow> = null;
const scope = uiScope('bootSettings', app.engineScope);
let openScope: Scope | null = null;
let layer: UiHandle | null = null;

export function openBootSettings(): void {
  const built = root !== undefined;
  const r = root ?? build(); // the page's one panel (src/shared/engine/app/ownership.ts): its Esc listener is not a shard's
  root = r;
  // re-read which Debug rows apply to the selected level, and their choices
  // (GPU textures' "Auto · now …"), for the one behind it now. No weapons in hand on the title
  debug?.applies({ chunk: activeLevel(), weapons: new Set() });
  developerTools?.applies({ chunk: activeLevel(), weapons: new Set() });
  if (layer?.active !== true) { openScope = scope.child('open'); layer = app.ui.push('menu', { root: r, order: 0, back: close }, openScope); openScope.interval(2000, () => { debug?.paint(); developerTools?.paint(); }); }
  refresh?.(); if (built) offline?.refresh(); // a fresh panel has just sized it
  r.classList.add('show');
  r.inert = false;
}

function close(): void {
  if (!root) return;
  layer?.dispose(); layer = null; openScope?.dispose(); openScope = null;
  root.classList.remove('show');
  root.inert = true;
}

function build(): HTMLElement {
  const r = el('ws-gmenu');
  r.dataset['wsShell'] = ''; // the page's one boot-settings panel: never a resident shard's (src/shared/engine/app/ownership.ts)
  r.inert = true;
  const sheet = el('ws-gmenu-sheet ws-glass');
  sheet.innerHTML = engineString('s_a9be5568aeb1');
  const body = el('ws-gmenu-body');
  const p = el('ws-gmenu-panel scroll active');
  p.dataset['scroll'] = ''; // index.html swallows touchmove outside [data-scroll]
  body.append(p);
  sheet.append(body, el('ws-gmenu-hint', engineString('s_1d538697a99a')));
  r.append(sheet);
  mountUi(r, scope, document.body);

  const running = el('ws-gmenu-note');
  running.textContent = engineString('s_a348737554c0', [TIER]);
  offline = buildOfflineRow(scope);
  const status = el('ws-gmenu-note');
  const actions = el('ws-gmenu-reload-actions');
  const apply = el('ws-gmenu-btn resume', engineString('s_aa22d01f58bf'), 'button') as HTMLButtonElement; apply.type = 'button';
  const paints: (() => void)[] = [];
  const repaint = (): void => {
    const pending: string[] = pendingReload().map(optionLabel);
    if (gfxPrefs.dpr !== BOOT_GFX.dpr) pending.push(engineString('s_2dee7435d0fe'));
    if (gfxPrefs.aa !== BOOT_GFX.aa) pending.push(engineString('s_c77c3af22c64'));
    const count = pending.length + (debug?.pendingReload() ?? 0) + (developerTools?.pendingReload() ?? 0);
    status.textContent = count > 0 ? engineString('s_settings_pending', [count]) : engineString('s_937833a58685');
    actions.hidden = count === 0; apply.hidden = count === 0;
    apply.textContent = engineString('s_settings_apply_reload_count', [count]);
  };

  const seg = (label: string, experimental: boolean, options: { v: string; text: string }[], get: () => string, set: (v: string) => void): HTMLElement => {
    const row = el('ws-gmenu-row', engineString('s_135d0923e690', [label, experimental ? engineString('s_33b99f60d520') : '']));
    const box = el('ws-gmenu-seg');
    const paint = (): void => { for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === get()); };
    for (const o of options) {
      const b = words('ws-gmenu-segbtn', o.text, 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = o.v;
      listenTap(scope, b, () => { set(o.v); paint(); repaint(); });
      box.append(b);
    }
    paints.push(paint); paint();
    row.append(box);
    return row;
  };
  const row = <K extends BootKey>(k: K, spec: Row<K>): HTMLElement =>
    seg(spec.label, spec.experimental === true, spec.options, () => savedSetting(k), (v) => { const o = spec.options.find((x) => x.v === v); if (o) { saveSetting(k, o.v); } });

  const dprOpts = [{ v: '1', text: engineString('s_aa23e5562422') }, { v: '1.25', text: engineString('s_dfbe15a4b4a5') }, { v: '1.5', text: engineString('s_79105e58c657') }, { v: '2', text: engineString('s_d1ce94426019') }, { v: 'native', text: engineString('s_d509e4938852') }, { v: 'auto', text: engineString('s_0286249762f7') }];
  const aaOpts = [{ v: 'on', text: engineString('s_130011756125') }, { v: 'off', text: engineString('s_ca7981b46ecf') }, { v: 'auto', text: engineString('s_0286249762f7') }];
  // E172 (the user: "main menu doesnt even have dev/debug just pause menu"): the pause menu's Debug registry
  // (src/client/engine/ui/debugOptions.ts → DebugMenu.ts: the same rows, Clear downloads among them), in the same folding card as the
  // pause menu's (E177) and, like it, only in developer mode. The Developer switch itself sits in the open above it
  // (Jake, 2026-09-26: "back in the open") — it is how the card appears at all.
  const dbg = foldCard('bootdebug', engineString('s_1a03bd2fd107'), engineString('s_8c4422087396'));
  const tools = foldCard('bootDeveloperTools', engineString('s_3fb7b39416f1'));
  developerTools = buildDebugMenu(tools, { purpose: 'developer', onPick: repaint });
  const registry = el('ws-gmenu-debugslot');
  debug = buildDebugMenu(registry, { onPick: repaint });
  dbg.append(registry);
  // MG2: a phone picks Low or High graphics (render/graphicsMode.ts), live, saved on the device; the finer render scale is a
  // Developer's (desktop keeps it in the open, as before)
  const phone = TIER === 'phone';
  const scale = seg(engineString('s_2dee7435d0fe'), false, dprOpts, () => gfxPrefs.dpr, (v) => { if (v === 'auto' || v === '1' || v === '1.25' || v === '1.5' || v === '2' || v === 'native') { gfxPrefs.dpr = v; saveGfxPrefs(); } });
  const mobile = phone ? [seg(engineString('s_gfx_mode'), false, [{ v: 'low', text: engineString('s_gfx_low') }, { v: 'high', text: engineString('s_gfx_high') }], graphicsMode, (v) => { if (v === 'low' || v === 'high') saveGraphicsMode(v); })] : [];
  const scaleShown = (): void => { scale.hidden = phone && !isDev(); };
  scaleShown();
  dbg.hidden = !isDev(); tools.hidden = !isDev(); onDev((on) => { dbg.hidden = !on; tools.hidden = !on; scaleShown(); if (on) { debug?.paint(); developerTools?.paint(); } });
  p.append(running,
    el('ws-gmenu-label', engineString('s_a874fca87cdd')), ...mobile, row('tier', LABELS.tier), scale,
    seg(engineString('s_c77c3af22c64'), false, aaOpts, () => gfxPrefs.aa, (v) => { if (v === 'auto' || v === 'on' || v === 'off') { gfxPrefs.aa = v; saveGfxPrefs(); } }),
    el('ws-gmenu-label', engineString('s_799c26913574')), row('touch', LABELS.touch),
    buildMusicStyleRow(scope),
    ...offline === null ? [] : [offline], // G727 / I9: Download everything, before the first shard
    buildConnectionRow(scope), // E7.5 prep: the Connection doctor, for everyone
    buildBuildRow(scope), // R9: the running build, Check and Reload, beside the doctor
    ...devSwitchRows(), // developer mode (E140): live, no reload
    tools, dbg);
  // the agents' screenshot URLs carry params that win over the saved picks for that load: say so
  const overridden = BOOT_OPTIONS.filter((k) => settingFromUrl(k));
  if (overridden.length > 0) p.append(words('ws-gmenu-note', engineString('s_7537bbaf9c47', [overridden.map((k) => `${optionLabel(k)} (?${settingParams(k).join(' / ?')})`).join(', ')])));
  p.append(status); actions.append(apply); body.after(actions);
  // credits (E64 — Jake: "get that music attribution out of here and move it to a dedicated credits page"): the title used to
  // print them under the cards; they live here now, and in the pause menu ▸ Settings ▸ Audio next to the pickers
  p.append(el('ws-gmenu-label', engineString('s_2a6b24ad2872')), ...[MUSIC_CREDIT, sfxCredit(getSfxSet()), MODEL_CREDIT].filter((t) => t !== '').map((t) => words('ws-gmenu-note', t)));

  listenTap(scope, apply, () => {
    showReloading(apply); // RL3: the tap's own turn
    debug?.applyPending(); developerTools?.applyPending();
    const next = settingsReloadUrl(location.href, TITLE_SKIPPERS);
    leaveSaved(() => { leaveAfterPaint(() => { markReload('main menu settings: apply & reload'); if (next === location.href) location.reload(); else location.replace(next); }); });
  });
  const closeBtn = sheet.querySelector<HTMLButtonElement>('.ws-gmenu-close');
  if (closeBtn) listenTap(scope, closeBtn, close);
  scope.listen(r, 'pointerdown', (e) => { if (e.target === r) close(); });
  refresh = () => { for (const paint of paints) paint(); repaint(); };
  refresh();
  return r;
}
