// GO4 (MMO-ZONE-SELECT, QA row 13: "let's make it all the same"): which server a page plays on. A build stamped with a world (play,
// staging) puts every page in it, the grid's as well as a one-shard page; only a build with no world (preview, sharddev) runs the
// in-page standalone server (J209). Kept apart from `clientWorker.ts` so a test can read the rule without a renderer.

/** Where a page's server is. */
export type ServerRoute = 'online' | 'standalone';

/** The route for a page. `world` is the build's stamp (`__WS_WORLD__`); `storage` is null where the page can keep nothing, and an
 *  online seat needs a device id it can keep. A grid page goes online only once the world hosts the grid (`gridHosted`: its `/health`
 *  table names more than the home cell, which `WORLD_CELLS` decides); until then it keeps today's solo grid. */
export function serverRoute(world: unknown, storage: unknown, grid?: { readonly page: boolean; readonly hosted: boolean }): ServerRoute {
  return world !== undefined && storage !== null && (grid === undefined || !grid.page || grid.hosted) ? 'online' : 'standalone';
}

/** Whether a world's `/health` answer says it hosts the grid: more than the one home cell. */
export function hostsGrid(health: unknown): boolean {
  const table = typeof health === 'object' && health !== null && 'table' in health ? health.table : null;
  return typeof table === 'object' && table !== null && Object.keys(table).length > 1;
}

/** Whether a page may start the in-page server before its Worker boot step. A build with a world never does: its pages join the world. */
export function earlyStandalone(world: unknown): boolean { return world === undefined; }
