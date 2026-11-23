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
// short is dispatched as it stands, graded incomplete.
// The launchd job copies this file from origin/main before it runs, so a stale canonical checkout runs today's runner.
// It imports nothing from the repo for the same reason.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const exitedFlag = { dev: false };

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
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const short = build.slice(0, 10);
  const logFd = openSync(join(out, 'dev.log'), 'a');
  // DF15: a dropped player's body stands 5 minutes (cellProtocol.ts HOLD_MS), so back-to-back boots measured the dock with the
  // last boots' bodies in view; a 1 s hold lets each cell boot alone
  const dev = spawn(process.execPath, ['scripts/dev.mjs', '--staging', '--shard', 'driftwood-isle', '--port', '0', '--saves', 'memory',
    '--no-watch', '--work', join(out, 'world')], { cwd: root, detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, WS_BUILD_ID: build, HOLD_MS: '1000' } });
  const stopDev = () => { try { if (dev.pid !== undefined) process.kill(-dev.pid, 'SIGTERM'); } catch { /* already gone */ } };
  exitedFlag.dev = false;
  dev.once('exit', () => { exitedFlag.dev = true; });
  try {
    let base = /** @type {string|null} */ (null);
    for (let n = 0; n < 900 && base === null && !exitedFlag.dev; n++) {
      base = /^engine dev on (\S+)/mu.exec(readFileSync(join(out, 'dev.log'), 'utf8'))?.[1] ?? null;
      if (base === null) await sleep(2000);
    }
    if (base === null) {
      receipt(`FAILED ${short}: the dev world never came up (${join(out, 'dev.log')})`);
      return 1;
    }
    console.error(`df7-nightly: ${short} on ${base}`);
    const table = spawn(process.execPath, ['scripts/fps/table.mjs', '--qualify', '--base', base, '--out', join(out, 'table'), ...extra],
      { cwd: root, stdio: 'inherit' });
    // Past the night's budget the table stops at its next cell and writes what it has, graded incomplete.
    const deadline = setTimeout(() => { table.kill('SIGTERM'); }, hours * 3_600_000);
    const [status] = await once(table, 'exit');
    clearTimeout(deadline);
    if (![0, 2, 3].includes(status) || !existsSync(join(out, 'table/table.json'))) {
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
  } finally { stopDev(); }
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
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(homedir())}</string><key>WS_LANE_NAME</key><string>df7-nightly</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>17</integer></dict>
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

process.exitCode = await main();
