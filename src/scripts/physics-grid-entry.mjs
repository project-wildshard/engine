/** Fail immediately on the game's own fatal load screen instead of hiding it behind a probe timeout. */
export async function waitForPhysicsBoot(page, entry, timeout) {
  await page.waitForFunction(kind => {
    const failure = document.querySelector('.ws-load-error');
    if (failure !== null) throw new Error(failure.textContent);
    if (document.querySelector('.ws-load') !== null) return false;
    return kind === 'grid' ? window.__wildshard?.shard?.grid?.state().live?.live?.gameplayReady === true : window.__wildshard?.world !== undefined;
  }, entry, { timeout, polling: 250 });
}

/** Enter through the title's real one-shot grid intent, never a URL variant. */
export async function enterPhysicsGrid(page, base, tier, timeout) {
  await page.goto(`${base}/?tier=${tier}&mute=1&nolock=1&sw=0`, { waitUntil: 'commit', timeout });
  await page.locator('.ws-main-grid').waitFor({ timeout });
  await page.evaluate(() => { setTimeout(() => { document.querySelector('.ws-main-grid')?.click(); }, 100); });
  await waitForPhysicsBoot(page, 'grid', timeout);
  await page.evaluate(() => { window.__wildshard.world.hud.enterNow(); });
  await page.mouse.click(195, 420);
}

/** Serialized into the browser: count native collider ownership, not loading-shell telemetry. */
export function physicsEntryInventory() {
  const api = window.__wildshard, world = api.world, app = world.game.app, physics = app.physics;
  // The page's closed practice room remains on neutral page physics in the grid.
  const pieces = app.registry.pieces.filter(piece => (piece.colliders?.length ?? 0) > 0 && !piece.file.startsWith('src/client/engine/practice/'));
  const registered = Object.fromEntries(pieces.map(piece => [piece.id, piece.colliders.length]));
  const files = Object.fromEntries(pieces.map(piece => [piece.id, piece.file]));
  const native = {};
  physics.world.forEachCollider(collider => {
    const owner = physics.colliderTag(collider)?.owner;
    if (owner !== null && typeof owner === 'object' && typeof owner.id === 'string') native[owner.id] = (native[owner.id] ?? 0) + 1;
  });
  const ray = new physics.R.Ray({ x: 0, y: 5, z: -194 }, { x: 0, y: -1, z: 0 });
  const hit = physics.world.castRay(ray, 15, true, undefined, (2 << 16) | 1);
  const owner = hit === null ? null : physics.colliderTag(hit.collider)?.owner;
  return { registered, files, native, total: physics.world.colliders.len(),
    pier: hit === null ? null : { y: 5 - hit.timeOfImpact, owner: owner !== null && typeof owner === 'object' && typeof owner.id === 'string' ? owner.id : null },
    grid: api.shard.grid?.state().live?.live?.current ?? null };
}

/** A streamed pier keeps its authored piece id with its 8 × 8 tile suffix. */
function pierOwner(owner) { return typeof owner === 'string' && /^pier(?:\.c(?:[0-9]|[1-5][0-9]|6[0-3]))?$/u.test(owner); }

/** The sampled pier floor must belong to a positively registered, matching native piece. */
export function physicsEntryPierReady(inventory) {
  const owner = inventory.pier?.owner;
  if (typeof owner !== 'string' || !pierOwner(owner)) return false;
  const count = inventory.registered[owner];
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && inventory.native[owner] === count;
}

/** Grid platform walls/strips add native shapes; every standalone authored piece must still have the same shapes. */
export function physicsEntryFailures(standalone, grid) {
  const failures = [];
  for (const [id, count] of Object.entries(standalone.registered)) {
    if (grid.registered[id] !== count) failures.push(`${id}: registered ${grid.registered[id] ?? 0}, standalone ${count}`);
    if ((grid.native[id] ?? 0) !== (standalone.native[id] ?? 0)) failures.push(`${id}: native ${grid.native[id] ?? 0}, standalone ${standalone.native[id] ?? 0}`);
  }
  if (standalone.pier === null || grid.pier === null || !pierOwner(standalone.pier.owner) || !pierOwner(grid.pier.owner)
    || Math.abs(grid.pier.y - standalone.pier.y) > 0.001) failures.push('Pier deck is not the same solid native floor');
  return failures;
}
