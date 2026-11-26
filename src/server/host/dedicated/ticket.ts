// MMO-PLAN MP2.2c (MP2.1, J69, J171): who a hello seats. A signed-in page sends the api-server's join ticket as its `player`
// (api-server `src/server/signing/player-ticket.ts`), and the door checks it here, offline, against the pinned public key: no join
// asks the api-server, so joins survive its outage. A live ticket seats `account:plr_<player>`, the same on every device, so a phone
// and a desktop reach one player. A ticket this key didn't sign plays as the device it names, as that device's guest would. FM7b3c
// (meta MMO-FAILURE-MODES-PLAN mode 27): one this key signed that has run out by the door's clock is `expired`, which the door refuses
// with the `auth-expired` close fact rather than playing the account's page as a guest. A plain device id is itself; nobody names an
// account directly, or sends a ticket that doesn't parse.
// Format: `ticket:<player>.<device>.<expires>.<signature>`, the player id's 32 hex, the device id, Unix seconds, and 128 hex of
// Ed25519 over everything before the last dot. The wire caps hello text at 255 bytes; the longest ticket is 251.

/** The api-server's ticket key (`~/.config/wildshard/player-ticket-signing-key.pub.pem`), SPKI DER in hex. */
export const PLAYER_TICKET_PUBLIC_KEY = '302a300506032b657003210062d6fe4908c19b31d934a1293b4fb1327a531fbc19e8a6d30cebbb174a7fa70c';

/** Who a hello seats, and the device a live ticket came from (whose guest progress the account may claim, MP2.2d). `expired`
 *  (FM7b3c): the ticket was this key's but has run out, the authority's own verdict; its seat is only the device it names. */
export interface Admission { readonly seat: string; readonly from?: string; readonly expired?: true }

/** A ticket, whole; `NetIdentitySchema` takes the same shape. */
const TICKET = /^(?<signed>ticket:(?<player>[0-9a-f]{32})\.(?<device>device:[A-Za-z0-9-]{1,64})\.(?<expires>[0-9]{1,12}))\.(?<signature>[0-9a-f]{128})$/u;
const keys = new Map<string, Promise<CryptoKey | undefined>>();
const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => Uint8Array.from(hex.match(/../gu) ?? [], pair => Number.parseInt(pair, 16));

function keyOf(spkiHex: string): Promise<CryptoKey | undefined> {
  let key = keys.get(spkiHex);
  if (key === undefined) {
    key = crypto.subtle.importKey('spki', hexBytes(spkiHex), { name: 'Ed25519' }, false, ['verify']).then(made => made, () => undefined);
    keys.set(spkiHex, key);
  }
  return key;
}

/** Whether the pinned key signed this text. */
async function signed(text: string, signature: string, spkiHex: string | undefined): Promise<boolean> {
  const key = spkiHex === undefined ? undefined : await keyOf(spkiHex);
  if (key === undefined) return false;
  try { return await crypto.subtle.verify({ name: 'Ed25519' }, key, hexBytes(signature), new TextEncoder().encode(text)); } catch { return false; }
}

/**
 * Who a hello's `player` seats: `account:plr_<player>` for a live ticket under `spkiHex` (with the device it came from), else the
 * device the ticket names; a plain id is itself. Undefined refuses the hello: an id that names an account, or a broken ticket.
 */
export async function admit(player: string, spkiHex: string | undefined, nowMs: number): Promise<Admission | undefined> {
  const groups = TICKET.exec(player)?.groups;
  // a deleted or expired player's anonymous ledger (`deleted:`, MP2.5f/g) is nobody's to play as
  if (groups === undefined) return ['account:', 'ticket:', 'confirm:', 'deleted:'].some(kind => player.startsWith(kind)) ? undefined : { seat: player };
  const { signed: text = '', player: id = '', device = '', expires = '0', signature = '' } = groups;
  // a ticket no key here signed says nothing of any account, run out or not
  if (!await signed(text, signature, spkiHex)) return { seat: device };
  return Number(expires) * 1000 > nowMs ? { seat: `account:plr_${id}`, from: device } : { seat: device, expired: true };
}

/** Just the seat (`admit`'s). */
export async function seatOf(player: string, spkiHex: string | undefined, nowMs: number): Promise<string | undefined> {
  return (await admit(player, spkiHex, nowMs))?.seat;
}

// MMO-PLAN MP2.5e (review S3): the door's account routes (`accountRoutes.ts`) take a confirm, never a join ticket. The api-server
// mints one only for a live session (`POST /api/players/me/confirm`), five minutes long: `confirm:<player>.<expires>.<signature>`,
// signed by the same key over everything before the last dot. Its own prefix keeps it out of joins (`admit` refuses it) and keeps
// a join ticket, which every hello carries for an hour, from passing as one.
const CONFIRM = /^(?<signed>confirm:(?<player>[0-9a-f]{32})\.(?<expires>[0-9]{1,12}))\.(?<signature>[0-9a-f]{128})$/u;
/** A confirm reaching further ahead than this is refused, whoever signed it: the API mints five minutes. */
const CONFIRM_MAX_MS = 600_000;

/** The account a live confirm under `spkiHex` names, or undefined (a join ticket, expired, too long, unsigned). */
export async function confirmed(text: string, spkiHex: string | undefined, nowMs: number): Promise<string | undefined> {
  const groups = CONFIRM.exec(text)?.groups;
  if (groups === undefined) return undefined;
  const { signed: body = '', player: id = '', expires = '0', signature = '' } = groups;
  const expiresMs = Number(expires) * 1000;
  if (expiresMs <= nowMs || expiresMs - nowMs > CONFIRM_MAX_MS) return undefined;
  return await signed(body, signature, spkiHex) ? `account:plr_${id}` : undefined;
}

// STAGING-BUGBASH SB42: our own proofs share one home address with Jake's phone, and the door's per-address budget (E7.7) let them
// starve each other. A proof pass names a lane and rides the socket as a subprotocol (`wspass.…`, world.ts): `pass:<lane>.<expires>.<signature>`,
// signed by the same key over everything before the last dot (`src/scripts/door-pass.mjs` mints one on the MacBook). It moves that
// socket to the pass's own budget and nothing else: it seats nobody, and every hello is still admitted as before.
const PASS = /^(?<signed>pass:(?<lane>[a-z0-9][a-z0-9-]{0,39})\.(?<expires>[0-9]{1,12}))\.(?<signature>[0-9a-f]{128})$/u;
/** A pass reaching further ahead than this is refused, whoever signed it: the script mints twelve hours. */
export const PASS_MAX_MS: number = 24 * 3600 * 1000;

/** The lane a live proof pass under `spkiHex` names, and when it expires; undefined otherwise (expired, too long, unsigned, a ticket). */
export async function passOf(text: string, spkiHex: string | undefined, nowMs: number): Promise<{ readonly lane: string; readonly expiresMs: number } | undefined> {
  const groups = PASS.exec(text)?.groups;
  if (groups === undefined) return undefined;
  const { signed: body = '', lane = '', expires = '0', signature = '' } = groups;
  const expiresMs = Number(expires) * 1000;
  if (expiresMs <= nowMs || expiresMs - nowMs > PASS_MAX_MS) return undefined;
  return await signed(body, signature, spkiHex) ? { lane, expiresMs } : undefined;
}
