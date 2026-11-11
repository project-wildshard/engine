import { uiScope, mountUi } from './ownership';
import { app } from '../app/runtime';
import type { UiHandle } from './layers';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
import { listenTap } from '../input/dom';
import { withOwner } from '../../../shared/engine/app/ownership';
/**
 * Main menu ▸ SETTINGS (SR11, one Settings everywhere): the same tabs as the in-game menu (J245 layout A: menuSettings.ts,
 * settingsTabs.ts), GRAPHICS · SOUND · CONTROLS · SAVES · SYSTEM and DEV in Developer mode, with the same Graphics controls
 * (graphicsBlock.ts graphicsSettingsControls). The in-game-only rows stay out: the game's shard save cards (a game adds
 * them in a level), the weapon rows (gated off: nothing is held here) and Review. This replaces the 2026-09-23 split
 * ("Settings in the main menu can be different from settings in the pause menu"; SETTINGS-REDESIGN decision 3).
 *
 *   openBootSettings()   // one overlay on <body>, built on first open; Close / Esc / the backdrop close it
 *
 * The title's SETTINGS (src/client/engine/ui/HUD.ts showIntro), the start title and the loading card open it. A pick that
 * applies on reload shows its tab's own "Reload now" (Dev's Apply & reload), which lands back on the title from here
 * (ReloadPrompt.ts reloadWithPicks: no world, so no pose).
 */
import { TIER } from '../core/tier';
import { PIXELS_EVENT } from '../core/graphicsMode';
import { graphicsSettingsControls } from './graphicsBlock';
import { selectedLevel } from '../../../shared/engine/level/selection';
import { BOOT_OPTIONS, settingFromUrl, settingParams } from './Settings';
import { buildMenuSettings, type MenuSettingsState, type SettingsCtx } from './menuSettings';

const el = (cls: string, tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; return e; };
const words = (cls: string, text: string): HTMLElement => { const node = el(cls); node.textContent = text; return node; };

let root: HTMLElement | undefined;
const state: MenuSettingsState = { tabs: undefined, gated: [], debug: null, developerTools: null, paintPendingReload: () => undefined, savePanel: null, controlsPanel: undefined };
const scope = uiScope('bootSettings', app.engineScope);
let openScope: Scope | null = null;
let layer: UiHandle | null = null;
/** the title holds nothing: the weapon rows (swing speed, Hunter's eye, tracers) stay hidden */
const TITLE_CTX: Omit<SettingsCtx, 'chunk'> = { weapons: new Set(), melee: false, tracers: false, huntersEye: false };

/** what Menu.applies does on every open: the rows that apply now, and the Debug rows for the level behind the title */
function applies(): void {
  state.savePanel?.refresh();
  state.controlsPanel?.refresh();
  // QA 30: the loading card opens this before its level is configured; the level rows then wait for the next open
  const level = selectedLevel();
  for (const g of state.gated) g.el.hidden = !g.when(TITLE_CTX);
  if (level !== null) { state.debug?.applies({ chunk: level, weapons: new Set() }); state.developerTools?.applies({ chunk: level, weapons: new Set() }); }
  state.tabs?.sync();
  state.paintPendingReload();
}

export function openBootSettings(): void {
  const r = root ?? build(); // the page's one panel (src/shared/engine/app/ownership.ts): its Esc listener is not a shard's
  root = r;
  if (layer?.active !== true) {
    openScope = scope.child('open');
    layer = app.ui.push('menu', { root: r, order: 0, back: close }, openScope);
    openScope.interval(2000, () => { state.debug?.paint(); state.developerTools?.paint(); state.tabs?.sync(); });
    openScope.listen(document, PIXELS_EVENT, () => { state.tabs?.sync(); });
  }
  applies();
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
  const r = el('ws-gmenu ws-gmenu-svmenu ws-gmenu-boot');
  r.dataset['wsShell'] = ''; // the page's one boot-settings panel: never a resident shard's (src/shared/engine/app/ownership.ts)
  r.inert = true;
  const sheet = el('ws-gmenu-sheet ws-glass');
  sheet.innerHTML = engineString('s_a9be5568aeb1');
  const sub = sheet.querySelector<HTMLElement>('.ws-gmenu-sub'); if (sub !== null) sub.textContent = engineString('s_st_title_sub');
  const body = el('ws-gmenu-body');
  const panel = el('ws-gmenu-panel ws-gmenu-svpanel active');
  body.append(panel);
  const hint = words('ws-gmenu-hint', engineString('s_st_title_hint'));
  sheet.append(body, hint);
  r.append(sheet);
  mountUi(r, scope, document.body);

  withOwner(scope, () => { buildMenuSettings({ scope, panel, hint, tab: () => 'settings', title: true, graphics: graphicsSettingsControls() }, state); });
  // which quality this page runs, and (the agents' screenshot URLs) a param that wins over the saved pick for this load
  const overridden = BOOT_OPTIONS.filter((k) => settingFromUrl(k));
  state.tabs?.put('graphics.advanced', [words('ws-gmenu-note', engineString('s_a348737554c0', [TIER]))], true);
  if (overridden.length > 0) state.tabs?.put('graphics.advanced', [words('ws-gmenu-note', engineString('s_7537bbaf9c47', [overridden.map((k) => `${k} (?${settingParams(k).join(' / ?')})`).join(', ')]))]);

  const closeBtn = sheet.querySelector<HTMLButtonElement>('.ws-gmenu-close');
  if (closeBtn) listenTap(scope, closeBtn, close);
  scope.listen(r, 'pointerdown', (e) => { if (e.target === r) close(); });
  return r;
}
