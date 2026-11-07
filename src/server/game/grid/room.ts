import type { SimTickCommand } from '@wildshard/engine/sim';
import { Scope } from '@wildshard/engine/app/scope';
import type { GridAssembly, GridPoint } from '../../../shared/game/grid/assembly';
import { installGridCrossing, type GridCrossingSession } from '../../../shared/game/grid/crossing';
import type { GridSimulation } from './simulation';
import type { GridLoadout } from '../../../shared/game/grid/wallet';

/** A player's completed hand-off: the `travel` a client's view follows (E5-REPLICATION §6.3.4). */
export interface GridTravel { readonly player: string; readonly from: string | null; readonly to: string | null }
/** What a room needs beyond its grid. A player's bag and items stay in the cell they belong to. */
export interface GridRoomPorts { loadout: (player: string, instance: string) => GridLoadout | undefined }

/**
 * P1-E3.9: the grid on the server's tick. One `GridCrossing` per player, driven by the same rules a lone player crosses by,
 * so everyone walks through their own hand-off at their own moment. The page's session drives this same coordinator for
 * its one traveller today (`liveSession.ts`); E6 moves that onto frames and `travel` events.
 */
export class GridRoom {
  private readonly grid: GridSimulation;
  private readonly assembly: GridAssembly;
  private readonly ports: GridRoomPorts;
  private readonly crossings = new Map<string, { readonly session: GridCrossingSession; readonly scope: Scope }>();
  private readonly travels: GridTravel[] = [];
  private readonly scope = new Scope('grid-room');
  constructor(grid: GridSimulation, assembly: GridAssembly, ports: GridRoomPorts) {
    this.grid = grid; this.assembly = assembly; this.ports = ports;
    for (const player of grid.players()) this.watch(player);
  }
  private watch(player: string): void {
    const { grid } = this, scope = this.scope.child(`crossing:${player}`);
    const session = installGridCrossing({ current: () => grid.current(player), prepare: (from, to) => grid.prepare(from, to, player), ready: instance => grid.ready(instance),
      checkpoint: instance => grid.checkpoint(instance), target: feet => grid.target(feet, player) }, this.assembly, instance => this.ports.loadout(player, instance), scope,
    (from, to) => { this.travels.push({ player, from, to }); });
    this.crossings.set(player, { session, scope });
  }
  /** Another player comes onto the highway at `at`, world coordinates, or into the world at `site`, in its own. */
  join(player: string, at: Readonly<GridPoint>, yaw = 0, site: string | null = null): void { this.grid.join(player, at, yaw, site); this.watch(player); }
  /** A player leaves, wherever they stand. */
  leave(player: string): boolean {
    const crossing = this.crossings.get(player);
    if (crossing === undefined || !this.grid.leave(player)) return false;
    crossing.scope.dispose(); this.crossings.delete(player);
    return true;
  }
  /** Everyone's own crossing, once per fixed tick, before any world steps. */
  cross(): void { for (const [player, { session }] of this.crossings) session.step(this.grid.worldFeet(player)); }
  /** One fixed tick: everyone's own crossing, then every occupied world. */
  step(commands?: ReadonlyMap<string, SimTickCommand>): void { this.cross(); this.grid.stepAll(commands); }
  /** Every hand-off since the last call. */
  drainTravels(): readonly GridTravel[] { return this.travels.splice(0); }
  /** Stop every crossing; the grid stays with its owner. */
  dispose(): void { this.scope.dispose(); this.crossings.clear(); }
}
