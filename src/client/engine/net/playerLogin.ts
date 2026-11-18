// MMO-PLAN MP2.2e1 (MP2.2, J213): the page's side of player sign-in, against api-server's player routes
// (`POST /api/login/email`, `/api/login/email/redeem`, `/api/login/passkey{,/options}`, `/api/players/passkeys{,/options}`,
// `/api/players/ticket`). A sign-in leaves a 30-day session in the page's storage; while it holds, the page keeps an hour's join
// ticket for this device and sends it as the hello's `player`, so the door seats the account (`server/host/dedicated/ticket.ts`).
// Without a session, or once the ticket is near its end, the hello names the device, as a guest's always has. Passkeys use the
// browser's WebAuthn JSON helpers (`parseCreationOptionsFromJSON`, `toJSON`); a browser without them is offered no passkey.
import type { NetIdentity } from '@wildshard/engine/net/identity';
import { apiOrigin } from '../core/apiOrigin';

/** What the sign-in client reads and writes: the API's origin ('' for the page's own), its fetch, the page's storage and clock. */
export interface LoginPorts {
  readonly api: string;
  readonly fetch: typeof fetch;
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readonly now: () => number;
  /** FM8b mode 27: hears the API end this page's session (a 401 on a ticket ask, which signs the page out). */
  readonly ended?: () => void;
}
/** Who is signed in on this page. */
export interface SignedIn { readonly session: string; readonly email: string }
/** How a link request went: sent, refused for too many asks, mail off on this API, the API down (FM8b mode 29: it answered 500,
 *  502, 503 or 504, other than its own "mail is off"), or anything else (no answer, a refused address). */
export type LinkSent = 'sent' | 'busy' | 'off' | 'down' | 'failed';
/** FM8b modes 28 and 29: how spending a mailed link went. `refused`: the API said the link isn't valid (spent, run out, unknown);
 *  `down`: it answered a 5xx, with that status; `failed`: no answer at all. Never a guess past the status the page got. */
export type LinkSpent = { readonly kind: 'in'; readonly who: SignedIn } | { readonly kind: 'refused' } | { readonly kind: 'down'; readonly status: number } | { readonly kind: 'failed' };
/** FM8b mode 29: an account request the API answered with a server error (never a network failure, which says nothing of the API). */
export const apiDown = (status: number): boolean => status === 500 || status === 502 || status === 503 || status === 504;

