import { listenTap } from '../input/dom';
import { reloadWithPicks } from './ReloadPrompt';
import type { Scope } from '../../../shared/engine/app/scope';
import { buildControlsPanel } from '../input/ControlsPanel';
import { engineString } from '../../../shared/engine/strings';
import { buildSavePanel } from './SavePanel';
import { app } from '../app/runtime';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { getSetting, setSetting, onSetting, getNumber, setNumber, NUM_RANGE, getSfxSet, type SettingKey, type NumberKey } from './Settings';
import { MODEL_CREDIT, MUSIC_CREDIT, sfxCredit, onSfxCredit } from '../audio/credits';
import { CAN_VIBRATE } from './haptics';
import { lockReview, onReview, quickNote, reviewUnlocked, setQuickNote, unlockReview } from './review';
import { isDev, onDev } from '../core/devMode';
import { devSwitchRows } from './devSwitch';
import { foldCard } from './cards';
import { buildDebugMenu, type DebugMenu } from './DebugMenu';
import { settingsCategories, type SettingsCat, type SettingsCats } from './settingsCats';
import { SAVE_STRINGS } from './saveStrings';
import { TIER } from '../core/tier';
import { buildMusicStyleRow } from './musicStyleRow';

export interface SettingsCtx { weapons: ReadonlySet<string>; melee: boolean; tracers: boolean; huntersEye: boolean; chunk: LevelSpec }
type When = (context: SettingsCtx) => boolean;
export interface MenuSettingsState {
  cats: SettingsCats | undefined;
  settingsCard: HTMLElement | undefined;
  gated: {el: HTMLElement; when: When}[];
  debug: DebugMenu | null;
  developerTools: DebugMenu | null;
  paintPendingReload: () => void;
  savePanel: ReturnType<typeof buildSavePanel> | null;
  controlsPanel: ReturnType<typeof buildControlsPanel> | undefined;
}
export interface MenuSettingsHost {
  readonly scope: Scope;
  readonly panel: HTMLElement;
  readonly hint: HTMLElement;
  readonly syncCats: () => void;
  readonly tab: () => string;
}

