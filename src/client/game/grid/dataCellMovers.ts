/**
 * TEMPLATE-E2E TC-E5b: a data cell's movers on the page that walks it. The server steps a data shard's movers
 * (`createShardfileSim`), and the wire carries each pose as a `script:` row. A shard with a `client/plan` mover row installs
 * followed movers through it (`clientMoverOwners.ts`, `sceneMotion.ts`); a plain data shard has none, so before this its lift
 * and doors had no collider on the page: a lift drawn rising (its props panel, `neighbourPanels.ts`) that no one could stand on.
 *
 * Each mover gets its collider in the cell's own physics, posed off the wire, and the same row poses its drawn look where the
 * page has one. Prediction only: the server's body is the law.
 */
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { FollowedMovers, type MoverView } from '../plugin/followedMovers';
import { wirePage } from '../shardfile/wirePage';

/** Install a data cell's movers in its region's physics and lend the wire a view for each; they leave with `scope`. */
export function installDataCellMovers(source: Pick<Shardfile, 'movers'>, region: { readonly physics: Physics; readonly scope: Scope }): FollowedMovers | null {
  if (source.movers.length === 0) return null;
  // a saved end stands where the wire's first row puts it: the page holds no flags of its own here
  const movers = new FollowedMovers(source.movers, { physics: region.physics, scope: region.scope, restoreFlags: new Set() });
  for (const row of movers.data) {
    const view: MoverView = {
      pose: (pose, fields) => { wirePage.posed++; movers.follow(row.id, pose); wirePage.moverLooks.get(row.id)?.pose(pose, fields); },
      place: (at, next) => { movers.replayPose(row.id, at, next); },
    };
    wirePage.movers.set(row.id, view);
    // GC30b: the scope frees these bodies, so the view leaves with it; the look alone takes the wire back while it is drawn
    region.scope.onDispose(() => {
      if (wirePage.movers.get(row.id) !== view) return;
      const look = wirePage.moverLooks.get(row.id);
      if (look === undefined) wirePage.movers.delete(row.id); else wirePage.movers.set(row.id, look);
    });
  }
  return movers;
}