const SESSION_KEY = 'wildshard.player.session', TICKET_KEY = 'wildshard.player.ticket';
/** A ticket is used while it has this long left: a join in its last minutes would outlive it. */
const TICKET_SPARE_MS = 300_000;
const TICKET = /^ticket:[0-9a-f]{32}\.(?<device>device:[A-Za-z0-9-]{1,64})\.(?<expires>[0-9]{1,12})\.[0-9a-f]{128}$/u;
const LINK = /(?:^#|&)login=(?<token>wsl_[A-Za-z0-9_-]{8,128})(?:&|$)/u;

function read(ports: LoginPorts, key: string): string | null {
  try { return ports.storage.getItem(key); } catch { return null; }
}
function write(ports: LoginPorts, key: string, value: string | undefined): void {
  try { if (value === undefined) ports.storage.removeItem(key); else ports.storage.setItem(key, value); } catch { /* a page without storage stays a guest */ }
}

interface Asking { readonly session?: string; readonly signal?: AbortSignal }
async function post(ports: LoginPorts, route: string, body: unknown, asking: Asking = {}): Promise<Response | undefined> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (asking.session !== undefined) headers['authorization'] = `Bearer ${asking.session}`;
  const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body), ...(asking.signal === undefined ? {} : { signal: asking.signal }) };
  try { return await ports.fetch(`${ports.api}${route}`, init); } catch { return undefined; }
}
async function json(response: Response | undefined): Promise<Record<string, unknown> | undefined> {
  if (response?.ok !== true) return undefined;
  try { const body: unknown = await response.json(); return typeof body === 'object' && body !== null ? body as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** Who is signed in here, or undefined. */
export function signedIn(ports: LoginPorts): SignedIn | undefined {
  try {
    const held: unknown = JSON.parse(read(ports, SESSION_KEY) ?? 'null');
    if (typeof held !== 'object' || held === null) return undefined;
    const { session, email } = held as Record<string, unknown>;
    return typeof session === 'string' && typeof email === 'string' ? { session, email } : undefined;
  } catch { return undefined; }
}
/** Forget the session and its ticket: the page plays as this device's guest again. */
export function signOut(ports: LoginPorts): void { write(ports, SESSION_KEY, undefined); write(ports, TICKET_KEY, undefined); }

/** A signed-in answer (a redeemed link, a passkey) kept as this page's session. */
async function keep(ports: LoginPorts, response: Response | undefined): Promise<SignedIn | undefined> {
  const body = await json(response), player = body?.['player'];
  const email = typeof player === 'object' && player !== null ? (player as Record<string, unknown>)['email'] : undefined;
  if (typeof body?.['session'] !== 'string' || typeof email !== 'string') return undefined;
  const kept: SignedIn = { session: body['session'], email };
  write(ports, SESSION_KEY, JSON.stringify(kept)); write(ports, TICKET_KEY, undefined);
  return kept;
}

/** What a link request got: how it went, and the API's status when it answered a server error (FM8b's card names it). */
export interface LinkAsked { readonly said: LinkSent; readonly status?: number }
/** Ask for a sign-in link mailed to `email`, coming back to `game` (the page's origin). */
export async function askForLink(ports: LoginPorts, email: string, game: string): Promise<LinkAsked> {
  const response = await post(ports, '/api/login/email', { email, game });
  if (response === undefined) return { said: 'failed' };
  if (response.status === 202) return { said: 'sent' };
  if (response.status === 429) return { said: 'busy' };
  // api-server's 503 for a deployment with no mailer says so in its body; any other 5xx is the API itself failing
  if (response.status === 503) {
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    if (typeof body === 'object' && body !== null && (body as Record<string, unknown>)['error'] === 'sign-in mail is off') return { said: 'off' };
  }
  return apiDown(response.status) ? { said: 'down', status: response.status } : { said: 'failed' };
}
/** Ask for a sign-in link: how it went. */
export async function sendLink(ports: LoginPorts, email: string, game: string): Promise<LinkSent> { return (await askForLink(ports, email, game)).said; }
/** The link token in a page's hash (`#login=wsl_…`), or undefined. */
export function linkIn(hash: string): string | undefined { return LINK.exec(hash)?.groups?.['token']; }
/** Spend a mailed link's token: signed in, or why not (FM8b: the API's refusal, its server error, or no answer). */
export async function spendLink(ports: LoginPorts, token: string): Promise<LinkSpent> {
  const response = await post(ports, '/api/login/email/redeem', { token });
  if (response === undefined) return { kind: 'failed' };
  if (apiDown(response.status)) return { kind: 'down', status: response.status };
  const who = await keep(ports, response);
  return who !== undefined ? { kind: 'in', who } : response.status === 401 ? { kind: 'refused' } : { kind: 'failed' };
}
/** Spend a mailed link's token: the page is signed in, or undefined (used, expired, unknown). */
export async function redeemLink(ports: LoginPorts, token: string): Promise<SignedIn | undefined> {
  const spent = await spendLink(ports, token);
  return spent.kind === 'in' ? spent.who : undefined;
}

/** This device's held ticket while it has more than a few minutes left, or undefined. */
export function heldTicket(ports: LoginPorts, device: string): string | undefined {
  const ticket = read(ports, TICKET_KEY) ?? '', groups = TICKET.exec(ticket)?.groups;
  if (groups?.['device'] !== device || signedIn(ports) === undefined) return undefined;
  return Number(groups['expires']) * 1000 - TICKET_SPARE_MS > ports.now() ? ticket : undefined;
}
/** Fetch and keep a fresh ticket for `device` while signed in; a refused session signs the page out. */
export async function refreshTicket(ports: LoginPorts, device: string, signal?: AbortSignal): Promise<string | undefined> {
  const session = signedIn(ports)?.session;
  if (session === undefined) return undefined;
  const response = await post(ports, '/api/players/ticket', { device }, { session, ...(signal === undefined ? {} : { signal }) });
  // an answer for a session the page no longer holds (signed out, or in as someone else meanwhile) changes nothing
  if (signedIn(ports)?.session !== session) return undefined;
  // FM8b mode 27: the API's own verdict that the session ended; whoever listens (the world's card) hears it once it signs out
  if (response?.status === 401) { signOut(ports); ports.ended?.(); return undefined; }
  const ticket = (await json(response))?.['ticket'];
  if (typeof ticket !== 'string' || TICKET.exec(ticket)?.groups?.['device'] !== device) return undefined;
  write(ports, TICKET_KEY, ticket);
  return ticket;
}
/** A signed-in page in the world fetches a new ticket this often, so a redial an hour in still has a live one. */
export const TICKET_REFRESH_MS = 1_200_000;
/** A join waits this long for a fresh ticket: past it, or with the API down, the page joins as it is. */
const TICKET_WAIT_MS = 3000;
/** Before a join: a held ticket, else a fresh one if the API answers in time (joins never wait on an outage). */
export function ticketBeforeJoin(ports: LoginPorts, device: string): Promise<string | undefined> {
  const held = heldTicket(ports, device);
  return held !== undefined || signedIn(ports) === undefined ? Promise.resolve(held) : refreshTicket(ports, device, AbortSignal.timeout(TICKET_WAIT_MS));
}
/** This page's ports: the build's API origin, the page's fetch and clock, and `storage` (the save service's). */
export function pageLogin(storage: LoginPorts['storage']): LoginPorts {
  return { api: apiOrigin(), fetch: (input, init) => globalThis.fetch(input, init), storage, now: () => Date.now() };
}
/** The online identity with this page's ticket as its `player` while one is held, read at every hello (a redial included). */
export function ticketed(ports: LoginPorts, identity: NetIdentity): NetIdentity {
  return { get player(): string { return heldTicket(ports, identity.player) ?? identity.player; }, name: identity.name };
}

type JsonCredential = PublicKeyCredential & { toJSON?: () => unknown };
interface WebAuthnJson {
  parseCreationOptionsFromJSON?: (options: unknown) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (options: unknown) => PublicKeyCredentialRequestOptions;
}
const webAuthn = (): WebAuthnJson | undefined => (globalThis as { PublicKeyCredential?: WebAuthnJson }).PublicKeyCredential;
/** Whether this browser can do passkeys the way the card asks for them. */
export function passkeysHere(): boolean {
  const helpers = webAuthn();
  return typeof helpers?.parseRequestOptionsFromJSON === 'function' && typeof helpers.parseCreationOptionsFromJSON === 'function' && typeof navigator.credentials?.get === 'function';
}
const answer = (credential: Credential | null): unknown => (credential as JsonCredential | null)?.toJSON?.();

/** Sign in with a passkey this browser holds for the game. */
export async function passkeySignIn(ports: LoginPorts, game: string): Promise<SignedIn | undefined> {
  const options = await json(await post(ports, '/api/login/passkey/options', { game })), parse = webAuthn()?.parseRequestOptionsFromJSON;
  if (options === undefined || parse === undefined) return undefined;
  try {
    const response = answer(await navigator.credentials.get({ publicKey: parse(options) }));
    return response === undefined ? undefined : await keep(ports, await post(ports, '/api/login/passkey', { response }));
  } catch { return undefined; }
}
/** Add a passkey to the signed-in account; whether the API kept it. */
export async function addPasskey(ports: LoginPorts, game: string): Promise<boolean> {
  const session = signedIn(ports)?.session, parse = webAuthn()?.parseCreationOptionsFromJSON;
  if (session === undefined || parse === undefined) return false;
  const options = await json(await post(ports, '/api/players/passkeys/options', { game }, { session }));
  if (options === undefined) return false;
  try {
    const response = answer(await navigator.credentials.create({ publicKey: parse(options) }));
    return response !== undefined && (await post(ports, '/api/players/passkeys', { response }, { session }))?.status === 201;
  } catch { return false; }
}

// MMO-PLAN MP2.5c (delete and export): a signed-in player's own data lives in two places, the door's saves (engine
// `host/dedicated/accountRoutes.ts`) and the API's account (asked with the session). MP2.5e (review S3): the door takes only a
// five-minute confirm the API mints for the session on the tap (`/api/players/me/confirm`), never the join ticket hellos carry.
/** The door's HTTP origin beside its rooms socket (`wss://rooms…` → `https://rooms…`), or undefined. */
export function doorOf(socket: string): string | undefined {
  try {
    const url = new URL(socket);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return undefined;
    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
  } catch { return undefined; }
}
/** The door's own 404 (`accountRoutes.ts`), not a door without the routes. */
async function nothingSaved(response: Response): Promise<boolean> {
  try { const body: unknown = await response.json(); return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'nothing saved'; } catch { return false; }
}
const CONFIRM = /^confirm:[0-9a-f]{32}\.[0-9]{1,12}\.[0-9a-f]{128}$/u;
async function askDoor(ports: LoginPorts, door: string, route: string, session: string): Promise<Response | undefined> {
  const ticket = (await json(await post(ports, '/api/players/me/confirm', {}, { session })))?.['ticket'];
  if (typeof ticket !== 'string' || !CONFIRM.test(ticket)) return undefined;
  try { return await ports.fetch(`${door}${route}`, { method: 'POST', headers: { authorization: `Ticket ${ticket}` } }); } catch { return undefined; }
}
/** Both halves of the player's data for one file: `game` is null when the door has nothing (or no door). Undefined: the API refused. */
export async function exportMine(ports: LoginPorts, door: string | undefined): Promise<{ readonly api: unknown; readonly game: unknown } | undefined> {
  const session = signedIn(ports)?.session;
  if (session === undefined) return undefined;
  const api = await json(await post(ports, '/api/players/me/export', {}, { session }));
  if (api === undefined) return undefined;
  if (door === undefined) return { api, game: null };
  // only a 404 means the door holds nothing; any other failure would hand over a file missing the saves
  const asked = await askDoor(ports, door, '/account/export', session);
  if (asked?.status === 404 && await nothingSaved(asked)) return { api, game: null };
  const game = asked?.ok === true ? await json(asked) : undefined;
  return game === undefined ? undefined : { api, game };
}
/** How a delete went: everything gone and signed out, refused while the player is in the world, or stopped (nothing more deleted). */
export type Deleted = 'deleted' | 'playing' | 'failed' | 'saves-gone';
/** Delete the player's saves at the door, then the API account, then sign the page out. A build with no world has only the account. */
export async function deleteMine(ports: LoginPorts, door: string | undefined): Promise<Deleted> {
  const session = signedIn(ports)?.session;
  if (session === undefined) return 'failed';
  if (door !== undefined) {
    const saves = await askDoor(ports, door, '/account/delete', session);
    if (saves?.status === 409) return 'playing';
    if (saves?.ok !== true) return 'failed';
  }
  // the door's half went: a retry finishes it (the door answers deleted: false), and the card says so
  if ((await post(ports, '/api/players/me/delete', {}, { session }))?.ok !== true) return door === undefined ? 'failed' : 'saves-gone';
  signOut(ports);
  return 'deleted';
}