const el = (cls: string, html = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
const words = (cls: string, text: string, tag = 'div'): HTMLElement => { const node = el(cls, '', tag); node.textContent = text; return node; };
const esc = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
export function buildMenuSettings(host: MenuSettingsHost, state: MenuSettingsState): void {
    const panel = host.panel;
    const catLabel: Record<SettingsCat, string> = { video: engineString('s_settings_video'), audio: engineString('s_bc1b88907d3b'), controls: engineString('s_799c26913574'), keys: engineString('s_f4fce9bc331d'),
      gameplay: engineString('s_31bcb8940fff'), save: SAVE_STRINGS.title, review: engineString('s_aff0766a5290'), debug: engineString('s_1a03bd2fd107') };
    const cats = settingsCategories(panel, host.scope, catLabel, () => { host.syncCats(); }); state.cats = cats;
    // E178: no full-width RESUME / EXIT TO MAIN MENU on top of the panel any more — they are the header bar's two buttons
    const p = el('ws-gmenu-card', engineString('s_e68f72548349')); state.settingsCard = p;
    const dbg = foldCard('debug', engineString('s_1a03bd2fd107'), engineString('s_8c4422087396')); // E177: folded until it is asked for
    const tools = foldCard('developerTools', engineString('s_3fb7b39416f1'));
    // developer mode only (E140, the user's 7a): the Settings ▸ Developer switch shows / hides it live
    dbg.hidden = !isDev(); tools.hidden = !isDev(); onDev((on) => { dbg.hidden = !on; tools.hidden = !on; cats.sync(); });
    cats.pane.append(p, tools, dbg); cats.tag('review', tools); cats.tag('debug', dbg);
    // VIDEO (desktop rail only): the boot-time picks are the main menu's (E55), so the pause menu reads them out
    const tierRow = el('ws-gmenu-row', engineString('s_b756f4e0f8ff', [esc(engineString('s_1b2c08a8733d'))])), tierVal = tierRow.querySelector<HTMLElement>('.ws-gmenu-val');
    if (tierVal) tierVal.textContent = TIER === 'phone' ? engineString('s_63dceb8800b2') : engineString('s_9bd88f2485ac');
    const video = [cats.head(el('ws-gmenu-label', esc(catLabel.video))), tierRow, el('ws-gmenu-note', esc(engineString('s_settings_video_note')))];
    p.append(...video); cats.tag('video', ...video);

    const sw = (key: SettingKey, label: string) => {
      const b = el('ws-gmenu-switch', engineString('s_d652c0be6be8', [label]), 'button') as HTMLButtonElement; b.type = 'button'; b.setAttribute('role', 'switch');
      const sync = (v: boolean) => { b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); };
      sync(getSetting(key)); onSetting(key, sync);
      listenTap(host.scope, b, () => setSetting(key, !getSetting(key)));
      return b;
    };
    // "applies when" (E130): a row that does not apply to the weapons you hold or to this shard is hidden (re-read on every
    // open — a weapon unlocked mid-run brings its rows); a section label goes with its last row
    const section = (card: HTMLElement, cat: SettingsCat, label: string, ...rows: (HTMLElement | [When, HTMLElement])[]): void => {
      const whens: When[] = [];
      const els = rows.map((r) => { if (Array.isArray(r)) { whens.push(r[0]); state.gated.push({ el: r[1], when: r[0] }); return r[1]; } whens.push(() => true); return r; });
      const head = el('ws-gmenu-label', label);
      cats.head(head); // both sections are named as their category
      state.gated.push({ el: head, when: (c) => whens.some((w) => w(c)) });
      card.append(head, ...els); cats.tag(cat, head, ...els);
    };
    const ranged: When = (c) => c.tracers; // the bolts / rounds draw tracers: Nalati's bow draws none (NALATI-MERGE F7)
    section(p, 'gameplay', engineString('s_31bcb8940fff'), sw('aimAssist', engineString('s_714896153134')),
      [ranged, sw('tracers', engineString('s_702cb41e280a'))],
      [(c) => c.huntersEye, sw('huntersEye', engineString('s_80f6259cced8'))], // the bow's drop arc (Bow.ts): on by default on touch
      [() => CAN_VIBRATE, sw('haptics', engineString('s_59e1fd02f6c2'))]); // Android only — iOS Safari has no vibrate (src/client/engine/ui/haptics.ts)

    // controls: the 0.5–2× look multipliers (Settings 'look' / 'swingLook') — read live by TouchControls + Player's mouse look
    const mult = (key: NumberKey, label: string) => {
      const [lo, hi] = NUM_RANGE[key];
      const row = el('ws-gmenu-row', engineString('s_b756f4e0f8ff', [label]));
      const val = row.querySelector<HTMLElement>('.ws-gmenu-val');
      const s = document.createElement('input'); s.type = 'range'; s.className = 'ws-gmenu-slider';
      s.min = String(lo * 100); s.max = String(hi * 100); s.step = '5'; s.value = String(Math.round(getNumber(key) * 100));
      const paint = () => { if (val) val.textContent = engineString('s_03a5f0ef36b4', [(Number(s.value) / 100).toFixed(2)]); };
      host.scope.listen(s, 'input', () => { setNumber(key, Number(s.value) / 100); paint(); });
      host.scope.listen(s, 'pointerdown', (e) => e.stopPropagation());
      paint(); row.append(s); return row;
    };
    section(p, 'controls', engineString('s_799c26913574'), mult('look', engineString('s_64e57bf9ef8a')), [(c) => c.melee, mult('swingLook', engineString('s_e532946ea0dd'))]); // a swing's turn: the blades

    // audio: master volume (Settings 'volume', 0..1) — main.ts drives the AudioContext gain from it
    const vol = el('ws-gmenu-row', engineString('s_31a1802e19b8'));
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.className = 'ws-gmenu-slider';
    slider.value = String(Math.round(getNumber('volume') * 100));
    host.scope.listen(slider, 'input', () => setNumber('volume', Number(slider.value) / 100));
    host.scope.listen(slider, 'pointerdown', (e) => e.stopPropagation());
    vol.append(slider);
    // music volume (Settings 'music', 0..1) — src/client/engine/audio/Music.ts drives its bus from it
    const mus = el('ws-gmenu-row', engineString('s_4db5c63706fd'));
    const mslider = document.createElement('input'); mslider.type = 'range'; mslider.min = '0'; mslider.max = '100'; mslider.className = 'ws-gmenu-slider';
    mslider.value = String(Math.round(getNumber('music') * 100));
    host.scope.listen(mslider, 'input', () => setNumber('music', Number(mslider.value) / 100));
    host.scope.listen(mslider, 'pointerdown', (e) => e.stopPropagation());
    mus.append(mslider);
    // music style (Settings 'musicStyle', project/archive/2026-09-23-music.md v3): the MiniMax-Music3 scores or the v1 synth — Music.ts crossfades on a bar;
    // Best sound samples (MOSS-SoundEffect v2 + Stable Audio 3 Medium); synth covers missing samples.
    const picker = <T extends string>(label: string, options: { v: T; text: string }[], get: () => T, set: (v: T) => void, on: (fn: () => void) => void) => {
      const row = el('ws-gmenu-row', engineString('s_54fa835c7c85', [label]));
      const box = el('ws-gmenu-seg');
      const paint = () => { for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === get()); };
      for (const o of options) {
        const b = words('ws-gmenu-segbtn', o.text, 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = o.v;
        listenTap(host.scope, b, () => { set(o.v); paint(); });
        box.append(b);
      }
      paint(); on(paint); row.append(box); return row;
    };
    // a pick decodes from the offline cache (project/archive/2026-09-23-preload-offline.md): a spinner by the label only past 300 ms
    // the licences ask for the models' names in the UI: MiniMax-Music3, and the sfx set's credit ("Powered by Stability AI")
    const sfxNote = el('ws-gmenu-note');
    const paintCredit = () => { const c = sfxCredit(getSfxSet()); sfxNote.textContent = c; sfxNote.hidden = c === ''; };
    paintCredit(); onSfxCredit(paintCredit);
    const audio = [cats.head(el('ws-gmenu-label', engineString('s_bc1b88907d3b'))), vol, mus, buildMusicStyleRow(host.scope), el('ws-gmenu-note', MUSIC_CREDIT), sfxNote, el('ws-gmenu-note', MODEL_CREDIT)];
    p.append(...audio); cats.tag('audio', ...audio);
    // lock-on (E50, src/client/engine/player/LockOnTarget.ts): how hard the view follows a locked enemy (Gentle = Jake's pick; Off keeps the
    // lock — the reticle, orbit strafing, the lunge, switching — but never turns the view: the motion-sickness escape)
    const lockCams: { v: '1' | '0.5' | '0'; text: string }[] = [{ v: '1', text: engineString('s_641d1ef657bd') }, { v: '0.5', text: engineString('s_96124817c810') }, { v: '0', text: engineString('s_ca7981b46ecf') }];
    const lockCam = picker(engineString('s_21ed7056ff10'), lockCams, () => (getNumber('lockCam') >= 0.75 ? '1' : getNumber('lockCam') > 0.1 ? '0.5' : '0'), (v) => setNumber('lockCam', Number(v)), () => undefined);
    const lockOn = [el('ws-gmenu-label', engineString('s_fcc34c9149ac')), lockCam, sw('autoLock', engineString('s_c436a89a4252')), el('ws-gmenu-note', engineString('s_c12db72ef23e'))];
    p.append(...lockOn); cats.tag('gameplay', ...lockOn);

    // DEBUG (E162): every variant, taste toggle and developer aid, grouped — declared once in src/client/engine/ui/debugOptions.ts and
    // rendered by src/client/engine/ui/DebugMenu.ts (collapsible groups, only the rows that apply to this shard, a filter). Shards in
    // memory carries the on-device readout (E155 / E159): refreshed only while this menu is open on Settings
    const actions = el('ws-gmenu-reload-actions');
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'ws-gmenu-btn resume';
    const paintPending = (): void => {
      const count = (state.debug?.pendingReload() ?? 0) + (state.developerTools?.pendingReload() ?? 0);
      actions.hidden = count === 0 || host.tab() !== 'settings'; apply.hidden = count === 0; apply.textContent = engineString('s_settings_apply_reload_count', [count]);
    };
    state.debug = buildDebugMenu(dbg, { onPick: paintPending });
    state.developerTools = buildDebugMenu(tools, { purpose: 'developer', onPick: paintPending });
    listenTap(host.scope, apply, () => { state.debug?.applyPending(); state.developerTools?.applyPending(); reloadWithPicks('pause settings: apply & reload', apply); });
    state.paintPendingReload = paintPending;
    paintPending(); actions.append(apply); host.hint.before(actions);
    // Review is not debug (E140): playtesters unlock notes with it, so it stays in Settings, with the Developer switch
    const review = [buildReview(host.scope), ...devSwitchRows()];
    p.append(...review); cats.tag('review', ...review);
    state.savePanel = buildSavePanel(); cats.pane.append(state.savePanel); cats.tag('save', state.savePanel);
    state.controlsPanel = buildControlsPanel(app.levelScope ?? app.engineScope); cats.pane.append(state.controlsPanel); cats.tag('keys', state.controlsPanel);
    cats.sync();
  }

