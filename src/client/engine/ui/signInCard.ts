import type { Scope } from '../../../shared/engine/app/scope';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import { engineString } from '../../../shared/engine/strings';
import { addPasskey, askForLink, deleteMine, exportMine, linkIn, pageLogin, passkeySignIn, passkeysHere, signedIn, signOut, spendLink, type Deleted, type LinkSent, type LoginPorts } from '../net/playerLogin';
import { clearFailure, showFailure } from '../telemetry/runtime';
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
  /** FM8b modes 28 and 29: the card opens on why a mailed link didn't sign the page in (`takeLinkOutcome`). */
  readonly failure?: SignInFailure;
  /** FM8b mode 27: opened from the world's signed-out card, so it sits above the link's cards (their layer, just under errors). */
  readonly overWorld?: boolean;
}
/** FM8b: why sign-in didn't finish. `auth-failed` (28): the API refused the mailed link (spent, run out, unknown). `api-5xx` (29): the
 *  API answered a server error, with its status; `token` is the link to spend again on Try now (a link request just asks again). */
export type SignInFailure = { readonly kind: 'auth-failed' } | { readonly kind: 'api-5xx'; readonly status: number; readonly token?: string };

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

const SENT: Record<LinkSent, string> = { sent: 's_signin_sent', busy: 's_signin_busy', off: 's_signin_off', down: 's_signin_failed', failed: 's_signin_failed' } as const;
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

/** What spending a mailed link came to: the card's note ('' when it signed the page in) and, when it didn't, why (FM8b). */
export interface LinkTaken { readonly note: string; readonly failure?: SignInFailure }
/**
 * Spend a mailed link: the token the login door kept, or a `#login=…` still in the address (a page from before the door), taken
 * off it first so a reload never spends it twice. Undefined: no link. Else the card's note ('' when it signed the page in: the card's
 * who line says who, MP2.2g's "Signed in as" once) and, FM8b, why it didn't: the API refused the link, or answered a server error.
 */
