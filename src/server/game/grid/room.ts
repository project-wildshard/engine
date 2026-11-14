import type { SimTickCommand } from '@wildshard/engine/sim';
import { Scope } from '@wildshard/engine/app/scope';
import type { GridAssembly, GridPoint } from '../../../shared/game/grid/assembly';
import { installGridCrossing, type GridCrossingSession } from '../../../shared/game/grid/crossing';
import type { GridSimulation } from './simulation';
import type { GridLoadout } from '../../../shared/game/grid/wallet';
import { CHUNK_HALF } from '@wildshard/engine/core/config';

/** How far from a cell's edge a player on the road has its world opened (the road between two cells is 62.5 m). */
const WARM_ROAD_METRES = 55;
/** The least a tick's move toward it counts as heading there (a walk is 0.07 m a tick); a capsule settling is not. */
const WARM_STEP_METRES = 0.02;

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
  /** each player's last cell left for the road, and the cells opened ahead of them on this stretch of road (GC5): each at
   *  most once a stretch, so two players on the road never evict each other's cell tick after tick, and a failed open is not
   *  retried every tick (the crossing still prepares it at the line and reports a failure) */
  private readonly departed = new Map<string, string>();
  private readonly opened = new Map<string, Set<string>>();
  private readonly feet = new Map<string, { x: number; z: number }>();
  constructor(grid: GridSimulation, assembly: GridAssembly, ports: GridRoomPorts) {
    this.grid = grid; this.assembly = assembly; this.ports = ports;
    for (const player of grid.players()) this.watch(player);
  }
  private watch(player: string): void {
    const { grid } = this, scope = this.scope.child(`crossing:${player}`);
    const session = installGridCrossing({ current: () => grid.current(player), prepare: (from, to) => grid.prepare(from, to, player), ready: instance => grid.ready(instance),
      checkpoint: instance => grid.checkpoint(instance), target: feet => grid.target(feet, player) }, this.assembly, instance => this.ports.loadout(player, instance), scope,
    (from, to) => { this.travels.push({ player, from, to }); if (from !== null) this.departed.set(player, from); });
    this.crossings.set(player, { session, scope });
  }
  /** Another player comes onto the highway at `at`, world coordinates, or into the world at `site`, in its own. */
  join(player: string, at: Readonly<GridPoint>, yaw = 0, site: string | null = null): void { this.grid.join(player, at, yaw, site); this.watch(player); }
  /** A player leaves, wherever they stand. */
  leave(player: string): boolean {
    const crossing = this.crossings.get(player);
    if (crossing === undefined || !this.grid.leave(player)) return false;
    crossing.scope.dispose(); this.crossings.delete(player); this.departed.delete(player); this.feet.delete(player); this.opened.delete(player);
    return true;
  }
  /** Everyone's own crossing, once per fixed tick, before any world steps. */
  cross(): void {
    for (const [player, { session }] of this.crossings) {
      const feet = this.grid.worldFeet(player);
      this.warm(player, feet);
      session.step(feet);
    }
  }
  /** GC5 (preview's in-page server, J311): a player on the road has the nearest cell ahead opened before they reach its line,
   *  as the page builds its own: opened only at the 6 m line, a cell's world held them at its wall for its whole load. The
   *  cell they left is not ahead. A failed open stays the crossing's to report. */
  private warm(player: string, feet: Readonly<GridPoint>): void {
    const previous = this.feet.get(player);
    this.feet.set(player, { x: feet.x, z: feet.z });
    if (this.grid.current(player) !== null) { this.opened.delete(player); return; }
    if (previous === undefined) return;
    const left = this.departed.get(player), edge = (p: Readonly<{ x: number; z: number }>, cell: { readonly origin: GridPoint }): number =>
      Math.max(Math.abs(p.x - cell.origin.x), Math.abs(p.z - cell.origin.z)) - CHUNK_HALF;
    let best: string | undefined, bestDistance = WARM_ROAD_METRES;
    for (const cell of this.assembly.cells) {
      // only a cell they draw nearer to: not one behind them, nor the one they left
      const distance = edge(feet, cell);
      if (cell.instance === left || distance > bestDistance || distance > edge(previous, cell) - WARM_STEP_METRES) continue;
      best = cell.instance; bestDistance = distance;
    }
    if (best === undefined || this.grid.ready(best)) return;
    const opened = this.opened.get(player) ?? new Set<string>();
    if (opened.has(best)) return;
    opened.add(best); this.opened.set(player, opened);
    void this.grid.prefetch([best]).catch(() => undefined);
  }
  /** One fixed tick: everyone's own crossing, then every occupied world. */
  step(commands?: ReadonlyMap<string, SimTickCommand>): void { this.cross(); this.grid.stepAll(commands); }
  /** Every hand-off since the last call. */
  drainTravels(): readonly GridTravel[] { return this.travels.splice(0); }
  /** Stop every crossing; the grid stays with its owner. */
  dispose(): void { this.scope.dispose(); this.crossings.clear(); }
}
