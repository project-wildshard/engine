#!/usr/bin/env node
// N3, N4: what a save survives on a page whose world lives in a worker. Each step raises a flag only the save under test can hold, then ends
// the page the way a player does, and reads the flag back off a fresh boot in the same profile.
//   kill     hide the page, then SIGKILL the whole browser `delays` ms later: the nearest a desktop gets to iOS killing a hidden tab
//   timer    no hide at all: a kill with no warning keeps what the last timer's save held, and no more
//   exit     Exit to Title, then a fresh entry
//   travel   a shard switch, then the road back
//   import   a page file from before the flip, through Settings' own file input
//   scripts/browser-lane.sh node scripts/worker-client-saves.mjs --base=http://127.0.0.1:4401/ [--chunk=driftwood-isle | --grid] [--delays=0,20,50,100,200,500,1000] [--only=kill,exit] [--continuation=file --flag=name]
// Chromium only: a phone kills a tab on its own terms, and WebKit's half is the flip lane's.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { floorGridBenchmarkUrl, FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', ''), chunk = arg('chunk', 'driftwood-isle'), delays = arg('delays', '0,20,50,100,200,500,1000').split(',').map(Number), only = arg('only', 'kill,timer,exit,travel,import').split(',');
if (base === '') throw new Error('Requires --base');
const url = (slug = chunk, query = '') => process.argv.includes('--grid') ? floorGridBenchmarkUrl(base) : new URL(`/?chunk=${slug}&mute=1&nolock=1${query}`, base).href;

