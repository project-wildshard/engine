#!/usr/bin/env node
// Meta STAGING-BUGBASH SB45: every upload rewrites staging's placement file (J379 GRID_AUTOPLACE), which adds or changes a Zone
// select card between releases, and no release gate opens it. One call reads the signed file; when its serial moved since the
// last call, it opens each slug the move added or re-hashed with `zone-sweep.mjs --chunk --only <slugs>` (the cold `?chunk=` link
// that ONE-FORMAT OF8 broke, OF8b) and appends one receipt line per slug: `placement-sweep PASS|FAIL|NOCARD ...`. A FAIL is an SB
// row for the coordinator; NOCARD is an upload with no cooked content (SA48), which shows no card rather than a failed one.
// main-watch.mjs starts it after each pass on a machine that opted in (~/.config/wildshard/placement-sweep), so a staging upload
// gets its line within the hour engine main keeps moving.
//   node scripts/placement-sweep.mjs [--dry-run] [--browser=chromium|webkit]
// State (the last serial and each slug's hash) is ~/.cache/wildshard/placement-sweep.json; output under <checkout>/tmp/placement-sweep/.
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLACEMENTS = 'https://packs.wildshard.io/releases/staging-placements.json';
export const STAGING = 'https://staging.wildshard.io';

/** @typedef {{ serial: number, cells: Record<string, string> }} SweepState */
/** @typedef {{ slug: string, outcome: 'PASS' | 'FAIL' | 'NOCARD', detail: string }} Outcome */

/** The slugs a placement move added or re-hashed; a first call (no state) only records the file.
 * @param {SweepState | null} state @param {{ serial: number, cells: readonly { slug: string, hash: string }[] }} file
 * @returns {{ serial: number, slugs: string[], seed: boolean }} */
export function changedPlacements(state, file) {
  if (state === null) return { serial: file.serial, slugs: [], seed: true };
  if (state.serial === file.serial) return { serial: file.serial, slugs: [], seed: false };
  const slugs = [...new Set(file.cells.filter((cell) => state.cells[cell.slug] !== cell.hash).map((cell) => cell.slug))];
  return { serial: file.serial, slugs, seed: false };
}

/** Each swept slug's outcome from the zone sweep's results.json (null: it wrote none).
 * @param {readonly string[]} slugs
 * @param {{ results: readonly { slug: string, pass: boolean, enterMs: number | null, thrown: string }[], missing?: readonly string[] } | null} sweep
 * @returns {Outcome[]} */
export function placementOutcomes(slugs, sweep) {
  return slugs.map((slug) => {
    if (sweep === null) return { slug, outcome: 'FAIL', detail: 'the sweep wrote no results' };
    const row = sweep.results.find((r) => r.slug === slug);
    if (row === undefined) return { slug, outcome: 'NOCARD', detail: 'no Zone select card' };
    const entered = row.enterMs === null ? 'never in the world' : `in the world in ${String(row.enterMs)} ms`;
    return { slug, outcome: row.pass ? 'PASS' : 'FAIL', detail: row.thrown === '' ? entered : `${entered}, ${row.thrown}` };
  });
}

/** @param {number} serial @param {string | undefined} build @param {Outcome} outcome @returns {string} */
export function sweepLine(serial, build, outcome) {
  return `placement-sweep ${outcome.outcome} staging serial ${String(serial)} ${outcome.slug} (build ${build === undefined ? 'moved' : build.slice(0, 8)}, ?chunk= cold load): ${outcome.detail}`;
}

/** main-watch starts a sweep only on a machine that opted in: WS_PLACEMENT_SWEEP=1, or ~/.config/wildshard/placement-sweep
 * (the MacBook; the mini runs no browser work unsigned, J356). WS_PLACEMENT_SWEEP=0 turns it off.
 * @param {Record<string, string | undefined>} env @param {(path: string) => boolean} exists @param {string} home @returns {boolean} */
export function sweepOptedIn(env, exists, home) {
  if (env.WS_PLACEMENT_SWEEP !== undefined) return env.WS_PLACEMENT_SWEEP === '1';
  return exists(join(home, '.config/wildshard/placement-sweep'));
}

/** One sweep at a time per machine: a lock file older than an hour is a crashed run. @param {string} file @returns {(() => void) | null} */
function claim(file) {
  try { if (Date.now() - statSync(file).mtimeMs > 3_600_000) rmSync(file, { force: true }); } catch { /* no lock */ }
  try { closeSync(openSync(file, 'wx')); return () => rmSync(file, { force: true }); } catch { return null; }
}

async function cli() {
  const flag = (/** @type {string} */ name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dry = process.argv.includes('--dry-run'), browser = flag('browser') ?? 'chromium';
  const cache = join(homedir(), '.cache/wildshard'), statePath = join(cache, 'placement-sweep.json');
  const receipts = process.env.WS_LANE_RECEIPTS ?? join(cache, 'lane-receipts.log');
  const here = resolve(import.meta.dirname, '..');
  mkdirSync(cache, { recursive: true });
  const unlock = claim(`${statePath}.lock`);
  if (unlock === null) { console.log('placement-sweep: another sweep is running'); return; }
  try {
    const signed = /** @type {{ body: string }} */ (await (await fetch(PLACEMENTS, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })).json());
    const file = /** @type {{ channel: string, serial: number, cells: { slug: string, hash: string }[] }} */ (JSON.parse(signed.body));
    if (file.channel !== 'staging') throw new Error('placement-sweep reads the staging placement file only');
    /** @type {SweepState | null} */
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
    const due = changedPlacements(state, file);
    console.log(`placement-sweep: serial ${String(state?.serial ?? 'none')} -> ${String(file.serial)}; ${due.seed ? 'first pass, recorded' : due.slugs.length === 0 ? 'nothing to sweep' : `sweeping ${due.slugs.join(', ')}`}`);
    if (dry) return;
    // recorded before the sweep: a crash or a slow run never sweeps the same move twice
    const next = { serial: file.serial, cells: Object.fromEntries(file.cells.map((cell) => [cell.slug, cell.hash])) };
    writeFileSync(`${statePath}.next`, `${JSON.stringify(next)}\n`);
    renameSync(`${statePath}.next`, statePath);
    if (due.slugs.length === 0) return;
    // the newest sweep's shots stay as its evidence until the next move replaces them
    const out = join(here, 'tmp/placement-sweep', browser);
    rmSync(out, { recursive: true, force: true });
    spawnSync(process.execPath, [join(here, 'scripts/zone-sweep.mjs'), '--url', STAGING, '--browser', browser, '--chunk', '--only', due.slugs.join(','), '--out', out],
      { cwd: here, stdio: 'inherit', timeout: 30 * 60_000, env: { ...process.env, WS_LANE_NAME: process.env.WS_LANE_NAME ?? 'placement-sweep' } });
    const resultsPath = join(out, 'results.json');
    const sweep = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : null;
    for (const outcome of placementOutcomes(due.slugs, sweep)) {
      const line = sweepLine(file.serial, sweep?.build, outcome);
      console.log(line);
      appendFileSync(receipts, `${new Date().toISOString().slice(11, 16)} UTC ${line}\n`);
    }
  } finally { unlock(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli();
