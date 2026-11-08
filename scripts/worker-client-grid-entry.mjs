/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { chromium, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Terminate only the browser launched on this proof's unique fresh profile. No pagehide or fake lifecycle record.
 * @param {string} profile */
function crashBrowser(profile) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    return { pid: Number(match?.[1]), parent: Number(match?.[2]), command: match?.[3] ?? '' };
  });
  const matched = rows.filter(row => row.command.includes(`--user-data-dir=${profile}`) && row.command.includes('/ms-playwright/'));
  const roots = matched.filter(row => !matched.some(parent => parent.pid === row.parent));
  if (roots.length !== 1 || roots[0] === undefined) throw new Error('Proof browser profile has no unique process owner');
  const owned = new Set([roots[0].pid]);
  for (let size = -1; size !== owned.size;) { size = owned.size; for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid); }
  for (const pid of owned) {
    try { process.kill(pid, 'SIGKILL'); }
    catch (error) { if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ESRCH') throw error; }
  }
}

/** @param {import('playwright').Page} page */
const observed = page => page.evaluate(() => {
  const w = /** @type {WorkerWindow} */ (window), g = w.__wildshard.shard.grid.state(), r = w.__workerClient();
  const live = g.live?.live, server = r.cell === 0 ? null : g.cells[r.cell - 1]?.instance;
  return { home: g.home, inside: g.inside, board: g.cellLoading, current: live?.current, server,
    ready: live?.gameplayReady, phase: g.live?.crossing.phase, issue: g.live?.crossing.issue,
    x: r.x, z: r.z, serverX: r.serverX, serverZ: r.serverZ, restored: r.restored, saved: r.savedOk,
    frames: r.frames, closed: r.closed };
});

/** Real movement in world coordinates through the two public road legs, never a forced travel or readiness event.
 * @param {import('playwright').Page} page @param {number} x @param {number} z */
async function walk(page, x, z) {
  const until = Date.now() + 210_000;
  let away = Infinity;
  while (Date.now() < until) {
    away = await page.evaluate(([tx, tz]) => {
      const w = /** @type {WorkerWindow} */ (window), { player } = w.__wildshard.world, feet = w.__wildshard.shard.grid.state().live?.live.worldFeet;
      if (feet === undefined) return Infinity;
      player.yaw = Math.atan2(feet.x - tx, feet.z - tz); player.touchMove.y = 1; player.touchSprint = true;
      return Math.hypot(feet.x - tx, feet.z - tz);
    }, [x, z]);
    if (away < 5) break;
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => { const p = (/** @type {WorkerWindow} */ (window)).__wildshard.world.player; p.touchMove.y = 0; p.touchSprint = false; });
  if (away >= 5) throw new Error(`Road leg ${x},${z} stopped ${away.toFixed(1)} m away: ${JSON.stringify(await observed(page))}`);
}

/** @param {import('playwright').Page} page */
async function entered(page) {
  await page.bringToFront();
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.hud !== undefined, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => typeof (/** @type {WorkerWindow} */ (window)).__workerClient === 'function', undefined, { timeout: 150_000 });
  await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__wildshard.world.hud.setPaused(false));
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 150_000 });
}

