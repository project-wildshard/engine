#!/usr/bin/env node
// DF7 (meta DRIFTWOOD-FPS; J464 floors, J467 the mini measures): the Mac mini's nightly Driftwood floors table.
// The `mini-1` runner is a Linux VM with no Metal, and a native runner on the mini's own account would run any workflow
// of this public repo beside Jake's files and keys. So the mini measures main's tip itself, from launchd, and hands the
// hosted driftwood-fps.yml job only its graded night (data, no secret) to print on that run's summary page.
//
//   node scripts/fps/nightly-mini.mjs --install     launchd runs one night at 02:17 Cancún (io.wildshard.driftwood-fps)
//   node scripts/fps/nightly-mini.mjs --uninstall
//   node scripts/fps/nightly-mini.mjs [--hours 10] [--no-dispatch] [-- <table.mjs flags>]   one night, now
//
// One night: fetch origin main and check its tip out detached at <canonical>/tmp/df7-nightly/engine with its own
// install, then run that checkout's copy of this script with --measure, so the runner and the measured code are one
// commit. --measure: a local dev world (dev.mjs --staging --saves memory), `table.mjs --qualify` (each cell is one boot
// under desktop-gpu.lock, so other lanes interleave), the grade against the last green night (nightly.mjs), then
// `gh workflow run driftwood-fps.yml` with the night and the table. One receipt line goes to lane-receipts.log.
// A full night is 135 cells (nine variants, three repeats, five legs), each a fresh boot that queues for the GPU lock
// beside the lanes: about 3 to 5 minutes a cell (the 11-23 smoke), so --hours defaults to 10 and a night still cut
// short is dispatched as it stands, graded incomplete. A cell whose player died (a creature of the hours-old world) restarts
// the world on the same port and resumes (DF15).
// The launchd job copies this file from origin/main before it runs, so a stale canonical checkout runs today's runner.
// It imports nothing from the repo for the same reason.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const LABEL = 'io.wildshard.driftwood-fps';
const REPO = 'project-wildshard/engine';
const WORKFLOW = 'driftwood-fps.yml';
// GitHub caps a dispatch's inputs at 65,535 characters in all; the night is about 3 KB.
const TABLE_CHARS = 50_000;

