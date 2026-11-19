/**
 * TEMPLATE-E2E TC-E5b: a data cell's movers on the page that walks it. The server steps a shard's movers
 * (`createShardfileSim`), and the wire carries each pose as a `script:` row. A shard with a `client/plan` mover row installs
 * followed movers through it (`clientMoverOwners.ts`, `sceneMotion.ts`); a plain shard has none, so before this its lift
 * and doors had no collider on the page: a lift drawn rising (its props panel, `neighbourPanels.ts`) that no one could stand on.
 *
 * Each mover gets its collider in the cell's own physics, and the same row poses its drawn look where the page has one.
 * A row names its mover by id alone, and two copies of one product share their ids, so the wire's views go to the cell the
 * feet stand in: the session claims them on entry. Prediction only: the server's body is the law.
 */
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { FollowedMovers, type MoverView } from '../plugin/followedMovers';
import { moverLookKey, wirePage } from '../shardfile/wirePage';
import { vehicleHulls } from '../../../shared/game/shardfile/vehicleHulls';
import { shardVehicles } from '../../../shared/game/shardfile/shardVehicles';
import { FollowedVehicles } from '../plugin/followedVehicles';

/** One cell's movers on this page. */
export interface DataCellMovers {
  readonly movers: FollowedMovers;
  /** MIRROR-SALT-ZONE MSZ9b: its `world/vehicles`, followed off their rows once claimed; null with no docks. */
  readonly vehicles: FollowedVehicles | null;
  /** The feet entered this cell: its rows pose its own bodies and looks from here on. */
  readonly claim: () => void;
}

/** Install a data cell's movers in its region's physics; they leave with `scope`, and take the wire only once claimed. */
export function installDataCellMovers(source: Pick<Shardfile, 'movers'> & Partial<Pick<Shardfile, 'props'>>, region: { readonly physics: Physics; readonly scope: Scope }, instance: string): DataCellMovers | null {
  // MSZ9b: its vehicles stand in its own physics; the grid's wire poses them once the feet are in it
  const docks = shardVehicles(source), vehicles = docks.docks.length === 0 ? null : new FollowedVehicles(docks, { physics: region.physics, scope: region.scope });
  if (source.movers.length === 0 && vehicles === null) return null;
  // a saved end stands where the wire's first row puts it: the page holds no flags of its own here
  const movers = new FollowedMovers(source.movers, { physics: region.physics, scope: region.scope, restoreFlags: new Set(), hulls: vehicleHulls(source) });
  const views = movers.data.map(row => {
    const look = moverLookKey(instance, row.id);
    const view: MoverView = {
      pose: (pose, fields) => { wirePage.posed++; movers.follow(row.id, pose); wirePage.moverLooks.get(look)?.pose(pose, fields); },
      place: (at, next) => { movers.replayPose(row.id, at, next); },
    };
    // GC30b: the scope frees these bodies, so the view leaves with it; the cell's look alone keeps the id while it is drawn
    region.scope.onDispose(() => {
      if (wirePage.movers.get(row.id) !== view) return;
      const drawn = wirePage.moverLooks.get(look);
      if (drawn === undefined) wirePage.movers.delete(row.id); else wirePage.movers.set(row.id, drawn);
    });
    return { id: row.id, view };
  });
  if (vehicles !== null) region.scope.onDispose(() => { if (wirePage.vehicles.get('grid') === vehicles) wirePage.vehicles.delete('grid'); });
  return { movers, vehicles, claim: () => {
    if (region.scope.disposed || region.scope.disposing) return;
    for (const { id, view } of views) wirePage.movers.set(id, view);
    if (vehicles !== null) wirePage.vehicles.set('grid', vehicles);
  } };
}