function buildReview(scope: Scope): HTMLElement {
    const box = el('ws-gmenu-review');
    const render = () => {
      box.replaceChildren(el('ws-gmenu-label', engineString('s_aff0766a5290')));
      if (!reviewUnlocked()) {
        const row = el('ws-gmenu-row');
        const input = document.createElement('input'); input.type = 'password'; input.className = 'ws-gmenu-input'; input.placeholder = engineString('s_3aa9d82ecee0');
        input.autocomplete = 'off'; input.enterKeyHint = 'go';
        const go = el('ws-gmenu-unlock', engineString('s_4ac709aa58bc'), 'button') as HTMLButtonElement; go.type = 'button';
        const note = el('ws-gmenu-note', engineString('s_0a5f05def8ad'));
        const tryUnlock = async () => {
          go.disabled = true; note.textContent = engineString('s_ec963ffc911b');
          const r = await unlockReview(input.value);
          go.disabled = false;
          note.textContent = r === 'bad' ? engineString('s_08e7aa3eae21') : r === 'offline' ? engineString('s_76856232ac38') : '';
        };
        // the menu listens for M / Esc and the player for WASD on document: typing a password must not reach them
        scope.listen(input, 'keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); if (e.code === 'Enter') void tryUnlock(); });
        scope.listen(input, 'keyup', (e) => { e.stopPropagation(); });
        listenTap(scope, go, () => { void tryUnlock(); });
        row.append(input, go);
        box.append(row, note);
        return;
      }
      const sw = el('ws-gmenu-switch', engineString('s_e1e76f890568'), 'button') as HTMLButtonElement; sw.type = 'button'; sw.setAttribute('role', 'switch');
      sw.classList.toggle('on', quickNote()); sw.setAttribute('aria-checked', String(quickNote()));
      listenTap(scope, sw, () => setQuickNote(!quickNote()));
      const lock = el('ws-gmenu-unlock', engineString('s_db44b8db4f05'), 'button') as HTMLButtonElement; lock.type = 'button';
      listenTap(scope, lock, () => lockReview());
      const row = el('ws-gmenu-row', engineString('s_b39f8f67f676'));
      row.append(lock);
      box.append(sw, row, el('ws-gmenu-note', engineString('s_806c6e56a7d8')));
    };
    render(); onReview(render);
    return box;
  }
