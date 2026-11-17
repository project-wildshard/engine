// MMO-PLAN MP2.2c (MP2.1, J69, J171): who a hello seats. A signed-in page sends the api-server's join ticket as its `player`
// (api-server `src/server/signing/player-ticket.ts`), and the door checks it here, offline, against the pinned public key: no join
// asks the api-server, so joins survive its outage. A live ticket seats `account:plr_<player>`, the same on every device, so a phone
// and a desktop reach one player. A ticket this key didn't sign, or one past its expiry, plays as the device it names, as that
// device's guest would. A plain device id is itself; nobody names an account directly, or sends a ticket that doesn't parse.
// Format: `ticket:<player>.<device>.<expires>.<signature>`, the player id's 32 hex, the device id, Unix seconds, and 128 hex of
// Ed25519 over everything before the last dot. The wire caps hello text at 255 bytes; the longest ticket is 251.

/** The api-server's ticket key (`~/.config/wildshard/player-ticket-signing-key.pub.pem`), SPKI DER in hex. */
export const PLAYER_TICKET_PUBLIC_KEY = '302a300506032b657003210062d6fe4908c19b31d934a1293b4fb1327a531fbc19e8a6d30cebbb174a7fa70c';

/** Who a hello seats, and the device a live ticket came from (whose guest progress the account may claim, MP2.2d). */
export interface Admission { readonly seat: string; readonly from?: string }

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
  if (groups === undefined) return player.startsWith('account:') || player.startsWith('ticket:') ? undefined : { seat: player };
  const { signed: text = '', player: id = '', device = '', expires = '0', signature = '' } = groups;
  const live = Number(expires) * 1000 > nowMs && await signed(text, signature, spkiHex);
  return live ? { seat: `account:plr_${id}`, from: device } : { seat: device };
}

/** Just the seat (`admit`'s). */
export async function seatOf(player: string, spkiHex: string | undefined, nowMs: number): Promise<string | undefined> {
  return (await admit(player, spkiHex, nowMs))?.seat;
}