const cancun = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Cancun', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
/** @param {string} line */
function receipt(line) {
  const file = process.env.WS_RECEIPTS_LOG ?? join(homedir(), '.cache/wildshard/lane-receipts.log');
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${cancun()} Cancún df7-nightly ${line}\n`); } catch { /* a receipt never stops the night */ }
}
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
/** @param {string} cmd @param {string[]} args @param {string} cwd */
const step = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit' }).status === 0;

/** The canonical checkout: the one whose .git the worktrees share. @param {string} from */
const canonicalOf = (from) => dirname(git(from, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
const nightRoot = (/** @type {string} */ canonical) => join(canonical, 'tmp/df7-nightly');
// DF15: table.mjs's exit when a cell's player died (scripts/fps/batch.mjs PLAYER_DIED; this file imports nothing from the repo)
const PLAYER_DIED = 4;
const MAX_WORLD_RESTARTS = 20;

/** A port free right now, for the night's dev world. @returns {Promise<number>} */
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

/** Check main's tip out at the nightly checkout and run its own copy of this script. @param {string} canonical
 * @param {string[]} pass */
function night(canonical, pass) {
  const root = nightRoot(canonical);
  const checkout = join(root, 'engine');
  git(canonical, 'fetch', '-q', 'origin', 'main');
  const sha = git(canonical, 'rev-parse', 'origin/main');
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(checkout, '.git'))) {
    git(canonical, 'worktree', 'prune');
    git(canonical, 'worktree', 'add', '-q', '--detach', '-f', checkout, sha);
  } else {
    git(checkout, 'checkout', '-q', '--detach', '--force', sha);
    git(checkout, 'clean', '-fdq');
  }
  if (!step('pnpm', ['install', '--frozen-lockfile', '--offline'], checkout) && !step('pnpm', ['install', '--frozen-lockfile'], checkout)) {
    receipt(`FAILED ${sha.slice(0, 10)}: pnpm install in ${checkout}`);
    return 1;
  }
  const scripts = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).scripts ?? {};
  if (scripts.pins !== undefined && !step('pnpm', ['pins'], checkout)) {
    receipt(`FAILED ${sha.slice(0, 10)}: pnpm pins in ${checkout}`);
    return 1;
  }
  return spawnSync(process.execPath, [join(checkout, 'scripts/fps/nightly-mini.mjs'), '--measure', '--build', sha, ...pass],
    { cwd: checkout, stdio: 'inherit' }).status ?? 1;
}

/** A night whose process died past its SIGTERM handler (a SIGKILL; launchd tearing the job down after `launchctl kill`
 * hit only lockf) leaves its world running: dev.mjs is detached, in its own process group. On 11-23 such a world (dev.mjs
 * PID 61306) ran four hours on tmp/df7/world beside the next night's world, which had wiped and rebuilt that directory
 * under it. night.lock runs one night at a time, so a group the last night recorded is a dead night's: stop it before
 * this night touches the directory. Only a group with a process still naming `world` (a reused pid is left alone).
 * @param {string} file the recorded process group @param {string} world its --work directory */
export async function stopStaleWorld(file, world) {
  let group = 0;
  try { group = Number(readFileSync(file, 'utf8').trim()); } catch { return false; }
  rmSync(file, { force: true });
  if (!Number.isInteger(group) || group <= 1) return false;
  // dev.mjs names it (--work), its world server and page host run from inside it; a reused pid's group names it nowhere
  const members = spawnSync('ps', ['-A', '-ww', '-o', 'pgid=,command='], { encoding: 'utf8' }).stdout.split('\n')
    .filter(line => Number(line.trim().split(/\s+/u)[0]) === group);
  if (!members.some(line => line.includes(world))) return false;
  try { process.kill(-group, 'SIGTERM'); } catch { return false; }
  for (let n = 0; n < 60; n++) {
    await sleep(500);
    try { process.kill(-group, 0); } catch { return true; }
  }
  try { process.kill(-group, 'SIGKILL'); } catch { /* gone */ }
  return true;
}

/** The newest green dispatched nights: the first one's build is "since", the first that qualifies is the p95 baseline.
 * @param {string} dir @returns {{since:string|null, previous:string|null}} */
function lastGreen(dir) {
  /** @type {{databaseId:number}[]} */
  const runs = JSON.parse(execFileSync('gh', ['run', 'list', '-R', REPO, '--workflow', WORKFLOW, '--branch', 'main', '--status', 'success',
    '--event', 'workflow_dispatch', '--limit', '14', '--json', 'databaseId'], { encoding: 'utf8' }));
  let since = /** @type {string|null} */ (null);
  for (const { databaseId } of runs) {
    const into = join(dir, String(databaseId));
    if (spawnSync('gh', ['run', 'download', String(databaseId), '-R', REPO, '--name', 'driftwood-fps', '--dir', into], { stdio: 'ignore' }).status !== 0) continue;
    const file = join(into, 'night.json');
    if (!existsSync(file)) continue;
    const green = JSON.parse(readFileSync(file, 'utf8'));
    since ??= typeof green.build === 'string' ? green.build : null;
    if (green.qualifies === true) return { since, previous: file };
  }
  return { since, previous: null };
}

/** Measure this checkout (main's tip), grade it and dispatch the report.
 * @param {string} build @param {number} hours @param {boolean} dispatch @param {string[]} extra */
async function measure(build, hours, dispatch, extra) {
  const root = resolve(import.meta.dirname, '../..');
  const out = join(root, 'tmp/df7');
  // the night's world group, kept beside the checkout (out is wiped below) so the next night can stop it if this one dies
  const worldGroup = join(root, 'tmp/df7-world.pgid');
  if (await stopStaleWorld(worldGroup, join(out, 'world'))) console.error('df7-nightly: stopped the world a dead night left running');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const short = build.slice(0, 10);
  const logFd = openSync(join(out, 'dev.log'), 'a');
  // DF15 (mini-df15, 2026-11-23): one port for the night, so a restarted world keeps the table's base (and its resume fingerprint)
  const port = await freePort();
  /** @type {import('node:child_process').ChildProcess | null} */
  let dev = null;
  const stopDev = async () => {
    const running = dev;
    dev = null;
    rmSync(worldGroup, { force: true });
    if (running === null || running.exitCode !== null || running.signalCode !== null) return;
    const group = running.pid;
    if (group === undefined) return;
    try { process.kill(-group, 'SIGTERM'); } catch { return; }
    // the whole group (dev.mjs, its preview server, the world server) leaves, so the port is free for the next world
    for (let n = 0; n < 60; n++) {
      try { process.kill(-group, 0); } catch { return; }
      await sleep(500);
    }
  };
  /** Start a fresh dev world on the night's port; its origin, or null if it never came up. */
  const startDev = async () => {
    const from = readFileSync(join(out, 'dev.log'), 'utf8').length;
    // DF15: a dropped player's body stands 5 minutes (cellProtocol.ts HOLD_MS), so back-to-back boots measured the dock with the
    // last boots' bodies in view; a 1 s hold lets each cell boot alone
    const world = spawn(process.execPath, ['scripts/dev.mjs', '--staging', '--shard', 'driftwood-isle', '--port', String(port), '--saves', 'memory',
      '--no-watch', '--work', join(out, 'world')], { cwd: root, detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, WS_BUILD_ID: build, HOLD_MS: '1000' } });
    dev = world;
    if (world.pid !== undefined) writeFileSync(worldGroup, String(world.pid));
    let base = /** @type {string|null} */ (null);
    for (let n = 0; n < 900 && base === null && world.exitCode === null && world.signalCode === null; n++) {
      base = /^engine dev on (\S+)/mu.exec(readFileSync(join(out, 'dev.log'), 'utf8').slice(from))?.[1] ?? null;
      if (base === null) await sleep(2000);
    }
    return base;
  };
  // A SIGTERM (launchd, a watchdog) would end this process past its finally and orphan the world: stop it first
  /** @type {import('node:child_process').ChildProcess | null} */
  let table = null;
  const terminate = () => { table?.kill('SIGTERM'); void stopDev().finally(() => process.exit(143)); };
  process.once('SIGTERM', terminate);
  try {
    const base = await startDev();
    if (base === null) {
      receipt(`FAILED ${short}: the dev world never came up (${join(out, 'dev.log')})`);
      return 1;
    }
    console.error(`df7-nightly: ${short} on ${base}`);
    // DF15: a night's world runs for hours and its creatures roam; on 11-23 Driftwood's black bear came to stand at the quest
    // fire and killed 15 cells' players. A death stops the table (--stop-on-death, exit 4): restart the world and resume.
    const ends = Date.now() + hours * 3_600_000;
    let status = /** @type {number|null} */ (null), restarts = 0;
    for (;;) {
      table = spawn(process.execPath, ['scripts/fps/table.mjs', '--qualify', '--stop-on-death', '--base', base, '--out', join(out, 'table'), ...extra],
        { cwd: root, stdio: 'inherit' });
      // Past the night's budget the table stops at its next cell and writes what it has, graded incomplete.
      const running = table;
      const deadline = setTimeout(() => { running.kill('SIGTERM'); }, Math.max(1, ends - Date.now()));
      [status] = await once(running, 'exit');
      table = null;
      clearTimeout(deadline);
      if (status !== PLAYER_DIED || restarts >= MAX_WORLD_RESTARTS || Date.now() >= ends) break;
      restarts++;
      await stopDev();
      const again = await startDev();
      if (again !== base) {
        receipt(`FAILED ${short}: the dev world did not come back on ${base} after a death (${join(out, 'dev.log')})`);
        return 1;
      }
      console.error(`df7-nightly: the player died; world restarted (${String(restarts)} of ${String(MAX_WORLD_RESTARTS)})`);
    }
    if (status === PLAYER_DIED) status = 3;
    if (![0, 2, 3].includes(status ?? -1) || !existsSync(join(out, 'table/table.json'))) {
      receipt(`FAILED ${short}: table.mjs exited ${String(status)} (${out})`);
      return 1;
    }
    const tmp = mkdtempSync(join(out, 'previous-'));
    const { since, previous } = lastGreen(tmp);
    const grading = spawnSync(process.execPath, ['scripts/fps/nightly.mjs', '--table', join(out, 'table/table.json'), '--build', build,
      '--out', join(out, 'night.json'), ...previous === null ? [] : ['--previous', previous], ...since === null ? [] : ['--since', since]],
      { cwd: root, encoding: 'utf8' });
    process.stdout.write(grading.stdout);
    if (grading.status !== 0) {
      receipt(`FAILED ${short}: nightly.mjs exited ${String(grading.status)}: ${grading.stderr.trim().split('\n').at(-1) ?? ''}`);
      return 1;
    }
    const graded = JSON.parse(readFileSync(join(out, 'night.json'), 'utf8'));
    writeFileSync(join(out, 'night.min.json'), JSON.stringify(graded));
    const markdown = readFileSync(join(out, 'table/table.md'), 'utf8');
    writeFileSync(join(out, 'table.dispatch.md'), markdown.length <= TABLE_CHARS ? markdown
      : `${markdown.slice(0, TABLE_CHARS)}\n\n(table cut at ${String(TABLE_CHARS)} characters; the mini keeps it at ${join(out, 'table/table.md')})\n`);
    const verdict = graded.rows.map((/** @type {{name:string, fps:number, floor:number}} */ row) => `${row.name} ${row.fps.toFixed(1)}/${String(row.floor)}`).join(', ');
    if (!dispatch) {
      receipt(`NIGHT ${short} not dispatched: ${verdict}; qualifies ${String(graded.qualifies)} (${join(out, 'night.json')})`);
      return 0;
    }
    const sent = spawnSync('gh', ['workflow', 'run', WORKFLOW, '-R', REPO, '--ref', 'main', '-f', `build=${build}`, '-f', `since=${since ?? ''}`,
      '-F', `night=@${join(out, 'night.min.json')}`, '-F', `table=@${join(out, 'table.dispatch.md')}`], { encoding: 'utf8' });
    if (sent.status !== 0) {
      receipt(`FAILED ${short}: gh workflow run: ${sent.stderr.trim().split('\n').at(-1) ?? ''} (night kept at ${join(out, 'night.json')})`);
      return 1;
    }
    receipt(`NIGHT ${short}: ${verdict}; qualifies ${String(graded.qualifies)}; dispatched ${WORKFLOW} (gh run list -R ${REPO} --workflow ${WORKFLOW})`);
    return 0;
  } finally { process.removeListener('SIGTERM', terminate); await stopDev(); }
}

const domain = () => `gui/${String(process.getuid?.() ?? 501)}`;

/** launchd runs one night at 02:17 Cancún (the Mac's clock), copying this file from origin/main first.
 * @param {string} canonical */
function install(canonical) {
  const root = nightRoot(canonical);
  mkdirSync(root, { recursive: true });
  const plist = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  const path = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const q = (/** @type {string} */ s) => `'${s.replaceAll("'", String.raw`'\''`)}'`;
  const launcher = join(root, 'launcher.mjs');
  const shell = `git -C ${q(canonical)} fetch -q origin main && git -C ${q(canonical)} show origin/main:scripts/fps/nightly-mini.mjs > ${q(launcher)}`
    + ` && exec ${q(process.execPath)} ${q(launcher)} --canonical ${q(canonical)}`;
  const args = ['/usr/bin/lockf', '-t', '0', join(root, 'night.lock'), '/bin/sh', '-c', shell];
  const xml = (/** @type {string} */ s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  // DF15 (2026-11-23): with no ProcessType, launchd spawns the job as a daemon under its "light resource limits" (every
  // process in the night at scheduling priority 20, a hand-started run's at 31): the night's phone-low drew 15-22 fps
  // where the same build and profile started by hand drew 59.9. Interactive runs it with an app's limits.
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(homedir())}</string><key>WS_LANE_NAME</key><string>df7-nightly</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>17</integer></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(join(root, 'launchd.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(root, 'launchd.log'))}</string>
</dict></plist>
`);
  spawnSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' });
  const boot = spawnSync('launchctl', ['bootstrap', domain(), plist], { encoding: 'utf8' });
  if (boot.status !== 0) throw new Error(`launchctl bootstrap ${plist}: ${boot.stderr.trim()}`);
  console.log(`df7-nightly: launchd runs ${LABEL} at 02:17 (${plist}); log ${join(root, 'launchd.log')}`);
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    install: { type: 'boolean' }, uninstall: { type: 'boolean' }, measure: { type: 'boolean' }, build: { type: 'string' },
    canonical: { type: 'string' }, hours: { type: 'string', default: '10' }, 'no-dispatch': { type: 'boolean' },
  } });
  const hours = Number(values.hours);
  if (!(hours > 0)) throw new Error('--hours takes a positive number');
  const pass = ['--hours', String(hours), ...values['no-dispatch'] ? ['--no-dispatch'] : [], ...positionals.length > 0 ? ['--', ...positionals] : []];
  if (values.measure) {
    if (values.build === undefined || !/^[0-9a-f]{40}$/u.test(values.build)) throw new Error('--measure takes --build <full sha>');
    return measure(values.build, hours, !values['no-dispatch'], positionals);
  }
  const canonical = values.canonical ?? canonicalOf(import.meta.dirname);
  if (values.install) { install(canonical); return 0; }
  if (values.uninstall) {
    spawnSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' });
    rmSync(join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`), { force: true });
    console.log(`df7-nightly: ${LABEL} removed`);
    return 0;
  }
  return night(canonical, pass);
}

if (import.meta.main) process.exitCode = await main();
