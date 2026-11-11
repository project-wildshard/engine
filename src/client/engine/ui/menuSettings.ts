import { listenTap } from '../input/dom';
import { reloadWithPicks } from './ReloadPrompt';
import type { Scope } from '../../../shared/engine/app/scope';
import { buildControlsPanel } from '../input/ControlsPanel';
import { engineString } from '../../../shared/engine/strings';
import { buildSavePanel } from './SavePanel';
import { app } from '../app/runtime';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { getSetting, setSetting, onSetting, getNumber, setNumber, getSfxSet, NUM_RANGE, type SettingKey, type NumberKey } from './Settings';
import { MODEL_CREDIT, MUSIC_CREDIT, sfxCredit, onSfxCredit } from '../audio/credits';
import { CAN_VIBRATE } from './haptics';
import { lockReview, onReview, quickNote, reviewUnlocked, setQuickNote, unlockReview } from './review';
import { isDev, onDev } from '../core/devMode';
import { devSwitchRows } from './devSwitch';
import { foldCard } from './cards';
import { buildDebugMenu, type DebugMenu } from './DebugMenu';
import { buildMusicStyleRow } from './musicStyleRow';
import { buildSettingsTabs, touchRows, type SettingsGroup, type SettingsTabsView } from './settingsTabs';
import type { GraphicsControl } from './graphicsControls';
import { voiceSettingsRows } from './voiceSettings';

export interface SettingsCtx { weapons: ReadonlySet<string>; melee: boolean; tracers: boolean; huntersEye: boolean; chunk: LevelSpec }
/** a gated row's test: what you hold (no row reads the shard, so the title can ask it too) */
type When = (context: Omit<SettingsCtx, 'chunk'>) => boolean;
export interface MenuSettingsState {
  tabs: SettingsTabsView | undefined;
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
  readonly tab: () => string;
  /** SR13: System ▸ Feedback opens the composer (the menu's feedback panel); absent, no Feedback row */
  readonly openFeedback?: () => void;
  /** SR11: the title's Settings: the same tabs, without the in-game-only rows (Review; the weapon rows stay gated off) */
  readonly title?: boolean;
  /** Graphics controls of this menu's own (settingsTabs.ts SettingsTabsOptions.graphics) */
  readonly graphics?: readonly GraphicsControl[];
}

