/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { chromium, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

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
export const observed = page => page.evaluate(() => {
  const w = /** @type {WorkerWindow} */ (window), g = w.__wildshard.shard.grid.state(), r = w.__workerClient();
  const live = g.live?.live, server = r.cell === 0 ? null : g.cells[r.cell - 1]?.instance;
  return { home: g.home, inside: g.inside, board: g.cellLoading, current: live?.current, server,
    ready: live?.gameplayReady, phase: g.live?.crossing.phase, issue: g.live?.crossing.issue,
    x: r.x, z: r.z, serverX: r.serverX, serverZ: r.serverZ, restored: r.restored, saved: r.savedOk, runtimeTiming:g.live?.runtimeTiming,pendingWork:live?.pendingWork,issues:live?.issues,
    frames: r.frames, closed: r.closed };
});

/** Exercise the actual trusted title control, with its navigation listener armed first.
 * @param {import('playwright').Page} page */
async function tapGrid(page) {
  await Promise.all([page.waitForEvent('domcontentloaded', { timeout: 60_000 }), page.locator('.ws-main-grid').click()]);
}

/** Real movement in world coordinates through the two public road legs, never a forced travel or readiness event.
 * @param {import('playwright').Page} page @param {number} x @param {number} z */
export async function walk(page, x, z) {
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
export async function entered(page) {
  await page.bringToFront();
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.hud !== undefined, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => typeof (/** @type {WorkerWindow} */ (window)).__workerClient === 'function', undefined, { timeout: 150_000 });
  const resumed = await page.evaluate(() => {
    const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard;
    const before = world.game.app.state;
    world.hud.setPaused(false);
    return { before, after: world.game.app.state, paused: world.game.app.clock.paused };
  });
  if (resumed.after === 'loading' && resumed.paused) throw new Error(`Resume restored the loader: ${JSON.stringify(resumed)}`);
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30
    || document.documentElement.dataset.wsState === 'error', undefined, { timeout: 150_000 });
  const fault = await page.evaluate(() => document.documentElement.dataset.wsState === 'error' ? document.querySelector('#wserr .msg')?.textContent : null);
  if (fault) throw new Error(fault);
}