/** A real browser on a profile that outlives it, its whole process tree ours to kill. */
async function launch(profile) {
  const context = await chromium.launchPersistentContext(profile, { args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'], viewport: { width: 402, height: 874 } });
  const page = context.pages()[0] ?? await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message.slice(0, 200)); });
  return { context, page, errors, kill: () => { spawnSync('pkill', ['-9', '-f', profile]); return new Promise(resolve => { setTimeout(resolve, 500); }); } };
}
const seed = async context => {
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'device', key: 'debug.workerClient', data: 'on' });
};
async function enter(page, at = url()) {
  await page.goto(at, { waitUntil: 'load' });
  if (process.argv.includes('--grid')) { // a grid page stops at its title until the card is pressed
    await page.locator('.ws-main-grid').click({ timeout: 60_000 });
    await page.waitForFunction(() => window.__wildshard?.shard?.grid?.state().live?.live?.gameplayReady, undefined, { timeout: 90_000 });
  } else await page.waitForFunction(() => window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => window.__workerClient().frames > 30 && window.__workerClient().flags !== undefined, undefined, { timeout: 60_000 });
}
const flags = page => page.evaluate(() => window.__workerClient().flags);
/** Raise a flag on the server and see it come back on the wire, so the next save has it and no earlier one does. */
async function mark(page, flag) {
  await page.evaluate(name => { window.__workerClientFlag(name); }, flag);
  await page.waitForFunction(name => window.__workerClient().flags.includes(name), flag, { timeout: 10_000 });
}
/** What a phone's hide does to this page. Headless Chromium never hides a tab, so the same listeners hear it through the same event. */
const hide = page => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const pass = (name, ok, note) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(note).slice(0, 400)}`); return ok; };
const results = [];

if (only.includes('kill')) {
  // The first boot only makes the world and its timer's first save: it must not be what a later round reads.
  for (const delay of delays) {
    const profile = mkdtempSync(join(tmpdir(), 'ws-save-kill-')), flag = `n3.kill.${delay}`;
    try {
      const first = await launch(profile);
      await seed(first.context); await enter(first.page);
      await first.page.evaluate(() => window.__workerClientSave());
      await mark(first.page, flag);
      const before = await first.page.evaluate(() => window.__workerClient().savedTick);
      await hide(first.page);
      await new Promise(resolve => { setTimeout(resolve, delay); });
      await first.kill();
      const second = await launch(profile);
      await enter(second.page);
      await second.page.waitForTimeout(1500);
      const kept = (await flags(second.page)).includes(flag), report = await second.page.evaluate(() => window.__workerClient());
      results.push({ delay, kept, restored: report.restored });
      console.log(`kill ${delay} ms after the hide: ${kept ? 'kept' : 'LOST'} (restored ${String(report.restored)}, saved tick before ${String(before)})`);
      await second.kill();
    } finally { rmSync(profile, { recursive: true, force: true }); }
  }
  const landed = results.filter(row => row.kept).map(row => row.delay);
  pass('a hide\'s save outruns a kill', landed.includes(Math.max(...delays)), { landed, delays });
}

if (only.includes('timer')) {
  const profile = mkdtempSync(join(tmpdir(), 'ws-save-timer-'));
  try {
    const first = await launch(profile);
    await seed(first.context); await enter(first.page);
    await first.page.evaluate(() => window.__workerClientSave());
    await mark(first.page, 'n3.unwarned');
    await first.kill();
    const second = await launch(profile);
    await enter(second.page); await second.page.waitForTimeout(1500);
    const kept = (await flags(second.page)).includes('n3.unwarned');
    pass('a kill with no warning loses what came after the last save, and only that', !kept, { kept, restored: await second.page.evaluate(() => window.__workerClient().restored) });
    await second.kill();
  } finally { rmSync(profile, { recursive: true, force: true }); }
}

if (only.includes('exit') || only.includes('travel') || only.includes('import')) {
  const profile = mkdtempSync(join(tmpdir(), 'ws-save-leave-')), session = await launch(profile), { page, context } = session;
  await seed(context); await enter(page);
  try {
    if (only.includes('exit')) {
      await mark(page, 'n3.exit');
      // The title is a new document, not a new address: a grid page is already at `/`. Going on before it lands would end the page Exit is holding.
      const started = Date.now();
      await page.evaluate(() => { window.__leaving = true; window.__wildshard.world.hud.onExitToMain(); });
      await page.waitForFunction(() => window.__leaving === undefined, undefined, { timeout: 15_000 });
      const asked = Date.now() - started;
      await enter(page); await page.waitForTimeout(1500);
      pass('Exit to Title saves', (await flags(page)).includes('n3.exit'), { asked, flags: (await flags(page)).filter(flag => flag.startsWith('n3.')) });
    }
    if (only.includes('travel')) {
      const other = arg('other', 'pine-hollow');
      await mark(page, 'n3.travel');
      await page.evaluate(to => { window.__workerClientTravel(to); }, other);
      await page.waitForURL(address => address.search.includes(other), { timeout: 15_000 });
      await page.waitForFunction(() => typeof window.__workerClient === 'function', undefined, { timeout: 150_000 });
      await enter(page); await page.waitForTimeout(1500);
      pass('a shard switch saves', (await flags(page)).includes('n3.travel'), { flags: (await flags(page)).filter(flag => flag.startsWith('n3.')) });
    }
    if (only.includes('import')) {
      // A page's own export, as a player who kept one from before the flip holds it: this page's flags book, in the page file's shape.
      // A data shard's page saved a logical continuation instead: --continuation= is one, and --flag= one of its flags.
      const held = arg('continuation', ''), continuation = held === '' ? null : JSON.parse(readFileSync(held, 'utf8'));
      const file = await page.evaluate(([level, saved]) => JSON.stringify({ format: 'wildshard.save', version: 2, build: 'before-the-flip', exported: new Date(0).toISOString(), docs: { [level]: { keys: saved === null ? { flags: { v: 1, data: ['n4.imported'] } } : { 'platform.continuation': { v: 1, data: saved } } } } }), [chunk, continuation]);
      await page.keyboard.press('Escape'); await page.waitForTimeout(1000); // Settings builds its save panel when it opens
      const shown = await page.evaluate(async json => {
        const picker = [...document.querySelectorAll('input[type=file]')].find(node => /json/u.test(node.accept));
        if (picker === undefined) return { error: 'no picker' };
        const data = new DataTransfer(); data.items.add(new File([json], 'old.json', { type: 'application/json' })); picker.files = data.files; picker.dispatchEvent(new Event('change'));
        await new Promise(resolve => { setTimeout(resolve, 1500); });
        return { status: picker.parentElement?.textContent?.slice(0, 300) };
      }, file);
      await enter(page); await page.waitForTimeout(1500);
      const wanted = arg('flag', 'n4.imported');
      pass('a file from before the flip imports and the next boot holds it', (await flags(page)).includes(wanted), { shown, flags: (await flags(page)).slice(0, 8) });
    }
    if (session.errors.length > 0) pass('no page error', false, session.errors.slice(0, 4));
  } finally { await session.kill(); rmSync(profile, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ gate: 'worker-client-saves', results }));
process.exit(0);
