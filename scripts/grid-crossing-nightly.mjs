#!/usr/bin/env node
// GRID-CROSSING GC17: GC3's crossing run every night and after every staging release, from this Mac until MAC-MINI-RUNNER MR7 takes it.
// One call decides what is due and runs it (a launchd agent calls it every hour):
//   release  staging's signed release file (packs.wildshard.io/releases/staging.json) names a serial no run has read: the online walks
//            (`grid-crossing-qa.mjs`, Driftwood's exits, Chromium and WebKit, desktop and phone) on staging
//   nightly  after 03:00 (this Mac's clock) and none yet today: the every-pair tour (`grid-crossing-tour.mjs`, Chromium desktop) on preview
// Each run writes `grid-crossing-report.mjs`'s report under <root>/<kind>-<stamp>/report and checks the ratchet: a pair worse than
// `test/grid-crossing-ratchet.json` is red. Every run appends one line to ~/.cache/wildshard/lane-receipts.log (`grid-nightly DONE` or
// `grid-nightly RED`, naming the red pairs), which the coordinator reads to open a QA-FEEDBACK row. State (the last serial and night) is
// <root>/state.json.
//   node scripts/grid-crossing-nightly.mjs [--root=<dir>] [--force=release|nightly] [--dry-run]
// --root defaults to ~/.cache/wildshard/plan-artifacts/grid/nightly. --dry-run prints what is due and runs nothing.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = flag('root', join(homedir(), '.cache/wildshard/plan-artifacts/grid/nightly')), force = flag('force', ''), dry = process.argv.includes('--dry-run');
const RECEIPTS = join(homedir(), '.cache/wildshard/lane-receipts.log'), STATE = join(root, 'state.json'), here = join(import.meta.dirname, '..');
mkdirSync(root, { recursive: true });
/** @type {{ serial: number | null, night: string | null }} */
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { serial: null, night: null };

const now = new Date(), pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const today = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, stamp = `${today}T${pad(now.getHours())}${pad(now.getMinutes())}`;
const signed = /** @type {{ body: string }} */ (await (await fetch('https://packs.wildshard.io/releases/staging.json', { cache: 'no-store' })).json());
const serial = Number(/** @type {{ serial: number }} */ (JSON.parse(signed.body)).serial);

/** @type {('release' | 'nightly')[]} */
const due = [];
if (force === 'release' || (force === '' && Number.isFinite(serial) && serial !== state.serial)) due.push('release');
if (force === 'nightly' || (force === '' && now.getHours() >= 3 && state.night !== today)) due.push('nightly');
console.log(`grid-crossing nightly: staging serial ${String(serial)} (last read ${String(state.serial)}), night ${today} (last ${String(state.night)}); due: ${due.join(', ') || 'nothing'}`);
if (dry || due.length === 0) process.exit(0);

/** @param {string[]} args */
const run = (args) => spawnSync(join(here, 'scripts/browser-lane.sh'), ['--max', '90', 'node', ...args], { cwd: here, stdio: 'inherit' }).status;
const clock = () => { const d = new Date(); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`; };
let red = false;
for (const kind of due) {
  const dir = join(root, `${kind}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const walked = kind === 'release'
    ? run(['scripts/grid-crossing-qa.mjs', '--base=https://staging.wildshard.io', `--out=${join(dir, 'walks')}`])
    : run(['scripts/grid-crossing-tour.mjs', '--base=https://preview.wildshard.io', `--out=${join(dir, 'tour')}`, '--lane=grid-nightly']);
  const runs = kind === 'release' ? join(dir, 'walks/rows.json') : join(dir, 'tour');
  const report = spawnSync('node', ['scripts/grid-crossing-report.mjs', join(dir, 'report'), `--runs=${runs}`], { cwd: here, encoding: 'utf8' });
  writeFileSync(join(dir, 'report.log'), `${report.stdout}${report.stderr}`);
  const worse = `${report.stdout}`.split('\n').filter(line => line.startsWith('WORSE ')).slice(0, 8).join('; ');
  const ok = report.status === 0;
  red ||= !ok;
  const what = kind === 'release' ? `staging serial ${String(serial)} walks` : 'preview every-pair tour';
  appendFileSync(RECEIPTS, `${clock()} grid-nightly ${ok ? 'DONE' : 'RED'}: GC17 ${kind} ${what}, ${ok ? 'no pair worse than the ratchet' : `ratchet broken: ${worse || 'see report.log'}`}${walked === 0 ? '' : ' (the run itself exited non-zero)'}, ${join(dir, 'report/report.html')}\n`);
  if (kind === 'release') state.serial = serial; else state.night = today;
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}
process.exit(red ? 1 : 0);