/** @param {import('playwright').Page} page @param {string} instance */
export async function settled(page, instance) {
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
  // A crash proof owns a persistent browser. An otherwise unused outer browser
  // must not consume a second shared browser slot for this single-flow run.
  if (process.argv.includes('--only=grid-entry')) await _browser.close();
  const scratch = process.env.WS_PROOF_SCRATCH;
  if (scratch === undefined) throw new Error('grid-entry requires WS_PROOF_SCRATCH outside the repository');
  const profile = await mkdtemp(join(resolve(scratch), 'grid-entry-'));
  const engine = process.argv.includes('--webkit') ? webkit : chromium;
  const options = { ...phone, ...engine === webkit ? {} : { args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] } };
  let context = await engine.launchPersistentContext(profile, options);
  const errors = /** @type {string[]} */ ([]);
  let phase = 'entry';
  let page = context.pages()[0] ?? await context.newPage();
  const watch = () => { const watched = page; watched.on('pageerror', error => { errors.push(error.message); console.log('grid-entry pageerror', JSON.stringify({ phase, url: watched.url(), name: error.name, message: error.message, stack: error.stack })); }); };
  watch();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  const url = new URL('/?mute=1&nolock=1&sw=0', base).href;
  const homeOnly = process.env.WS_GRID_HOME_CRASH === '1', ember = homeOnly ? 'driftwood-isle' : 'open-plot-4-1';
  const destination = homeOnly ? 'Driftwood home control' : 'Ember Forge';
  const coldCache = process.env.WS_GRID_COLD_CACHE !== '0';
  /** @type {Awaited<ReturnType<typeof observed>> | null} */
  let stood = null;
  try {
    await page.goto(url);
    await page.locator('.ws-main-grid').waitFor({ timeout: 60_000 }); await tapGrid(page);
    await entered(page);
    await step(`grid-entry: real entry reaches ${destination} and closes its board`, async () => {
      if (!homeOnly) { await walk(page, 0, -281.25); await walk(page, 1125, -281.25); await walk(page, 1125, -390); }
      const out = await settled(page, ember);
      return { ok: out.board === null && out.server === ember && out.current === ember && out.ready === true, ...out };
    });
    await step(`grid-entry: a GRID tap resumes the saved ${destination} pose${coldCache ? ' after forced byte-cache deletion' : ''}`, async () => {
      phase = 'cold-return';
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
      stood = await observed(page);
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__wildshard.world.hud.setPaused(true));
      phase = 'exit-to-title';
      await page.getByText('Exit to main', { exact: true }).click();
      await page.locator('.ws-main-grid').waitFor({ timeout: 60_000 });
      phase = 'title';
      // Remove disposable immutable bytes only; leave both actual save stores.
      // WS_GRID_COLD_CACHE=0 is the ordinary-cache comparison control.
      if (coldCache) await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
      phase = 'grid-tap'; await tapGrid(page);
      await entered(page);
      phase = 'playing';
      const out = await settled(page, ember), away = Math.hypot(out.serverX - stood.serverX, out.serverZ - stood.serverZ);
      return { ok: stood.saved && out.restored && out.closed === null && away < 3 && out.board === null, away, ...out };
    });
    // Optional diagnostic: the normal entry proof must stay distinct from
    // the separately reproduced process-crash recovery failure.
    if (process.env.WS_GRID_CRASH === '1') await step('grid-entry: a real browser process crash resumes the durable cell and closes its board', async () => {
      phase = 'crash-save';
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
      stood = await observed(page);
      if (!stood.saved || stood.server !== ember) throw new Error(`Crash requires an acknowledged Ember save: ${JSON.stringify(stood)}`);
      console.log('grid-entry pre-crash stores', await page.evaluate(() => Object.keys(localStorage).flatMap(key => {
        try { const keys = JSON.parse(localStorage.getItem(key) ?? 'null')?.keys;
          return Object.entries(keys ?? {}).filter(([name]) => name === 'grid.last-played' || name === 'platform.grid-position').map(([name, entry]) => {
            const data = entry?.data; return { key, name, instance: data?.instance, location: data?.location, road: data?.road };
          });
        } catch { return []; }
      })));
      await page.waitForTimeout(10_000); // Include the normal alive beat and the browser's page-store flush.
      phase = 'process-kill';
      const disconnected = context.waitForEvent('close'); crashBrowser(profile); await disconnected;
      phase = 'restart';
      context = await engine.launchPersistentContext(profile, options);
      console.log('grid-entry restarted pages', context.pages().map(candidate => candidate.url()));
      page = context.pages()[0] ?? await context.newPage(); watch(); await page.goto(url);
      // SF21a deliberately leaves an unrecorded process loss on the renderer-free
      // title. Use the actual offered GRID tap; never manufacture recovery data.
      await page.waitForFunction(() => {
        const load = document.querySelector('.ws-load');
        return (document.querySelector('.ws-main-grid')?.getClientRects().length ?? 0) > 0
          || document.documentElement.dataset.wsState === 'error'
          || (typeof (/** @type {WorkerWindow} */ (window)).__workerClient === 'function' && (load === null || load.classList.contains('hide')));
      }, undefined, { timeout: 150_000 });
      console.log('grid-entry post-restart stores', JSON.stringify(await page.evaluate(() => Object.keys(localStorage).flatMap(key => {
        try { const keys = JSON.parse(localStorage.getItem(key) ?? 'null')?.keys;
          return Object.entries(keys ?? {}).filter(([name]) => name === 'grid.last-played' || name === 'platform.grid-position').map(([name, entry]) => {
            const data = entry?.data; return { key, name, instance: data?.instance, location: data?.location?.kind, road: data?.road, at: data?.at };
          });
        } catch { return []; }
      }))));
      const ends = await page.evaluate(() => Object.keys(localStorage).map(key => {
        try { return JSON.parse(localStorage.getItem(key) ?? 'null')?.keys?.['life.lastEnd']?.data ?? null; } catch { return null; }
      }).filter(end => end !== null));
      const viaTitle = await page.locator('.ws-main-grid').isVisible();
      if (viaTitle) await tapGrid(page);
      try { await entered(page); }
      catch (error) { return { ok: false, error: String(error), diagnostic: await page.evaluate(() => {
        const w = /** @type {WorkerWindow} */ (window);
        const world = w.__wildshard?.world, g = w.__wildshard?.shard?.grid?.state(), r = w.__workerClient?.();
        const load = document.querySelector('.ws-load');
        return { visibility: document.visibilityState, focus: document.hasFocus(), url: location.href,
          gates: world === undefined ? null : { paused: world.hud.paused, entered: world.hud.entered, hold: world.game.hold,
            frame: world.game.frameGate(), clock: world.game.app.clock.paused, still: world.game.app.ui.still },
          grid: { home: g?.home, inside: g?.inside, board: g?.cellLoading, current: g?.live?.live.current,
            ready: g?.live?.live.gameplayReady, feet: g?.live?.live.worldFeet, phase: g?.live?.crossing.phase, issue: g?.live?.crossing.issue },
          worker: r === undefined ? null : { frames: r.frames, cell: r.cell, closed: r.closed, restored: r.restored, x: r.serverX, z: r.serverZ,
            latest: (() => { const link = world?.player.link; const latest = link == null ? null : Reflect.get(link, 'client')?.latest; return latest == null ? null : { cell: latest.cell, tick: latest.tick, site: g?.cells[latest.cell - 1]?.instance ?? null }; })() },
          loading: { step: load instanceof HTMLElement ? load.dataset.step : undefined, text: load?.textContent?.slice(-500) },
          state: world?.game.app.state, title: document.querySelector('.ws-main-grid') !== null,
          fault: document.querySelector('#wserr .msg')?.textContent,
          errors: [...document.querySelectorAll('pre')].map(node => node.textContent?.slice(0, 300)) };
      }) }; }
      const out = await settled(page, ember), away = Math.hypot(out.serverX - stood.serverX, out.serverZ - stood.serverZ);
      return { ok: out.restored && out.closed === null && away < 3 && out.board === null && ends.some(end => end?.kind === 'unexpected' && end?.mode === 'grid'), viaTitle, away, ends, ...out };
    });
    await step('grid-entry: no uncaught page error', async () => ({ ok: errors.length === 0, errors,
      lifecycle: await page.evaluate(() => Object.keys(localStorage).map(key => {
        try { const keys = JSON.parse(localStorage.getItem(key) ?? 'null')?.keys; return { end: keys?.['life.lastEnd']?.data, place: keys?.['grid.last-played']?.data }; } catch { return null; }
      }).filter(row => row !== null && (row.end !== undefined || row.place !== undefined))) }));
  } finally { await context.close().catch(() => { /* Already dead only when the proof itself terminated it. */ }); await rm(profile, { recursive: true }); }
}

/** The real recovery URL enters paused; RESUME must restore play rather than the completed loader.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function recoveryMenu(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0&glreload=1', base).href);
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.hud !== undefined
      && typeof (/** @type {WorkerWindow} */ (window)).__workerClient === 'function', undefined, { timeout: 150_000 });
    await page.waitForFunction(() => document.querySelector('.ws-load') === null || document.querySelector('.ws-load')?.classList.contains('hide'), undefined, { timeout: 150_000 });
    await step('recovery-menu: RESUME restores play and the real fixed clock', async () => {
      const state = await page.evaluate(() => {
        const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard;
        const before = { state: world.game.app.state, paused: world.hud.paused, clock: world.game.app.clock.paused };
        world.hud.setPaused(false);
        return { before, after: { state: world.game.app.state, paused: world.hud.paused, clock: world.game.app.clock.paused } };
      });
      await page.waitForTimeout(1200);
      const frames = await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClient().frames);
      return { ok: state.before.state === 'paused' && state.before.paused && state.before.clock && state.after.state === 'play'
        && !state.after.paused && !state.after.clock && frames > 10, ...state, frames };
    });
  } finally { await context.close(); }
}
