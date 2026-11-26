/**
 * TEMPLATE-E2E TC-E5c: a plain shard's movers on its one-shard page. The server steps them
 * (`createShardfileSim`) and the wire poses each as a row; only a client plan (`world.movers`, `motion.channels`) installed
 * them here, so a shard with none (Mossgate, Brasscap) had a lift drawn at rest and no collider to stand on. A grid cell
 * has its own (`grid/dataCellMovers.ts`, TC-E5b).
 *
 * Each mover gets its collider in the page's physics, and the same row poses its props panel where the page draws one.
 * Prediction only: the server's body is the law.
 */
import type { Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { MoverPose } from '@wildshard/format/moverPose';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { FollowedMovers, type MoverView } from '../plugin/followedMovers';
import { moverPanelPose } from '../grid/neighbourPanels';
import { wirePage } from './wirePage';
import { vehicleHulls } from '@wildshard/format/vehicleHulls';
import { shardVehicles } from '../../../shared/game/shardfile/shardVehicles';
import { FollowedVehicles, type FollowedVehiclePorts } from '../plugin/followedVehicles';
import { vehicleDress } from '../plugin/vehicleFx';

/** What a one-shard page lends its data movers. */
export interface DataPagePorts {
  readonly physics: Physics; readonly scope: Scope;
  /** The page's props panels by id: a mover's look is the panel with its id. */
  readonly panels?: ReadonlyMap<string, Object3D>;
  /** MSZ15: where its vehicles' sounds go, and its cues and recordings (`vehicleSoundPort`); none is silent. */
  readonly sounds?: FollowedVehiclePorts['sounds'];
  /** The page's prompts, which take a carry mover's ride prompts. */
  readonly prompts?: Interactable[];
}

/** Install a plain data page's movers in its physics, each posed off the wire with its drawn panel; they leave with `scope`. */
export function installDataPageMovers(source: Pick<Shardfile, 'movers'> & Partial<Pick<Shardfile, 'props'>>, page: DataPagePorts): FollowedMovers | null {
  installDataPageVehicles(source, page); // MIRROR-SALT-ZONE MSZ9b: its `world/vehicles`, beside its movers
  if (source.movers.length === 0) return null;
  // a saved end stands where the wire's first row puts it: the page holds no flags of its own here
  const movers = new FollowedMovers(source.movers, { physics: page.physics, scope: page.scope, restoreFlags: new Set(), hulls: vehicleHulls(source) });
  for (const row of movers.data) {
    const panel = page.panels?.get(row.id);
    let look: ((pose: MoverPose) => void) | undefined;
    if (panel !== undefined) { look = moverPanelPose(panel, row); panel.visible = row.enabled; }
    const view: MoverView = {
      pose: (pose) => { wirePage.posed++; movers.follow(row.id, pose); look?.(pose); },
      place: (at, next) => { movers.replayPose(row.id, at, next); },
    };
    wirePage.movers.set(row.id, view);
    // GC30b: the scope frees these bodies, so the view leaves the wire with it
    page.scope.onDispose(() => { if (wirePage.movers.get(row.id) === view) wirePage.movers.delete(row.id); });
  }
  page.prompts?.push(...movers.ridePrompts());
  return movers;
}

/** MIRROR-SALT-ZONE MSZ9b: a plain page's `world/vehicles`, each posed off its row with its hull and a copy of its kind's panel
 * (hidden while gone, smoking while worn and broken apart when wrecked: MSZ14b);
 * their prompts join the page's. Null with no docks. */
export function installDataPageVehicles(source: object, page: DataPagePorts, key = 'page'): FollowedVehicles | null {
  const vehicles = shardVehicles(source);
  if (vehicles.docks.length === 0) return null;
  // MSZ14b: a hurt vehicle's smoke and break-apart draw beside its look, under its panels' root
  const dress = vehicleDress(vehicles.kinds, page.panels, page.scope);
  const followed = new FollowedVehicles(vehicles, { physics: page.physics, scope: page.scope, ...dress, ...(page.sounds === undefined ? {} : { sounds: page.sounds }) });
  wirePage.vehicles.set(key, followed);
  page.scope.onDispose(() => { if (wirePage.vehicles.get(key) === followed) wirePage.vehicles.delete(key); });
  page.prompts?.push(...followed.prompts());
  return followed;
}
