// SHARD-SOURCE SS-MS2a3b: a data cell's rides inside the grid. A one-shard page joins its movers' ride prompts to the page's
// (`dataPageMovers.ts`) and installs the steer ride for a `steer` vehicle (`client.ts`, `steerRide.ts`); a grid copy built its
// movers (`dataCellMovers.ts`) but did neither, so on staging (v0.1.42) Mirror Salt's land-sail offered no board prompt in its
// cell. The ride prompts join the copy's own at admission, in its frame (the page offers them only while the feet stand in
// it); the steer ride is the stay's: it reads the cell server's lead only while the wire is this cell's, and goes with the stay.
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { app } from '@wildshard/engine/app/runtime';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { FollowedMovers } from '../plugin/followedMovers';
import { installSteerRide, type SteerRider, type SteerRideView } from '../plugin/steerRide';
import { wirePage } from '../shardfile/wirePage';
import type { DataCellMovers } from './dataCellMovers';

/** A copy's carry prompts (board and leave, a steer vehicle's riding with it), for the copy's prompts. */
export const cellRidePrompts = (movers: DataCellMovers | null): Interactable[] => movers?.movers.ridePrompts() ?? [];

/** Whether a copy's movers hold a steer vehicle to ride. */
export const hasSteerRides = (movers: FollowedMovers): boolean => movers.data.some(row => row.carry !== undefined && row.driver?.kind === 'steer');

/** The chip, the frame clock and the rider the steer ride uses: the page's (`enterDataCellRides`), or a test's. */
export interface DataCellRidePorts {
  readonly system: (spec: SystemSpec) => void; readonly view: SteerRideView; readonly player: SteerRider; readonly boost: () => boolean;
}

/** Install a copy's steer ride for one stay in it. `here` says whether the wire is this cell's. */
export function installCellRides(movers: FollowedMovers, stay: Scope, here: () => boolean, ports: DataCellRidePorts): void {
  if (!hasSteerRides(movers)) return;
  installSteerRide(movers, { system: ports.system, led: () => here() && wirePage.led(), player: ports.player, view: ports.view, boost: ports.boost });
  stay.onDispose(() => { movers.steered = null; }); // the next stay boards afresh
}

/** What the steer ride reads off the page: its player, in the cell's frame. */
export interface DataCellRidePage { readonly world: { readonly player: SteerRider & { sampleHeldCommand: () => { readonly buttons: number } } } }

/** The page's install: the steer chip and a frame system named for the cell, both gone with `stay`. */
export async function enterDataCellRides(movers: FollowedMovers, page: DataCellRidePage, stay: Scope, instance: string, here: () => boolean): Promise<void> {
  if (!hasSteerRides(movers)) return;
  const { SteerChip } = await import('@wildshard/engine/quest/view/ui');
  if (stay.disposed || stay.disposing) return;
  const player = page.world.player;
  installCellRides(movers, stay, here, { view: new SteerChip(stay), player,
    boost: () => (player.sampleHeldCommand().buttons & NET_BUTTONS.sprint) !== 0,
    system: (spec) => { app.addSystem({ ...spec, id: `grid.steer-ride.${instance}` }, stay); } });
}
