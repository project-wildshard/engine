// STAGING-BUGBASH SB42: a proof pass for the rooms door, so a lane's staging and local proofs draw on their own budget instead of
// the per-address one every page at home shares (our agents and Jake's phone; src/server/host/dedicated/ticket.ts `passOf`).
// Signed with the player-ticket key the door already pins (~/.config/wildshard/player-ticket-signing-key.pem, MacBook only), as
// `pass:<lane>.<expires>.<signature>`, twelve hours long. It moves sockets to the lane's budget and nothing else.
//
//   node src/scripts/door-pass.mjs --check [--lane <name>]   says whether a pass can be minted here, and for how long; never prints it
//   import { doorPass, doorPassInit } from './door-pass.mjs'   doorPass(lane) → the pass, or null with no key on this machine;
//   doorPassInit(lane) → an init script that sets the page's `__wildshardDoorPass` (webSocketTransport.ts offers it as a subprotocol)
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_FILE = join(homedir(), '.config', 'wildshard', 'player-ticket-signing-key.pem');
const HOURS = 12;

/** A lane name the door reads (`[a-z0-9-]`, 40 at most). */
/** @param {string} name */
export function passLane(name) { return (name.toLowerCase().replaceAll(/[^a-z0-9-]+/gu, '-').replace(/^-+/u, '') || 'proof').slice(0, 40); }

/** A door pass for `lane`, or null when this machine has no signing key.
 * @param {string} [lane] @param {{ keyFile?: string, nowMs?: number }} [options] @returns {string | null} */
export function doorPass(lane = process.env.WS_LANE_NAME ?? 'proof', { keyFile = KEY_FILE, nowMs = Date.now() } = {}) {
  if (!existsSync(keyFile)) return null;
  const body = `pass:${passLane(lane)}.${String(Math.floor(nowMs / 1000) + HOURS * 3600)}`;
  return `${body}.${sign(null, Buffer.from(body), createPrivateKey(readFileSync(keyFile))).toString('hex')}`;
}

/** An init script that gives each page the pass (`__wildshardDoorPass`), for `context.addInitScript`; null with no pass.
 * @param {string} [lane] @returns {{ content: string } | null} */
export function doorPassInit(lane) {
  const pass = doorPass(lane);
  return pass === null ? null : { content: `globalThis.__wildshardDoorPass = ${JSON.stringify(pass)};` };
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const at = process.argv.indexOf('--lane'), lane = at === -1 ? undefined : process.argv[at + 1];
  const pass = doorPass(lane);
  console.log(pass === null ? `door-pass: no signing key at ${KEY_FILE}; proofs use the address budget` : `door-pass: ok, lane ${passLane(lane ?? process.env.WS_LANE_NAME ?? 'proof')}, ${String(HOURS)} h`);
}
