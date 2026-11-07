#!/usr/bin/env node
// E357 S1.6. Run through scripts/browser-lane.sh; never launches a game or phone pass.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { exportTree, serve } from './parity/serve.mjs';

/** @typedef {import('../src/client/engine/calibrate/run').CalibrationRun} CalibrationRun */
const root = resolve(import.meta.dirname, '..');
/** @type {Record<string, string | undefined>} */
const args = Object.fromEntries(process.argv.slice(2).map((s) => { const m = /^--(export|url|out)=(.+)$/.exec(s); if (!m) throw new Error(`Unknown argument ${s}`); return [m[1], m[2]]; }));
let ancestor = process.ppid, inLane = false;
for (let i = 0; i < 8 && ancestor > 1; i++) {
  const line = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(ancestor)], { encoding: 'utf8' }).trim();
  if (line.includes('browser-lane.sh _slot')) { inLane = true; break; }
  ancestor = Number.parseInt(line, 10);
}
if (!inLane) throw new Error('Run scripts/browser-lane.sh --max 4 node scripts/calibrate.mjs --export=HEAD');
const sha = execFileSync('git', ['rev-parse', args.export ?? 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
let exported, server, browser;
try {
  if (!args.url) { exported = exportTree(root, sha); server = await serve(exported.tree, sha); }
  browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(e.message));
  const targetUrl = args.url ?? server?.url;
  if (!targetUrl) throw new Error('No calibration preview origin');
  await page.goto(new URL('/calibration/', targetUrl).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => ['done', 'error'].includes(window.__calibration?.status ?? ''), undefined, { timeout: 360000 });
  const handle = await page.evaluate(() => window.__calibration);
  const out = resolve(args.out ?? root); mkdirSync(join(out, 'budgets/calibration'), { recursive: true });
  if (handle?.error || !handle?.result) { writeFileSync(join(out, 'budgets/calibration/error.json'), JSON.stringify(handle, null, 2)); throw new Error(handle?.error ?? 'No calibration result'); }
  const run = { ...handle.result, sha, browser: browser.version(), inbox: handle.inbox };
  if (!run.renderer.includes('ANGLE Metal Renderer') || !run.renderer.includes('Apple')) throw new Error(`Expected Apple Metal: ${run.renderer}`);
  const path = join(out, `budgets/calibration/m5-${run.measuredAt.replaceAll(/[:.]/g, '-')}.json`);
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`);
  if (!run.stable) throw new Error(`Preheat did not converge; observations kept at ${path}; current calibration unchanged`);
  writeFileSync(join(out, 'budgets/calibration.json'), `${JSON.stringify(run, null, 2)}\n`);
  console.info(`Calibration: ${path}\n${run.phone.assumption}\n${JSON.stringify(run.costs, null, 2)}`);
} finally { await browser?.close(); server?.close(); exported?.cleanup(); }
