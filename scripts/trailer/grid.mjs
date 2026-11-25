// The grid as players see it (meta ALPHA-2-TRAILER AT15; Jake, 2026-11-25: a trailer shot "in magic 'single zone' mode
// which doesnt exist on staging" is wrong). A trailer page comes in through the title's MMO card, the way a player does,
// then stands in its shot's cell: capture.mjs and party.mjs both boot this way, and `?chunk=` is only for a shot that
// says singleZone: true (shots/lib.mjs bootUrl).

/** Into the world from the title's MMO card, the way a player comes in; throws the page's own error card.
 * @param {import('playwright').Page} page @param {string} url the title (bootUrl's grid url) */
export async function enterGrid(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }); // the title, not skipintro: its MMO card is the way in
  await page.locator('.ws-main-grid').click({ timeout: 120000 });
}

/** The cells to walk through from one cell to another, neighbour by neighbour (4-way, over cells the grid has), ending at
 * the target; [] when already there. @param {readonly { instance: string, cell: readonly number[] }[]} cells
 * @param {string} from @param {string} to @returns {string[]} */
export function route(cells, from, to) {
  const at = new Map(cells.map((c) => [`${c.cell[0]},${c.cell[1]}`, c.instance])), where = new Map(cells.map((c) => [c.instance, c.cell]));
  if (!where.has(from) || !where.has(to)) throw new Error(`route: ${where.has(from) ? to : from} is not a cell of this grid`);
  /** @type {Map<string, string | null>} */
  const prev = new Map([[from, null]]), queue = [from];
  while (queue.length > 0) {
    const id = /** @type {string} */ (queue.shift());
    if (id === to) break;
    const [x, z] = /** @type {readonly number[]} */ (where.get(id));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = at.get(`${x + dx},${z + dz}`);
      if (next !== undefined && !prev.has(next)) { prev.set(next, id); queue.push(next); }
    }
  }
  if (!prev.has(to)) throw new Error(`route: no way from ${from} to ${to}`);
  const path = [];
  for (let id = to; id !== from; id = /** @type {string} */ (prev.get(id))) path.unshift(id);
  return path;
}

/** Stand in `zone`'s cell of the grid, as a player who walked there: its runtime entered and ready, its neighbours streaming
 * at the edges. Render coordinates are then that cell's own (grid/live.ts worldFeet: the active cell's origin), so a shot's
 * poses and rig keys stay in its zone's coordinates. The way in is a player's, one neighbour at a time (route): step off the
 * current cell onto the seam road toward the next (the grid commits a crossing from the neutral road) and walk in over the
 * seam (a pose never crosses into a cell; on 11-25 one held the player on the road). Then the player is set down at the
 * cell's (0, 0). @param {import('playwright').Page} page @param {string} zone */