export async function takeLinkOutcome(ports: LoginPorts, page: Pick<Location, 'hash' | 'pathname' | 'search'> = location, replace: (url: string) => void = url => { history.replaceState(history.state, '', url); }, hold: LinkHold = sessionLinkHold): Promise<LinkTaken | undefined> {
  const inAddress = linkIn(page.hash);
  if (inAddress !== undefined) {
    const hash = page.hash.replace(/(?:^#|&)login=[^&]*/u, '').replace(/^&/u, '#');
    replace(`${page.pathname}${page.search}${hash === '#' ? '' : hash}`);
  }
  const token = hold.take() ?? inAddress;
  if (token === undefined) return undefined;
  const spent = await spendLink(ports, token);
  if (spent.kind === 'in') return { note: '' };
  if (spent.kind === 'refused') return { note: '', failure: { kind: 'auth-failed' } };
  if (spent.kind === 'down') return { note: '', failure: { kind: 'api-5xx', status: spent.status, token } };
  return { note: engineString('s_signin_link_used') };
}
/** `takeLinkOutcome`'s note alone. */
export async function takeLink(ports: LoginPorts, page: Pick<Location, 'hash' | 'pathname' | 'search'> = location, replace: (url: string) => void = url => { history.replaceState(history.state, '', url); }, hold: LinkHold = sessionLinkHold): Promise<string | undefined> {
  const taken = await takeLinkOutcome(ports, page, replace, hold);
  return taken === undefined ? undefined : taken.failure?.kind === 'auth-failed' ? engineString('s_signin_link_used') : taken.note;
}

/** FM8b: the card's failure box and how it is filled. */
interface FailBox {
  readonly show: (failure: SignInFailure, actions: readonly { readonly label: string; readonly act: () => void }[]) => void;
  readonly hide: () => void;
}
function failBox(own: Scope, root: HTMLElement): FailBox {
  const tag = make('span', 'ws-signin-fail-tag'), title = make('h3', 'ws-signin-fail-title'), body = make('p', 'ws-signin-fail-body'), actions = make('div', 'ws-signin-fail-actions');
  // the status the page got is a fact for Details, never primary copy (a player reads words, J229)
  const details = make('details', 'ws-signin-fail-details'), detail = make('p', 'ws-signin-fail-detail');
  details.append(make('summary', '', engineString('s_signin_fail_details')), detail);
  root.hidden = true; root.setAttribute('role', 'alert'); root.append(tag, title, body, actions, details);
  let shown = false;
  const hide = (): void => { if (shown) clearFailure(root, 'recovered'); shown = false; root.hidden = true; delete root.dataset['failmode']; };
  return {
    hide,
    show: (failure, buttons) => {
      if (shown) clearFailure(root, 'replaced');
      root.dataset['failmode'] = failure.kind; root.dataset['tone'] = 'warn';
      if (failure.kind === 'auth-failed') {
        tag.textContent = engineString('s_signin_fail_auth_tag'); title.textContent = engineString('s_signin_fail_auth_title');
        body.textContent = engineString('s_signin_fail_auth_body'); detail.textContent = engineString('s_signin_fail_auth_detail');
      } else {
        tag.textContent = engineString('s_signin_fail_api_tag'); title.textContent = engineString('s_signin_fail_api_title');
        body.textContent = engineString('s_signin_fail_api_body'); detail.textContent = engineString('s_signin_fail_api_detail', [failure.status]);
      }
      actions.replaceChildren(...buttons.map(({ label, act }, index) => {
        const node = button(index === 0 ? 'ws-signin-send' : 'ws-signin-alt', label, `fail-${String(index)}`);
        own.listen(node, 'click', act);
        return node;
      }));
      root.hidden = false; shown = true; showFailure(own, root, failure.kind);
    },
  };
}

function signedOutRows(own: Scope, ports: LoginPorts, say: (line: string) => void, done: () => void, fail: FailBox, close: () => void): HTMLElement[] {
  const form = make('form', 'ws-signin-form'), email = make('input', 'ws-signin-email'), send = make('button', 'ws-signin-send', engineString('s_signin_send'));
  form.noValidate = true; email.type = 'email'; email.required = true; email.setAttribute('autocomplete', 'email'); email.setAttribute('aria-label', engineString('s_signin_email'));
  email.placeholder = engineString('s_signin_email'); email.enterKeyHint = 'send'; send.type = 'submit'; send.dataset['signin'] = 'send';
  form.append(email, send);
  const mail = async (): Promise<void> => {
    send.disabled = true;
    const asked = await askForLink(ports, email.value.trim(), game());
    send.disabled = false;
    // FM8b mode 29: the API's own server error, named, with Try now (the player's own tap asks again) and the guest way out
    if (asked.said === 'down') { say(''); fail.show({ kind: 'api-5xx', status: asked.status ?? 503 }, [{ label: engineString('s_signin_fail_try'), act: () => { void mail(); } }, { label: engineString('s_signin_fail_guest'), act: close }]); return; }
    fail.hide(); say(engineString(SENT[asked.said] as 's_signin_sent'));
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
  const close = button('ws-signin-close', engineString('s_signin_close'), 'close'), failRoot = make('div', 'ws-signin-fail'), fail = failBox(own, failRoot);
  box.id = 'ws-signin'; box.setAttribute('role', 'dialog');
  // a literal: calc() takes z-index through a float, which at this size lands below the link cards (opus-fm2 saw 2147479950)
  if (options.overWorld === true) box.style.zIndex = '2147482450'; box.setAttribute('aria-modal', 'true'); note.setAttribute('role', 'status');
  card.append(make('h2', 'ws-signin-title', engineString('s_signin_title')), make('p', 'ws-signin-why', engineString('s_signin_why')), failRoot, body, note, close);
  box.append(card);
  const say = (line: string): void => { note.textContent = line; note.hidden = line === ''; };
  const draw = (): void => {
    const rows = signedIn(ports) === undefined ? signedOutRows(own, ports, say, changed, fail, () => { own.dispose(); }) : signedInRows(own, ports, say, changed, options.account);
    body.replaceChildren(...rows); box.dataset['signedIn'] = String(signedIn(ports) !== undefined);
  };
  function changed(line = ''): void { fail.hide(); say(line); draw(); options.changed?.(); }
  say(options.note ?? ''); draw();
  // FM8b: a mailed link the API refused (28) or couldn't take (29) opens the card on why; the email form stays below it
  const emailField = (): void => { fail.hide(); body.querySelector<HTMLInputElement>('.ws-signin-email')?.focus(); };
  const opened = options.failure;
  if (opened?.kind === 'auth-failed') fail.show(opened, [{ label: engineString('s_signin_fail_new_link'), act: emailField }, { label: engineString('s_signin_fail_guest'), act: () => { own.dispose(); } }]);
  else if (opened?.kind === 'api-5xx') {
    const token = opened.token;
    const again = async (): Promise<void> => {
      if (token === undefined) { emailField(); return; }
      const spent = await spendLink(ports, token);
      if (spent.kind === 'in') changed();
      else if (spent.kind === 'down') fail.show({ kind: 'api-5xx', status: spent.status, token }, [{ label: engineString('s_signin_fail_try'), act: () => { void again(); } }, { label: engineString('s_signin_fail_guest'), act: () => { own.dispose(); } }]);
      else fail.show({ kind: 'auth-failed' }, [{ label: engineString('s_signin_fail_new_link'), act: emailField }, { label: engineString('s_signin_fail_guest'), act: () => { own.dispose(); } }]);
    };
    fail.show(opened, [{ label: engineString('s_signin_fail_try'), act: () => { void again(); } }, { label: engineString('s_signin_fail_guest'), act: () => { own.dispose(); } }]);
  }
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
