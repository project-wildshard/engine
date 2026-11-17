import type { Scope } from '../../../shared/engine/app/scope';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import { engineString } from '../../../shared/engine/strings';
import { addPasskey, deleteMine, exportMine, linkIn, pageLogin, passkeySignIn, passkeysHere, redeemLink, sendLink, signedIn, signOut, type Deleted, type LinkSent, type LoginPorts } from '../net/playerLogin';
import { installViewport } from '../core/viewport';
import { followsTap, listenPage } from '../input/dom';
import './styles/signInCard.css';

/**
 * MMO-PLAN MP2.2e2 (MP2.2, J213): the title's sign-in card. Signed out: an email field and Email me a link, and a passkey button
 * where the browser can do passkeys; Google and X sit behind their switches (`SIGN_IN_SWITCHES`), off until Jake's ids exist
 * (MP2.2f). Signed in: who, Add a passkey, Sign out. The mailed link comes back as `#login=wsl_…` on the game's page; index.html's
 * login door takes it off the address at boot (MP2.2g) and the title spends it (`takeLink`) and opens the card on its answer. A signed-in page joins as its account (`net/playerLogin.ts`).
 *
 *   openSignIn(scope, { parent: document.body, changed })   // the main menu's SIGN IN
 */

/** The providers that need Jake's ids (MP2.2f): off until they exist. */
export const SIGN_IN_SWITCHES: { readonly google: boolean; readonly x: boolean } = { google: false, x: false };

/** What the card mounts on, and who hears that the signed-in state changed (the menu's button label). */
export interface SignInOptions {
  readonly parent: HTMLElement;
  readonly changed?: () => void;
  /** A line to show as the card opens (a link that was spent, or refused). */
  readonly note?: string;
  /** Tests: the API and storage the card talks to. */
  readonly ports?: LoginPorts;
  /** MP2.5c: where the player's saves are (the world's door); without it the card offers no data rows. */
  readonly account?: AccountPorts;
}

/** MP2.5c: what Download my data and Delete account need beyond the API. */
export interface AccountPorts {
  /** The door's HTTP origin, or undefined on a build with no world. */
  readonly door: () => Promise<string | undefined>;
  /** Hand the viewer a file. */
  readonly save: (name: string, text: string) => void;
}
const DELETED: Record<Deleted, string> = { deleted: 's_signin_deleted', playing: 's_signin_delete_playing', failed: 's_signin_account_failed', 'saves-gone': 's_signin_delete_unfinished' } as const;
/** A file download from the page. */
export function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); // the URL stays until the page goes: revoking it at once can cancel the download
}

const SENT: Record<LinkSent, string> = { sent: 's_signin_sent', busy: 's_signin_busy', off: 's_signin_off', failed: 's_signin_failed' } as const;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = cls; if (text !== '') node.textContent = text; return node;
};
const button = (cls: string, text: string, action: string): HTMLButtonElement => {
  const node = make('button', cls, text); node.type = 'button'; node.dataset['signin'] = action; return node;
};
const game = (): string => location.origin;

/** This page's sign-in ports, on the save service's own storage (where the device id lives). */
export function titleLogin(): LoginPorts | undefined {
  const storage = saveEnvironment().storage('global');
  return storage === null ? undefined : pageLogin(storage);
}
/** Whether this page is signed in. */
export function titleSignedIn(): boolean { const ports = titleLogin(); return ports !== undefined && signedIn(ports) !== undefined; }

/** Where a mailed link's token waits once the boot took it off the address (index.html's login door). */
export interface LinkHold { readonly take: () => string | undefined }
const LINK_KEY = 'wildshard.player.link';
/** This tab's session storage, as the login door left it; each token is taken once. */
export const sessionLinkHold: LinkHold = {
  take: () => {
    try {
      // oxlint-disable-next-line wildshard/no-raw-save -- the tab-scoped key index.html's login door writes before any save service exists
      const token = sessionStorage.getItem(LINK_KEY) ?? undefined;
      // oxlint-disable-next-line wildshard/no-raw-save -- spent once: the key goes as it is read
      sessionStorage.removeItem(LINK_KEY);
      return token;
    } catch { return undefined; }
  },
};

/**
 * Spend a mailed link: the token the login door kept, or a `#login=…` still in the address (a page from before the door), taken
 * off it first so a reload never spends it twice. Undefined: no link. '' when it signed the page in (the card's who line says
 * who: MP2.2g's "Signed in as" once), else the line saying the link was used or expired.
 */
