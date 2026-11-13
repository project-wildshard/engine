// GO4 (MMO-ZONE-SELECT, QA row 13: "let's make it all the same"): which server a page plays on. A build stamped with a world (play,
// staging) puts every page in it, the grid's as well as a one-shard page; only a build with no world (preview, sharddev) runs the
// in-page standalone server (J209). Kept apart from `clientWorker.ts` so a test can read the rule without a renderer.

/** Where a page's server is. */
export type ServerRoute = 'online' | 'standalone';

/** The route for a page. `world` is the build's stamp (`__WS_WORLD__`). OFFLINE OF2 (J298, Jake 2026-11-12: "staging and prod should
 *  never try to play offline versions"): a build with a world sends every page online, whatever its world says or doesn't say. No
 *  answer (unreachable, offline), a world that hosts one cell, a shard the grid doesn't place: the page still joins, and a failing link
 *  shows the connection screens in the world, never the in-page server. The world's word picks only which page boots (Shard select's
 *  one way in, `oneWayIn.ts`), never the server. */
export function serverRoute(world: unknown): ServerRoute {
  return world === undefined ? 'standalone' : 'online';
}

/** Whether the door's `world` word (`socketFrames.ts` `WorldWord`, sent on every socket before hello) says it hosts the grid: more
 *  than the one home cell. */
export function hostsGrid(world: unknown): boolean {
  const cells = typeof world === 'object' && world !== null && 'cells' in world ? world.cells : null;
  return typeof cells === 'number' && cells > 1;
}

/** Whether a page may start the in-page server before its Worker boot step: only on a build with no world (OF2: a world build's pages
 *  all join the world). */
export function earlyStandalone(world: unknown): boolean { return serverRoute(world) === 'standalone'; }
