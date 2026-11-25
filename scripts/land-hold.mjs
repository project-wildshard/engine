// Meta QA 11-25 row 37 (J505): an engine land HOLD in the receipts binds land.mjs and main-push.mjs. On 11-25 a lane
// landed during the 12:56 UTC HOLD because its wait matched LAND PUSHED lines, not HOLD lines; now the push refuses.
//
// The line format (meta tmp/coord/lane-rules.md, under the land queue):
//   HH:MM UTC <lane> NOTE HOLD engine: <why>; lander <lane>[, <lane>]   only the named landers push; none: nobody does
//   HH:MM UTC <lane> NOTE LIFT engine: <why>                            the hold is over
// A later `main-watch main green` also lifts it. The 11-25 lines are read too: `NOTE HOLD engine lands:`,
// `NOTE HOLD all lanes:` and `NOTE HOLD again:` (landers from `only <lane> lands` or `<lane> fixes forward first`),
// lifted by a NOTE saying `HOLD lifted`. A release lane's `<lane> HOLD v0.1.89 train` holds a release, not lands.
// The override is ALLOW_LAND_DURING_HOLD=1, named in an outgoing commit's body (J381).
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const TAIL_BYTES = 1 << 20;
const LANE = '[a-z][a-z0-9_-]*';
const HOLD = /^\S+ (?:UTC|Cancún) \S+ NOTE HOLD\b(.*)$/u;
const LIFT = /^\S+ (?:UTC|Cancún) \S+ NOTE (?:LIFT engine\b|.*\bHOLD lifted\b)/u;
const GREEN = /^\S+ (?:UTC|Cancún) main-watch main green\b/u;
const OVERRIDE = 'ALLOW_LAND_DURING_HOLD';

/** The landers a hold line names. @param {string} text @returns {string[]} */
function landers(text) {
  const named = new Set();
  const list = new RegExp(`\\blanders? (${LANE}(?:, *${LANE})*)`, 'u').exec(text);
  if (list !== null) for (const lane of list[1].split(/, */u)) named.add(lane);
  for (const pattern of [new RegExp(`\\bonly (${LANE}) lands\\b`, 'gu'), new RegExp(`\\b(${LANE}) fixes forward first\\b`, 'gu')])
    for (const match of text.matchAll(pattern)) named.add(match[1]);
  return [...named];
}

/** The open engine land hold, or null: the newest hold line with no later lift or main-watch green.
 * @param {string} receipts the receipts log, or its tail @returns {{line:string,landers:string[]}|null} */
export function openHold(receipts) {
  const lines = receipts.split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (LIFT.test(line) || GREEN.test(line)) return null;
    const hold = HOLD.exec(line);
    // A hold for lands names engine or all lanes; `HOLD again` repeats the last one.
    if (hold !== null && /^ (?:engine|all|again)\b|\bengine\b/u.test(hold[1])) return { line, landers: landers(hold[1]) };
  }
  return null;
}

/** The receipts tail (the log is append-only and long). @param {NodeJS.ProcessEnv} env */
export function readReceipts(env = process.env) {
  const file = resolve(env.WS_LANE_RECEIPTS ?? join(homedir(), '.cache/wildshard/lane-receipts.log'));
  let fd;
  try {
    const size = statSync(file).size, start = Math.max(0, size - TAIL_BYTES), buffer = Buffer.alloc(size - start);
    fd = openSync(file, 'r');
    readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Why this push must wait, or null when it may go.
 * @param {{lane:string, env?:NodeJS.ProcessEnv, bodies:string, receipts?:string}} push
 *   bodies: the outgoing commits' messages, where the override must be named */
export function holdRefusal({ lane, env = process.env, bodies, receipts = readReceipts(env) }) {
  const hold = openHold(receipts);
  if (hold === null || hold.landers.includes(lane)) return null;
  const override = env[OVERRIDE] === '1';
  if (override && bodies.includes(OVERRIDE)) return null;
  const who = hold.landers.length > 0 ? `only ${hold.landers.join(', ')} land(s)` : 'nobody lands';
  const lifts = '`NOTE LIFT engine: <why>` or `main-watch main green`';
  const how = override ? `${OVERRIDE}=1 is set but no outgoing commit body names it (J381): say why there.`
    : `Override (J381): ${OVERRIDE}=1 and name it in the commit body.`;
  return `engine land HOLD open (${who}; lane ${lane} waits): ${hold.line.slice(0, 300)}. It lifts with a later ${lifts} receipt; wait on the receipts in the background. ${how}`;
}