export async function enterCell(page, zone) {
  const at = () => page.evaluate(() => { const l = window.__wildshard.shard.grid.state().live.live; return { current: l.current, ready: l.gameplayReady, pending: l.pending, feet: l.worldFeet }; });
  if (await page.evaluate(() => window.__wildshard.world.hud.paused)) await page.keyboard.press('Escape');
  const grid = await page.evaluate(() => { const s = window.__wildshard.shard.grid.state(); return { pitch: s.pitch, current: s.live.live.current, cells: s.cells.map((c) => ({ instance: c.instance, cell: c.cell })) }; });
  if (grid.current === zone) { await skipReveal(page); return; }
  if (grid.current === null) throw new Error(`enterCell ${zone}: the player is on the road, not in a cell`);
  const cellOf = new Map(grid.cells.map((c) => [c.instance, c.cell])), half = grid.pitch / 2;
  let here = grid.current;
  const say = (/** @type {string} */ line) => { if (process.env.WS_TRAILER_TRACE === '1') console.log(`[enterCell] ${line} ${JSON.stringify(Date.now())}`); };
  for (const next of route(grid.cells, here, zone)) {
    const a = /** @type {readonly number[]} */ (cellOf.get(here)), b = /** @type {readonly number[]} */ (cellOf.get(next));
    const dir = { x: b[0] - a[0], z: b[1] - a[1] }, seam = { x: a[0] * grid.pitch + dir.x * half, z: a[1] * grid.pitch + dir.z * half };
    const yaw = Math.atan2(-dir.x, -dir.z); // Player.ts: forward = (-sin yaw, -cos yaw)
    // onto the seam road: render = world - the current cell's origin
    await page.evaluate(async ({ p, y }) => {
      const api = window.__wildshard, l = api.shard.grid.state().live.live, q = api.requireWorld().player.position;
      await api.pose({ x: p.x - (l.worldFeet.x - q.x), z: p.z - (l.worldFeet.z - q.z), y: 1, yaw: y, pitch: 0 });
    }, { p: seam, y: yaw });
    say(`${here} → road ${JSON.stringify(seam)}`);
    await page.waitForFunction(() => window.__wildshard.shard.grid.state().live.live.current === null, null, { timeout: 120000, polling: 250 });
    say(`on the road ${JSON.stringify(await at())}`);
    // walk on over the seam the way a player does, forward held and facing the next cell, until the grid has committed
    // the crossing. Not walkLeg: its waypoint is in render coordinates, which jump to the new cell's own at the seam, and
    // it stops counting time while the page is paused or loading, so a crossing that loads never ends it (11-25).
    await page.evaluate((y) => {
      const w = window.__wildshard.requireWorld(), input = w.game.app.input;
      const stop = w.game.watchFrames(() => { if (!w.hud.paused) { w.player.yaw = y; input.setHeld('move.forward', true); } });
      /** @type {Window & { trailerWalkStop?: () => void }} */ (window).trailerWalkStop = () => { stop(); input.clear(); };
    }, yaw);
    try {
      await page.waitForFunction((z) => document.querySelector('.ws-load') !== null || window.__wildshard?.shard?.grid?.state?.()?.live?.live?.current === z, next, { timeout: 60000, polling: 100 });
    } finally {
      await page.evaluate(() => { try { /** @type {Window & { trailerWalkStop?: () => void }} */ (window).trailerWalkStop?.(); } catch { /* the world went with a load */ } }).catch(() => undefined);
    }
    say(`walked ${JSON.stringify(await at().catch(() => 'loading'))}`);
    // a crossing can take the page through the zone's loading screen (no grid state while it loads): wait it out, and
    // step into the world again if it stops at the enter button
    await page.waitForFunction((z) => {
      const api = window.__wildshard, w = api?.world;
      if (w?.hud && !w.hud.entered && !document.querySelector('.ws-load')) { try { api.requireWorld().hud.enterNow(); } catch { /* not ready to enter */ } }
      const l = api?.shard?.grid?.state?.()?.live?.live;
      return Boolean(l && w?.hud?.entered && !document.querySelector('.ws-load') && l.current === z && l.gameplayReady && l.pending.length === 0 && l.residents.includes(z));
    }, next, { timeout: 300000, polling: 500 }).catch(async (/** @type {unknown} */ e) => {
      let state = 'no grid state';
      try { state = JSON.stringify(await at()); } catch { /* mid-load: the grid has no state */ }
      throw new Error(`enterCell ${zone}: no way into ${next}: ${state} (${String(e)})`);
    });
    if (await page.evaluate(() => window.__wildshard.world.hud.paused)) await page.keyboard.press('Escape');
    here = next;
  }
  await skipReveal(page);
  await page.evaluate(() => window.__wildshard.pose({ x: 0, z: 0, yaw: 0, pitch: 0 }));
}

/** End the grid's arrival reveal (grid/reveal.ts: the sky-down camera and its "Arriving at" card play on entering the grid
 * and again when a crossing reloads the page) the way a player does, with a touch, so no shot opens on it.
 * @param {import('playwright').Page} page */
export async function skipReveal(page) {
  await page.waitForFunction(() => {
    if (document.querySelector('.ws-grid-reveal') === null && document.querySelector('.ws-grid-revealing') === null) return true;
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return false;
  }, null, { timeout: 60000, polling: 250 });
}
