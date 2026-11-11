// GO4 (MMO-ZONE-SELECT, QA row 13: "let's make it all the same"): which server a page plays on. A build stamped with a world (play,
// staging) puts every page in it, the grid's as well as a one-shard page; only a build with no world (preview, sharddev) runs the
// in-page standalone server (J209). Kept apart from `clientWorker.ts` so a test can read the rule without a renderer.

/** Where a page's server is. */
export type ServerRoute = 'online' | 'standalone';

/** The route for a page. `world` is the build's stamp (`__WS_WORLD__`); `storage` is null where the page can keep nothing, and an
 *  online seat needs a device id it can keep. Grid page or not makes no difference: that is the point. */
export function serverRoute(world: unknown, storage: unknown): ServerRoute {
  return world !== undefined && storage !== null ? 'online' : 'standalone';
}

/** Whether a page may start the in-page server before its Worker boot step. A build with a world never does: its pages join the world. */
export function earlyStandalone(world: unknown): boolean { return world === undefined; }