/** @param {import('playwright').Page} page @param {string} instance */
async function settled(page, instance) {
  await page.waitForFunction(id => {
    const w = /** @type {WorkerWindow} */ (window), g = w.__wildshard?.shard?.grid?.state(), r = w.__workerClient?.();
    return g?.live?.live.current === id && g.inside === id && g.live.live.gameplayReady
      && g.cellLoading === null && r !== undefined && g.cells[r.cell - 1]?.instance === id;
  }, instance, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  return observed(page);
}

/** SR4: real road entry, title tap on the actual durable worker save, and abrupt target replacement.
 * @param {import('playwright').Browser} _browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function gridEntry(_browser, phone, base, step) {
  const scratch = process.env.WS_PROOF_SCRATCH;
  if (scratch === undefined) throw new Error('grid-entry requires WS_PROOF_SCRATCH outside the repository');
  const profile = await mkdtemp(join(resolve(scratch), 'grid-entry-'));
  const engine = process.argv.includes('--webkit') ? webkit : chromium;
  const options = { ...phone, ...engine === webkit ? {} : { args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] } };
  let context = await engine.launchPersistentContext(profile, options);
  const errors = /** @type {string[]} */ ([]);
  let page = context.pages()[0] ?? await context.newPage();
  const watch = () => { page.on('pageerror', error => { errors.push(error.message); }); };
  watch();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  const url = new URL('/?mute=1&nolock=1&sw=0', base).href;
  const ember = 'open-plot-4-1';
  /** @type {Awaited<ReturnType<typeof observed>> | null} */
  let stood = null;
  try {
    await page.goto(url);
    await page.locator('.ws-main-grid').click({ timeout: 60_000 });
    await entered(page);
    await step('grid-entry: real road travel enters Ember Forge and closes its board', async () => {
      await walk(page, 0, -281.25); await walk(page, 1125, -281.25); await walk(page, 1125, -390);
      const out = await settled(page, ember);
      return { ok: out.board === null && out.server === ember && out.current === ember && out.ready === true, ...out };
    });
    await step('grid-entry: a GRID tap resumes the saved Ember Forge pose with a cold byte cache', async () => {
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
      stood = await observed(page);
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__wildshard.world.hud.setPaused(true));
      await page.getByText('Exit to main', { exact: true }).click();
      await page.locator('.ws-main-grid').waitFor({ timeout: 60_000 });
      // Remove disposable immutable bytes only; the real localStorage and worker IndexedDB save stores remain.
      await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
      await page.locator('.ws-main-grid').click();
      await entered(page);
      const out = await settled(page, ember), away = Math.hypot(out.serverX - stood.serverX, out.serverZ - stood.serverZ);
      return { ok: stood.saved && out.restored && out.closed === null && away < 3 && out.board === null, away, ...out };
    });
    // Optional diagnostic: the normal entry proof must stay distinct from
    // the separately reproduced process-crash recovery failure.
    if (process.env.WS_GRID_CRASH === '1') await step('grid-entry: a real browser process crash resumes the durable cell and closes its board', async () => {
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
      stood = await observed(page);
      await page.waitForTimeout(3500); // The normal alive beat must exist before an abrupt target close.
      const disconnected = context.waitForEvent('close'); crashBrowser(profile); await disconnected;
      context = await engine.launchPersistentContext(profile, options);
      page = context.pages()[0] ?? await context.newPage(); watch(); await page.goto(url);
      try { await entered(page); }
      catch (error) { return { ok: false, error: String(error), diagnostic: await page.evaluate(() => {
        const w = /** @type {WorkerWindow} */ (window);
        return { text: document.body.textContent?.slice(0, 2400), grid: w.__wildshard?.shard?.grid?.state(), worker: w.__workerClient?.() };
      }) }; }
      const out = await settled(page, ember), away = Math.hypot(out.serverX - stood.serverX, out.serverZ - stood.serverZ);
      const ends = await page.evaluate(() => Object.keys(localStorage).map(key => {
        try { return JSON.parse(localStorage.getItem(key) ?? 'null')?.keys?.['life.lastEnd']?.data ?? null; } catch { return null; }
      }).filter(end => end !== null));
      return { ok: out.restored && out.closed === null && away < 3 && out.board === null && ends.some(end => end?.kind === 'unexpected' && end?.mode === 'grid'), away, ends, ...out };
    });
    await step('grid-entry: no uncaught page error', async () => ({ ok: errors.length === 0, errors,
      lifecycle: await page.evaluate(() => Object.keys(localStorage).map(key => {
        try { const keys = JSON.parse(localStorage.getItem(key) ?? 'null')?.keys; return { end: keys?.['life.lastEnd']?.data, place: keys?.['grid.last-played']?.data }; } catch { return null; }
      }).filter(row => row !== null && (row.end !== undefined || row.place !== undefined))) }));
  } finally { await context.close().catch(() => { /* Already dead only when the proof itself terminated it. */ }); await rm(profile, { recursive: true }); }
}
