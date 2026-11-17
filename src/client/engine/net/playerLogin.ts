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
}
/** Who is signed in on this page. */
export interface SignedIn { readonly session: string; readonly email: string }
/** How a link request went: sent, refused for too many asks, mail off on this API, or anything else. */
export type LinkSent = 'sent' | 'busy' | 'off' | 'failed';

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

/** Ask for a sign-in link mailed to `email`, coming back to `game` (the page's origin). */
export async function sendLink(ports: LoginPorts, email: string, game: string): Promise<LinkSent> {
  const response = await post(ports, '/api/login/email', { email, game });
  if (response === undefined) return 'failed';
  return response.status === 202 ? 'sent' : response.status === 429 ? 'busy' : response.status === 503 ? 'off' : 'failed';
}
/** The link token in a page's hash (`#login=wsl_…`), or undefined. */
export function linkIn(hash: string): string | undefined { return LINK.exec(hash)?.groups?.['token']; }
/** Spend a mailed link's token: the page is signed in, or undefined (used, expired, unknown). */
export async function redeemLink(ports: LoginPorts, token: string): Promise<SignedIn | undefined> {
  return keep(ports, await post(ports, '/api/login/email/redeem', { token }));
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
  if (response?.status === 401) { signOut(ports); return undefined; }
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
