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
// Meta QA 11-25 row 98: only that shape is a hold: `NOTE HOLD <topic>:` with the topic exactly `engine` (or the 11-25
// `engine lands`, `all lanes`, `again`). On 11-26 05:23 UTC a land stopped on `NOTE HOLD-engine coordinator
// opus-lean91: two small engine commits wait on the HOLD`, a note to the coordinator about a hold, read as a hold
// naming no lander, so nobody could land. A NOTE whose topic merely names a hold (`HOLD-engine`, `HOLD-scoped red`,
// `HOLD v0.1.92 staging`) binds nothing; a lift is `NOTE LIFT engine:` (or the 11-25 `engine land HOLD lifted`).
// Meta QA 11-25 row 67 (J505, no freezes): a hold binds only pushes that touch the red's files. The red's files are the
// paths named in the hold line and in main-watch's `MAIN RED` and `NOTE RED` lines since the last lift or green. A push
// none of whose files is one of them (or, for a named source file that is not a test, sits in its directory) goes, with
// `HOLD open but this push is disjoint from <paths>; landing (J505)`. A hold that names no path binds every push. A push
// that does touch the red's source still meets the red test in its own push gate (related tests), so it cannot pile on.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const TAIL_BYTES = 1 << 20;
const LANE = '[a-z][a-z0-9_-]*';
const HOLD = /^\S+ (?:UTC|Cancún) \S+ NOTE HOLD (?:engine|engine lands|all lanes|again):(.*)$/u;
const LIFT = /^\S+ (?:UTC|Cancún) \S+ NOTE (?:LIFT engine:|.*\bengine land HOLD lifted\b)/u;
const GREEN = /^\S+ (?:UTC|Cancún) main-watch main green\b/u;
const OVERRIDE = 'ALLOW_LAND_DURING_HOLD';
const RED = /^\S+ (?:UTC|Cancún) main-watch (?:MAIN RED|NOTE RED)\b/u;
// A repo path: at least one directory, a file name with a code, data or config extension, and no URL scheme before it.
const PATH = /(?<![\w:/.-])((?:[\w.@-]+\/)+[\w.-]+\.(?:[cm]?[jt]sx?|json|ya?ml|sh|py|wgsl|glsl|toml|md))(?![\w/])/gu;

/** The landers a hold line names. @param {string} text @returns {string[]} */
function landers(text) {
  const named = new Set();
  const list = new RegExp(`\\blanders? (${LANE}(?:, *${LANE})*)`, 'u').exec(text);
  if (list !== null) for (const lane of list[1].split(/, */u)) named.add(lane);
  for (const pattern of [new RegExp(`\\bonly (${LANE}) lands\\b`, 'gu'), new RegExp(`\\b(${LANE}) fixes forward first\\b`, 'gu')])
    for (const match of text.matchAll(pattern)) named.add(match[1]);
  return [...named];
}

/** The repo paths a receipt line names. @param {string} text @returns {string[]} */
export function namedPaths(text) {
  return [...new Set([...text.matchAll(PATH)].map(match => match[1].replace(/^\.\//u, '')))];
}

/** The open engine land hold, or null: the newest hold line with no later lift or main-watch green, and the red's
 * files (row 67): the paths in it and in the span's main-watch red lines.
 * @param {string} receipts the receipts log, or its tail @returns {{line:string,landers:string[],paths:string[]}|null} */
export function openHold(receipts) {
  const lines = receipts.split('\n'), reds = /** @type {string[]} */ ([]);
  let hold = /** @type {{line:string,landers:string[]}|null} */ (null);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (LIFT.test(line) || GREEN.test(line)) break;
    if (RED.test(line)) { reds.push(line); continue; }
    const match = HOLD.exec(line);
    // A hold for lands names engine or all lanes as its topic; `HOLD again` repeats the last one.
    if (hold === null && match !== null) hold = { line, landers: landers(match[1]) };
  }
  if (hold === null) return null;
  // `all lanes` holds (rooms down, not a red) bind every push.
  const paths = /\bNOTE HOLD all\b/u.test(hold.line) ? [] : namedPaths([hold.line, ...reds].join('\n'));
  return { ...hold, paths };
}

const isTest = (/** @type {string} */ path) => /(?:^|\/)test\/|\.test\.[cm]?[jt]sx?$/u.test(path);
const dirOf = (/** @type {string} */ path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** The push's files that touch the red's files: the same path, the directory of a named source file (not a test), or a
 * directory above a named path.
 * @param {readonly string[]} files @param {readonly string[]} paths @returns {string[]} */
export function touching(files, paths) {
  const sources = new Set(paths.filter(path => !isTest(path)).map(dirOf));
  // A directory pathspec (main-push before it commits) touches every named path under it.
  const under = (/** @type {string} */ file) => { const dir = `${file.replace(/\/+$/u, '')}/`; return paths.some(path => path.startsWith(dir)); };
  return files.filter(file => paths.includes(file) || sources.has(dirOf(file)) || under(file));
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
 * @param {{lane:string, env?:NodeJS.ProcessEnv, bodies:string, receipts?:string, files?:readonly string[], say?:(line:string)=>void}} push
 *   bodies: the outgoing commits' messages, where the override must be named; files: the paths the push changes
 *   (row 67: unknown files bind as before); say: hears the disjoint-push note */
export function holdRefusal({ lane, env = process.env, bodies, receipts = readReceipts(env), files, say }) {
  const hold = openHold(receipts);
  if (hold === null || hold.landers.includes(lane)) return null;
  if (files !== undefined && files.length > 0 && hold.paths.length > 0 && touching(files, hold.paths).length === 0) {
    say?.(`HOLD open but this push is disjoint from ${hold.paths.join(', ')}; landing (J505)`);
    return null;
  }
  const override = env[OVERRIDE] === '1';
  if (override && bodies.includes(OVERRIDE)) return null;
  const who = hold.landers.length > 0 ? `only ${hold.landers.join(', ')} land(s)`
    : 'nobody lands: the hold names no `; lander <lane>`';
  const lifts = '`NOTE LIFT engine: <why>` or `main-watch main green`';
  const how = override ? `${OVERRIDE}=1 is set but no outgoing commit body names it (J381): say why there.`
    : `Override (J381): ${OVERRIDE}=1 and name it in the commit body.`;
  return `engine land HOLD open (${who}; lane ${lane} waits): ${hold.line.slice(0, 300)}. It lifts with a later ${lifts} receipt; wait on the receipts in the background. ${how}`;
}