export async function takeLink(ports: LoginPorts, page: Pick<Location, 'hash' | 'pathname' | 'search'> = location, replace: (url: string) => void = url => { history.replaceState(history.state, '', url); }, hold: LinkHold = sessionLinkHold): Promise<string | undefined> {
  const inAddress = linkIn(page.hash);
  if (inAddress !== undefined) {
    const hash = page.hash.replace(/(?:^#|&)login=[^&]*/u, '').replace(/^&/u, '#');
    replace(`${page.pathname}${page.search}${hash === '#' ? '' : hash}`);
  }
  const token = hold.take() ?? inAddress;
  if (token === undefined) return undefined;
  const kept = await redeemLink(ports, token);
  return kept === undefined ? engineString('s_signin_link_used') : '';
}

function signedOutRows(own: Scope, ports: LoginPorts, say: (line: string) => void, done: () => void): HTMLElement[] {
  const form = make('form', 'ws-signin-form'), email = make('input', 'ws-signin-email'), send = make('button', 'ws-signin-send', engineString('s_signin_send'));
  form.noValidate = true; email.type = 'email'; email.required = true; email.setAttribute('autocomplete', 'email'); email.setAttribute('aria-label', engineString('s_signin_email'));
  email.placeholder = engineString('s_signin_email'); email.enterKeyHint = 'send'; send.type = 'submit'; send.dataset['signin'] = 'send';
  form.append(email, send);
  const mail = async (): Promise<void> => {
    send.disabled = true;
    const sent = await sendLink(ports, email.value.trim(), game());
    send.disabled = false; say(engineString(SENT[sent] as 's_signin_sent'));
  };
  own.listen(form, 'submit', event => { event.preventDefault(); void mail(); });
  const rows: HTMLElement[] = [form];
  if (passkeysHere()) {
    const passkey = button('ws-signin-alt', engineString('s_signin_passkey'), 'passkey');
    const tryPasskey = async (): Promise<void> => { if (await passkeySignIn(ports, game()) === undefined) say(engineString('s_signin_passkey_failed')); else done(); };
    own.listen(passkey, 'click', () => { void tryPasskey(); });
    rows.push(passkey);
  }
  if (SIGN_IN_SWITCHES.google) rows.push(button('ws-signin-alt', engineString('s_signin_google'), 'google'));
  if (SIGN_IN_SWITCHES.x) rows.push(button('ws-signin-alt', engineString('s_signin_x'), 'x'));
  return rows;
}

function signedInRows(own: Scope, ports: LoginPorts, say: (line: string) => void, done: (line?: string) => void, account?: AccountPorts): HTMLElement[] {
  const who = make('p', 'ws-signin-who', engineString('s_signin_as', [signedIn(ports)?.email ?? ''])), rows: HTMLElement[] = [who];
  if (passkeysHere()) {
    const add = button('ws-signin-alt', engineString('s_signin_add_passkey'), 'add-passkey');
    const adding = async (): Promise<void> => { say(engineString(await addPasskey(ports, game()) ? 's_signin_passkey_added' : 's_signin_passkey_failed')); };
    own.listen(add, 'click', () => { void adding(); });
    rows.push(add);
  }
  const out = button('ws-signin-alt', engineString('s_signin_out'), 'out');
  own.listen(out, 'click', () => { signOut(ports); done(); });
  rows.push(out);
  if (account !== undefined) rows.push(...accountRows(own, ports, account, say, done));
  return rows;
}

/** MP2.5c: Download my data (both halves, one file) and Delete account (two taps: door, API, signed out). */
function accountRows(own: Scope, ports: LoginPorts, account: AccountPorts, say: (line: string) => void, done: (line?: string) => void): HTMLElement[] {
  const download = button('ws-signin-alt', engineString('s_signin_export'), 'export'), remove = button('ws-signin-alt ws-signin-delete', engineString('s_signin_delete'), 'delete');
  const exporting = async (): Promise<void> => {
    download.disabled = true;
    // review M2: a door that can't be read (a bad release file, no network) says try again; the button never sticks
    const data = await account.door().then(door => exportMine(ports, door)).catch(() => undefined);
    download.disabled = false;
    if (data === undefined) { say(engineString('s_signin_account_failed')); return; }
    account.save(`wildshard-account-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
    say(engineString('s_signin_exported'));
  };
  let armed = false;
  const deleting = async (): Promise<void> => {
    if (!armed) { armed = true; remove.textContent = engineString('s_signin_delete_confirm'); return; }
    remove.disabled = true;
    const result = await account.door().then(door => deleteMine(ports, door)).catch((): Deleted => 'failed');
    remove.disabled = false; armed = false; remove.textContent = engineString('s_signin_delete');
    if (result === 'deleted') done(engineString(DELETED[result] as 's_signin_deleted'));
    else say(engineString(DELETED[result] as 's_signin_deleted'));
  };
  own.listen(download, 'click', () => { void exporting(); });
  own.listen(remove, 'click', () => { void deleting(); });
  return [download, remove];
}

/** Open the card. Resolves when it closes (Close, a tap outside, Esc, or `scope` ending). */
export function openSignIn(scope: Scope, options: SignInOptions): Promise<void> {
  const ports = options.ports ?? titleLogin();
  if (ports === undefined) return Promise.resolve();
  const own = scope.child('sign-in');
  const box = make('div', 'ws-signin'), card = make('div', 'ws-signin-card'), note = make('p', 'ws-signin-note'), body = make('div', 'ws-signin-body');
  const close = button('ws-signin-close', engineString('s_signin_close'), 'close');
  box.id = 'ws-signin'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); note.setAttribute('role', 'status');
  card.append(make('h2', 'ws-signin-title', engineString('s_signin_title')), make('p', 'ws-signin-why', engineString('s_signin_why')), body, note, close);
  box.append(card);
  const say = (line: string): void => { note.textContent = line; note.hidden = line === ''; };
  const draw = (): void => {
    const rows = signedIn(ports) === undefined ? signedOutRows(own, ports, say, changed) : signedInRows(own, ports, say, changed, options.account);
    body.replaceChildren(...rows); box.dataset['signedIn'] = String(signedIn(ports) !== undefined);
  };
  function changed(line = ''): void { say(line); draw(); options.changed?.(); }
  say(options.note ?? ''); draw();
  installViewport();
  own.ownNode(box); options.parent.append(box);
  return new Promise(resolve => {
    own.onDispose(() => { box.remove(); resolve(); });
    own.listen(close, 'click', () => { own.dispose(); });
    // The opening pointerup can put this backdrop (or a button) under the finger before iOS retargets its click.
    own.listen(box, 'click', event => {
      if (followsTap(event)) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.target === box) own.dispose();
    }, { capture: true });
    listenPage(own, 'keydown', event => { if (event.key === 'Escape') own.dispose(); });
  });
}
