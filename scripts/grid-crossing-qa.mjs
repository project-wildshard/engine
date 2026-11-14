#!/usr/bin/env node
// GRID-CROSSING GC1: the crossing harness, one command. It runs `grid-crossing-walk-proof.mjs` (enter the grid by the deck card,
// approach a named neighbour's entryway, then walk out, boost back home and boost out, by real input) in Chromium and WebKit at the
// desktop and phone layouts, one after another inside the browser lane, and writes one JSON row per browser and layout to
// <out>/rows.json: per leg the time from the line to control, the worst stop, frames over 50 and 100 ms, programs linked, and the
// page's memory at control (JS heap, the grid's resident and playing MB, the memory warning), plus each run's shots under <out>/<run>/.
// Staging, preview or a loopback page only (the walk proof refuses production, J205).
//   node scripts/grid-crossing-qa.mjs --base=https://staging.wildshard.io [--to=sunscar|pine|farreach|nalati|nightmarket]
//     [--engines=chromium,webkit] [--layouts=desktop,phone] [--out=~/.cache/wildshard/plan-artifacts/grid-crossing/<stamp>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as absolute } from 'node:path';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', ''), to = flag('to', 'sunscar');
if (base === '') throw new Error('usage: grid-crossing-qa.mjs --base=<staging, preview or loopback url> [--to=…] [--engines=…] [--layouts=…] [--out=…]');
const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-').slice(0, 19);
const out = absolute(flag('out', join(homedir(), '.cache/wildshard/plan-artifacts/grid-crossing', `${stamp}-${to}`)));
mkdirSync(out, { recursive: true });
const root = join(import.meta.dirname, '..');
/** @type {Record<string, unknown>[]} */
const rows = [];
for (const engine of flag('engines', 'chromium,webkit').split(',')) {
  for (const layout of flag('layouts', 'desktop,phone').split(',')) {
    const run = `${engine}-${layout}`, dir = join(out, run);
    const args = [join(root, 'scripts/grid-crossing-walk-proof.mjs'), 'x', dir, 'x', `--base=${base}`, `--to=${to}`, `--engine=${engine}`, `--out=${dir}`,
      ...layout === 'phone' ? ['--layout=phone'] : []];
    const done = spawnSync(join(root, 'scripts/browser-lane.sh'), ['--max', '20', process.execPath, ...args], { cwd: root, stdio: 'inherit' });
    const file = join(dir, `${engine}-gc15c-walk.json`);
    /** @type {any} */
    const walk = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    rows.push({ run, engine, layout, base, to, pass: done.status === 0, playToReadyMs: walk?.playToReadyMs ?? null, memoryAtHome: walk?.memoryAtHome ?? null,
      legs: (walk?.legs ?? []).map((/** @type {any} */ leg) => ({ name: leg.name, borderToControlMs: leg.borderToControlMs, enteredAtMs: leg.enteredAtMs, controlAtMs: leg.controlAtMs,
        worstStopMs: leg.worstStopMs, jumps: leg.jumps, over50: leg.over50, over100: leg.over100, worstFrameMs: leg.worstFrameMs, programLinks: leg.programLinks,
        memory: leg.events?.find((/** @type {any} */ event) => event.control === true)?.memory ?? null })),
      failed: (walk?.steps ?? []).filter((/** @type {any} */ step) => !step.ok).map((/** @type {any} */ step) => step.step) });
  }
}
writeFileSync(join(out, 'rows.json'), `${JSON.stringify(rows, null, 2)}\n`);
for (const row of rows) console.log(`${row.pass === true ? 'PASS' : 'FAIL'} ${String(row.run)} ${JSON.stringify(row.failed)}`);
console.log(`grid-crossing qa: ${out}/rows.json`);
process.exit(rows.every(row => row.pass === true) ? 0 : 1);
