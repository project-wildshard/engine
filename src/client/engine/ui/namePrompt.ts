import type { Scope } from '../../../shared/engine/app/scope';
import { installedIdentity } from '../../../shared/engine/app/identity';
import { cleanName, nameRefusal } from '../../../shared/engine/net/chatFilter';
import { deviceIdentity, GUEST, heldName, MAX_NAME_LENGTH } from '../../../shared/engine/net/identity';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import type { SaveStorage } from '../../../shared/engine/saves/store';
import { engineString } from '../../../shared/engine/strings';
import { jsonSlot } from '../saves/slots';
import { followsTap, listenTap } from '../input/dom';
import './styles/namePrompt.css';

/**
 * MMO-PLAN MP2.4, the Name prompt (Jake, 2026-11-11: "Ask the user for their name and what they should be called after they hit
 * play but before we pop them into the world"). Once per device, between PLAY and the world: one field, Let's go and Skip.
 *
 *   await askNameOnce(scope)   // the title's PLAY (mainMenu.ts), and the online page that came in without it (clientWorker.ts)
 *
 * The Name goes with the device id (net/identity.ts) and rides `hello`; the server cleans it by the same rule the prompt checks
 * (chatFilter.ts `nameRefusal` / `cleanName`) and adds the `#tag`. Skip keeps the Name the device has (Guest at first). Either
 * answer marks the device, so later PLAYs go straight in; Settings ▸ System ▸ Name changes it any time (`nameSettingRows`).
 * The form keeps E7's `#ws-name-box` / `input` / `button[type=submit]` shape, which every online proof script drives.
 */

const asked = jsonSlot('nameAsked', 'device');
/** Whether this device still has to be asked (false when storage is blocked: no prompt that comes back every PLAY). */
export function nameAskDue(): boolean { try { return asked.read() !== true; } catch { return false; } }
/** The device has answered (a Name or Skip). */
export function markNameAsked(): void { try { asked.write(true); } catch { /* storage blocked: nothing to keep */ } }

const keep = (): { storage: SaveStorage; prefix: string } | null => {
  // the page's own storage, where the device id lives (clientWorker.ts hands the same store to the join)
  const storage = saveEnvironment().storage('global'), app = installedIdentity();
  return storage === null || app === null ? null : { storage, prefix: app.savePrefix };
};
/** The Name this device goes by, or '' while it has none of its own (Guest). */
export function savedName(): string {
  const at = keep(), held = at === null ? null : heldName(at.storage, at.prefix);
  return held === null || held === GUEST.name ? '' : held;
}
/** Keep `name` (already passed `nameRefusal`) with this device's id; the next join sends it. False when storage refused it. */
export function saveName(name: string): boolean {
  const at = keep();
  if (at === null) return false;
  try { deviceIdentity(at.storage, at.prefix, cleanName(name)); return true; } catch { return false; }
}

/** The friendly line for what the server would refuse, or '' when the Name passes. */
export function nameProblem(typed: string): string {
  const why = nameRefusal(typed);
  return why === null ? '' : engineString(why === 'empty' ? 's_name_empty' : 's_name_word');
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = cls; if (text !== '') node.textContent = text; return node;
};
const field = (current: string): HTMLInputElement => {
  const input = make('input', 'ws-name-field');
  input.type = 'text'; input.value = current; input.maxLength = MAX_NAME_LENGTH; input.setAttribute('autocomplete', 'nickname'); input.spellcheck = false;
  input.setAttribute('autocapitalize', 'words'); input.setAttribute('autocorrect', 'off'); input.enterKeyHint = 'go';
  return input;
};

/** Options for the prompt: the Name to show in the field, and the online page's way into the Connection doctor. */
export interface NamePromptOptions {
  /** where it mounts: over everything the page shows (the title, or the loading card), so the page's top, not a HUD band */
  readonly parent: HTMLElement;
  readonly current?: string; readonly doctor?: () => void;
}

/**
 * Show the prompt. Resolves the Name typed (cleaned), null for Skip, or undefined when `scope` closed it first. The card sits in
 * the visible part of the page (`visualViewport`), so a phone's keyboard never covers the field or the buttons.
 */
