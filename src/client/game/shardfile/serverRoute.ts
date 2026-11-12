// GO4 (MMO-ZONE-SELECT, QA row 13: "let's make it all the same"): which server a page plays on. A build stamped with a world (play,
// staging) puts every page in it, the grid's as well as a one-shard page; only a build with no world (preview, sharddev) runs the
// in-page standalone server (J209). Kept apart from `clientWorker.ts` so a test can read the rule without a renderer.

/** Where a page's server is. */
export type ServerRoute = 'online' | 'standalone';

/** The route for a page. `world` is the build's stamp (`__WS_WORLD__`); `storage` is null where the page can keep nothing, and an
 *  online seat needs a device id it can keep. A grid page goes online only once the world hosts the grid (`gridHosted`: the door's
 *  `world` word counts more than the home cell, which `WORLD_CELLS` decides); until then it keeps today's solo grid. A one-shard page of a
 *  shard the grid doesn't place (`placed` false: Brasscap's Developer-only card) plays solo: the world opens only grid cells, so its door
 *  would seat the device in another cell and the page would leave for the title (opus-brass3, Jake 2026-11-12: "kicked me out"). */
export function serverRoute(world: unknown, storage: unknown, grid?: { readonly page: boolean; readonly hosted: boolean }, placed = true): ServerRoute {
  return world !== undefined && storage !== null && (grid === undefined || !grid.page || grid.hosted) && (grid?.page === true || placed) ? 'online' : 'standalone';
}

/** Whether the door's `world` word (`socketFrames.ts` `WorldWord`, sent on every socket before hello) says it hosts the grid: more
 *  than the one home cell. */
export function hostsGrid(world: unknown): boolean {
  const cells = typeof world === 'object' && world !== null && 'cells' in world ? world.cells : null;
  return typeof cells === 'number' && cells > 1;
}

/** Whether a page may start the in-page server before its Worker boot step. A build with a world never does: its pages join the world,
 *  except a one-shard page of a shard the grid doesn't place (`placed` false), which plays solo. */
export function earlyStandalone(world: unknown, placed = true): boolean { return world === undefined || !placed; }