const el = (cls: string, html = '', tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
/** The in-game Settings (J245, layout A: settingsTabs.ts): every row, put in its tab's group.
 *  Graphics · Sound · Controls · Saves · System, and Dev in Developer mode. Rows that apply only sometimes (E130: the weapon
 *  you hold, Android's vibration) are gated: hidden, not greyed, re-read on every open (Menu.applies). */
export function buildMenuSettings(host: MenuSettingsHost, state: MenuSettingsState): void {
    const applyPending = (): void => { state.debug?.applyPending(); state.developerTools?.applyPending(); };
    const tabs = buildSettingsTabs(host.scope, { applyPending, ...(host.graphics === undefined ? {} : { graphics: host.graphics }) }); state.tabs = tabs;
    host.panel.append(tabs.root);
    const put = (group: SettingsGroup, ...rows: (HTMLElement | [When, HTMLElement])[]): void => {
      tabs.put(group, rows.map((r) => { if (Array.isArray(r)) { state.gated.push({ el: r[1], when: r[0] }); return r[1]; } return r; }));
    };

    const sw = (key: SettingKey, label: string): HTMLButtonElement => {
      const b = el('ws-gmenu-switch', engineString('s_d652c0be6be8', [label]), 'button') as HTMLButtonElement; b.type = 'button'; b.setAttribute('role', 'switch'); b.dataset['setting'] = key;
      const sync = (v: boolean): void => { b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); };
      sync(getSetting(key)); onSetting(key, sync);
      listenTap(host.scope, b, () => { setSetting(key, !getSetting(key)); });
      return b;
    };
    // a 0.5–2× multiplier (look / swingLook) or a 0–100 % level (volume / music); read live by their systems
    const slider = (key: NumberKey, labelHtml: string, readout: boolean): HTMLElement => {
      const [lo, hi] = NUM_RANGE[key];
      const row = el('ws-gmenu-row', readout ? engineString('s_b756f4e0f8ff', [labelHtml]) : labelHtml); row.dataset['setting'] = key;
      const val = row.querySelector<HTMLElement>('.ws-gmenu-val');
      const s = document.createElement('input'); s.type = 'range'; s.className = 'ws-gmenu-slider';
      s.min = String(lo * 100); s.max = String(hi * 100); s.step = readout ? '5' : '1'; s.value = String(Math.round(getNumber(key) * 100));
      const paint = (): void => { if (val) val.textContent = engineString('s_03a5f0ef36b4', [(Number(s.value) / 100).toFixed(2)]); };
      host.scope.listen(s, 'input', () => { setNumber(key, Number(s.value) / 100); paint(); });
      host.scope.listen(s, 'pointerdown', (e) => { e.stopPropagation(); });
      paint(); row.append(s); return row;
    };
    const picker = <T extends string>(key: string, label: string, options: { v: T; text: string }[], get: () => T, set: (v: T) => void): HTMLElement => {
      const row = el('ws-gmenu-row', engineString('s_54fa835c7c85', [label])); row.dataset['setting'] = key;
      const box = el('ws-gmenu-seg');
      const paint = (): void => { for (const c of box.children) (c as HTMLElement).classList.toggle('active', (c as HTMLElement).dataset['v'] === get()); };
      for (const o of options) {
        const b = el('ws-gmenu-segbtn', '', 'button') as HTMLButtonElement; b.type = 'button'; b.dataset['v'] = o.v; b.textContent = o.text;
        listenTap(host.scope, b, () => { set(o.v); paint(); });
        box.append(b);
      }
      paint(); row.append(box); return row;
    };

    // ── SOUND: the two levels, then the score and the credits its models' licences ask for beside it ──
    const sfxNote = el('ws-gmenu-note');
    const paintCredit = (): void => { const c = sfxCredit(getSfxSet()); sfxNote.textContent = c; sfxNote.hidden = c === ''; };
    paintCredit(); onSfxCredit(paintCredit);
    put('sound.volume', slider('volume', engineString('s_31a1802e19b8'), false), slider('music', engineString('s_4db5c63706fd'), false));
    put('sound.music', buildMusicStyleRow(host.scope), el('ws-gmenu-note', MUSIC_CREDIT), sfxNote);
    // VOICE-POLISH V10: Voice, only in a build of the online world (single player has no voice); re-read on every tap into Sound
    if ((globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined) {
      const voice = voiceSettingsRows(host.scope); put('sound.voice', ...voice.rows);
      host.scope.listen(tabs.root, 'pointerup', () => { if (tabs.selected === 'sound') queueMicrotask(voice.refresh); }, { capture: true });
    }

    // ── CONTROLS: the camera, lock-on (E50: Gentle = Jake's pick; Off keeps the lock but never turns the view), the aim aids
    //    that apply to what you hold (the bow's drop arc, the bolts' tracers), touch, and a desktop's key bindings ──
    put('controls.camera', slider('look', engineString('s_64e57bf9ef8a'), true), [(c) => c.melee, slider('swingLook', engineString('s_e532946ea0dd'), true)]);
    const lockCams: { v: '1' | '0.5' | '0'; text: string }[] = [{ v: '1', text: engineString('s_641d1ef657bd') }, { v: '0.5', text: engineString('s_96124817c810') }, { v: '0', text: engineString('s_ca7981b46ecf') }];
    put('controls.lock', picker('lockCam', engineString('s_21ed7056ff10'), lockCams, () => (getNumber('lockCam') >= 0.75 ? '1' : getNumber('lockCam') > 0.1 ? '0.5' : '0'), (v) => { setNumber('lockCam', Number(v)); }),
      sw('autoLock', engineString('s_c436a89a4252')), el('ws-gmenu-note', engineString('s_c12db72ef23e')));
    put('controls.aim', sw('aimAssist', engineString('s_714896153134')), [(c) => c.huntersEye, sw('huntersEye', engineString('s_80f6259cced8'))],
      [(c) => c.tracers, sw('tracers', engineString('s_702cb41e280a'))]); // NALATI-MERGE F7: the bow draws no tracers
    put('controls.touch', ...touchRows(host.scope, applyPending), [() => CAN_VIBRATE, sw('haptics', engineString('s_59e1fd02f6c2'))]); // vibrate: Android only
    // the title's panel outlives a level, so it owns its key bindings
    state.controlsPanel = buildControlsPanel(host.title === true ? host.scope : (app.levelScope ?? app.engineScope)); put('controls.keys', state.controlsPanel);

    // ── SAVES: the game's shard cards (addSettingsSection('saves.game')), then the progress file ──
    state.savePanel = buildSavePanel(host.title === true ? host.scope : undefined); put('saves.file', state.savePanel);

    // ── SYSTEM: the link, the build, offline play; Review (E140: not debug, playtesters unlock notes with it); the Developer
    //    switch; the model credit ──
    put('system.link', ...state.savePanel.system);
    if (host.title !== true) put('system.review', buildReview(host.scope, host.openFeedback));
    put('system.developer', ...devSwitchRows());
    put('system.credits', el('ws-gmenu-note', MODEL_CREDIT));

    // ── DEV (Developer mode only, E140): the developer tools and the Debug registry (E162), with one Apply & reload ──
    const dbg = foldCard('debug', engineString('s_1a03bd2fd107'), engineString('s_8c4422087396')); // E177: folded until it is asked for
    const tools = foldCard('developerTools', engineString('s_3fb7b39416f1'));
    dbg.hidden = !isDev(); tools.hidden = !isDev(); onDev((on) => { dbg.hidden = !on; tools.hidden = !on; tabs.sync(); });
    put('dev.tools', tools, dbg);
    const actions = el('ws-gmenu-reload-actions');
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'ws-gmenu-btn resume';
    const paintPending = (): void => {
      const count = (state.debug?.pendingReload() ?? 0) + (state.developerTools?.pendingReload() ?? 0);
      actions.hidden = count === 0 || host.tab() !== 'settings'; apply.hidden = count === 0; apply.textContent = engineString('s_settings_apply_reload_count', [count]);
    };
    state.debug = buildDebugMenu(dbg, { onPick: paintPending });
    state.developerTools = buildDebugMenu(tools, { purpose: 'developer', onPick: paintPending });
    listenTap(host.scope, apply, () => { applyPending(); reloadWithPicks('pause settings: apply & reload', apply); });
    state.paintPendingReload = paintPending;
    paintPending(); actions.append(apply); host.hint.before(actions);
    tabs.sync();
  }

/** Settings ▸ System ▸ Review: the password, or (unlocked) Quick note, LOCK and, SR13, the Feedback row that opens the composer */
function buildReview(scope: Scope, openFeedback?: () => void): HTMLElement {
    const box = el('ws-gmenu-review');
    const render = (): void => {
      box.replaceChildren(el('ws-gmenu-label', engineString('s_aff0766a5290')));
      if (!reviewUnlocked()) {
        const row = el('ws-gmenu-row');
        const input = document.createElement('input'); input.type = 'password'; input.className = 'ws-gmenu-input'; input.placeholder = engineString('s_3aa9d82ecee0');
        input.autocomplete = 'off'; input.enterKeyHint = 'go';
        const go = el('ws-gmenu-unlock', engineString('s_4ac709aa58bc'), 'button') as HTMLButtonElement; go.type = 'button';
        const note = el('ws-gmenu-note', engineString('s_0a5f05def8ad'));
        const tryUnlock = async (): Promise<void> => {
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
      listenTap(scope, sw, () => { setQuickNote(!quickNote()); });
      const lock = el('ws-gmenu-unlock', engineString('s_db44b8db4f05'), 'button') as HTMLButtonElement; lock.type = 'button';
      listenTap(scope, lock, () => { lockReview(); });
      const row = el('ws-gmenu-row', engineString('s_b39f8f67f676'));
      row.append(lock);
      box.append(sw, row, el('ws-gmenu-note', engineString('s_806c6e56a7d8')));
      if (openFeedback !== undefined) {
        // SR13: Feedback is a System row while the inbox is unlocked, not a second tab bar over the five tabs
        const feedback = el('ws-gmenu-row'); feedback.dataset['setting'] = 'feedback';
        const label = el('ws-gmenu-swlabel', '', 'span'); label.textContent = engineString('s_st_feedback');
        const open = el('ws-gmenu-unlock', '', 'button') as HTMLButtonElement; open.type = 'button'; open.textContent = engineString('s_st_feedback_open');
        listenTap(scope, open, openFeedback);
        feedback.append(label, open); box.append(feedback);
      }
    };
    render(); onReview(render);
    return box;
  }