export function showNamePrompt(scope: Scope, options: NamePromptOptions): Promise<string | null | undefined> {
  const own = scope.child('name-prompt');
  const box = make('form', 'ws-name'), card = make('div', 'ws-name-card'), input = field(options.current ?? '');
  const error = make('p', 'ws-name-error'), go = make('button', 'ws-name-go', engineString('s_name_go')), skip = make('button', 'ws-name-skip', engineString('s_name_skip'));
  box.id = 'ws-name-box'; box.noValidate = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  const label = make('label', 'ws-name-ask', engineString('s_name_ask')); label.htmlFor = input.id = 'ws-name-field';
  error.setAttribute('role', 'alert'); error.hidden = true;
  go.type = 'submit'; skip.type = 'button'; skip.dataset['name'] = 'skip';
  const row = make('div', 'ws-name-row'); row.append(skip, go);
  card.append(label, input, error, row, make('p', 'ws-name-later', engineString('s_name_later')));
  if (options.doctor !== undefined) {
    const { doctor } = options, check = make('button', 'ws-name-check', engineString('s_name_check'));
    check.type = 'button'; check.dataset['doctor'] = 'open';
    own.listen(check, 'click', () => { check.disabled = true; doctor(); });
    card.append(check);
  }
  box.append(card);
  // the visible part of the page: a phone's keyboard shrinks it, and the card stays centred in what is left
  const view = globalThis.visualViewport;
  const fit = (): void => { if (view === null || view === undefined) return; box.style.top = `${String(view.offsetTop)}px`; box.style.height = `${String(view.height)}px`; };
  if (view !== null && view !== undefined) { own.listen(view, 'resize', fit); own.listen(view, 'scroll', fit); fit(); }
  own.ownNode(box); options.parent.append(box);
  input.focus({ preventScroll: true });
  return new Promise(resolve => {
    let settled = false;
    const end = (answer: string | null | undefined): void => { if (settled) return; settled = true; resolve(answer); own.dispose(); };
    own.onDispose(() => { box.remove(); end(undefined); });
    own.listen(input, 'input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
    own.listen(box, 'submit', event => {
      event.preventDefault();
      const problem = nameProblem(input.value);
      if (problem !== '') { error.textContent = problem; error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus({ preventScroll: true }); return; }
      end(cleanName(input.value));
    });
    // the PLAY tap that opened it was answered on its pointerup: iOS's synthesized click that follows it is not an answer here
    listenTap(own, skip, () => { end(null); });
    own.listen(go, 'click', event => { if (followsTap(event)) event.preventDefault(); }, { capture: true });
  });
}

/** PLAY's step: ask once per device and keep the answer. Resolves true once the device has answered (or never needed to). */
export async function askNameOnce(scope: Scope, options: Omit<NamePromptOptions, 'current'>): Promise<boolean> {
  if (!nameAskDue()) return true;
  const answer = await showNamePrompt(scope, { ...options, current: savedName() });
  if (answer === undefined) return false;
  if (answer !== null) saveName(answer); // a full storage still goes on: the join sends the device's Name
  markNameAsked();
  return true;
}

/** Settings ▸ System ▸ Name: the field, Save, and one line for a refusal or the saved Name. */
export function nameSettingRows(scope: Scope): HTMLElement[] {
  const row = make('form', 'ws-gmenu-row ws-name-setting'), input = field(savedName()), save = make('button', 'ws-name-save', engineString('s_name_save'));
  const note = make('div', 'ws-gmenu-note ws-name-note');
  row.noValidate = true; input.setAttribute('aria-label', engineString('s_st_g_name')); save.type = 'submit'; note.hidden = true;
  row.append(input, save);
  scope.listen(input, 'input', () => { note.hidden = true; });
  scope.listen(row, 'submit', event => {
    event.preventDefault();
    const problem = nameProblem(input.value);
    if (problem === '') { saveName(input.value); markNameAsked(); input.value = savedName(); }
    note.textContent = problem === '' ? engineString('s_name_saved') : problem; note.dataset['tone'] = problem === '' ? 'ok' : 'refused'; note.hidden = false;
  });
  return [row, note];
}
