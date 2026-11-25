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

/** Stand in `zone`'s cell of the grid, as a player who walked there: its runtime entered and ready, its neighbours streaming
 * at the edges. Render coordinates are then that cell's own (grid/live.ts worldFeet: the active cell's origin), so a shot's
 * poses and rig keys stay in its zone's coordinates. The way in is a player's: step off the current cell onto the seam
 * road (the grid commits a crossing from the neutral road), along the road to the gap west of the cell (or east, for a
 * cell on the grid's west edge), and walk in over the seam (a pose never crosses into a cell; on 11-25 it held the player
 * on the road). Then the player is set down at the cell's (0, 0).
 * @param {import('playwright').Page} page @param {string} zone */
export async function enterCell(page, zone) {
  const at = () => page.evaluate(() => { const l = window.__wildshard.shard.grid.state().live.live; return { current: l.current, ready: l.gameplayReady, pending: l.pending, feet: l.worldFeet }; });
  if (await page.evaluate(() => window.__wildshard.world.hud.paused)) await page.keyboard.press('Escape');
  if ((await at()).current === zone) return;
  /** the road points in grid (world) coordinates: the current cell's seam toward the target, and the gap beside the target */
  const plan = await page.evaluate((z) => {
    const s = window.__wildshard.shard.grid.state(), l = s.live.live, half = s.pitch / 2;
    const origin = (/** @type {string} */ id) => { const c = s.cells.find((x) => x.instance === id); return c && { x: c.cell[0] * s.pitch, z: c.cell[1] * s.pitch }; }; // grid/assembly.ts
    const to = origin(z);
    if (!to) throw new Error(`enterCell: ${z} is not a cell of this grid`);
    const from = l.current === null ? { x: l.worldFeet.x, z: l.worldFeet.z } : origin(l.current);
    const west = s.cells.some((c) => c.cell[0] * s.pitch < to.x), side = west ? -1 : 1; // come in from a side that has a road gap
    return { off: { x: from.x + Math.sign(to.x - from.x || 1) * half, z: from.z }, gap: { x: to.x + side * half, z: to.z }, into: { x: to.x + side * (half - 45), z: to.z } };
  }, zone);
  // render = world - the active cell's origin; on the road (no active cell) render is world
  const pose = (/** @type {{ x: number, z: number }} */ w, /** @type {number} */ yaw) => page.evaluate(async ({ p, yaw: a }) => {
    const api = window.__wildshard, l = api.shard.grid.state().live.live, q = api.requireWorld().player.position;
    await api.pose({ x: p.x - (l.worldFeet.x - q.x), z: p.z - (l.worldFeet.z - q.z), y: 1, yaw: a, pitch: 0 });
  }, { p: w, yaw });
  const road = () => page.waitForFunction(() => window.__wildshard.shard.grid.state().live.live.current === null, null, { timeout: 120000, polling: 250 });
  const facing = Math.atan2(-(plan.into.x - plan.gap.x), -(plan.into.z - plan.gap.z)); // Player.ts: forward = (-sin yaw, -cos yaw)
  if ((await at()).current !== null) { await pose(plan.off, facing); await road(); }
  await pose(plan.gap, facing);
  await page.evaluate(async ({ g, i, yaw }) => {
    await window.__wildshard.walkLeg({ name: 'enter', start: { x: g.x, z: g.z, yaw }, waypoints: [{ x: i.x, z: i.z }], timeout: 12, stuckSeconds: 4 });
  }, { g: plan.gap, i: plan.into, yaw: facing });
  // a crossing can take the page through the zone's loading screen (the grid's state is gone while it loads): wait it out,
  // and step into the world again if it stops at the enter button
  await page.waitForFunction((z) => {
    const api = window.__wildshard, w = api?.world;
    if (w?.hud && !w.hud.entered && !document.querySelector('.ws-load')) { try { api.requireWorld().hud.enterNow(); } catch { /* not ready to enter */ } }
    const l = api?.shard?.grid?.state?.()?.live?.live;
    return Boolean(l && w?.hud?.entered && !document.querySelector('.ws-load') && l.current === z && l.gameplayReady && l.pending.length === 0 && l.residents.includes(z));
  }, zone, { timeout: 300000, polling: 500 }).catch(async (/** @type {unknown} */ e) => {
    let state = 'no grid state';
    try { state = JSON.stringify(await at()); } catch { /* mid-load: the grid has no state */ }
    throw new Error(`enterCell ${zone}: ${state} (${String(e)})`);
  });
  await page.evaluate(() => window.__wildshard.pose({ x: 0, z: 0, yaw: 0, pitch: 0 }));
}
