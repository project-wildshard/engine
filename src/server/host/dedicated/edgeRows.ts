// MMO-PLAN MP5.2a (Q36, under zone entry J352/J353): players across the home edge, read-only. A page holds one world, its home, and the
// road; every other cell stands behind its wall. The home edge is the one border with live ground on both sides, and its two sides are two
// rooms on one worker: a cell and that worker's road. So, ten times a second, each cell's road shows it the road bodies within EDGE_REACH
// outside its square, and the road shows each seat the bodies of its own home within EDGE_REACH inside the edge (J202: real line of
// sight, never through a wall). A shown body is a row and nothing else: no body stands for it in the room that shows it, so nothing there
// can touch it (MP5.1c admits damage only between a host's own live interior actors, and the road admits none). Wire 1.2's `roadX`/`roadZ`
// carry its unclamped place in the showing room's frame, as for any body on a road; `x`/`z` clamp at ±260 m.
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { NetVisitor } from '@wildshard/engine/net/room';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { PLAYER_CLASS } from '@wildshard/engine/net/netSchemas';

/** How far from a cell's edge, either side, a body is shown across it (Q36's starting 60 m). */
export const EDGE_REACH = 60;
/** How often the lists are read again, in fixed ticks: 10 Hz at 60. A shown body's place is read live at every frame between. */
export const EDGE_EVERY = 6;
/** Every shown row's id starts so: `edge:<cell>:<body>` for a cell's body on its road, `edge:road:<body>` for a road body in a cell. */
export const EDGE_PREFIX = 'edge:';
const ROAD = 'road';

interface Place { readonly x: number; readonly z: number }
/** Metres from `at` to the edge of the cell square round `origin`: negative inside, positive outside. */
export function edgeDistance(origin: Place, at: Place): number {
  const dx = Math.abs(at.x - origin.x) - CHUNK_HALF, dz = Math.abs(at.z - origin.z) - CHUNK_HALF;
  return dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);
}

/** `body` as another room reads it: its own row, its place moved by (dx, dz) into that room's frame and said as a road place. */
function shifted(body: PlayerSim, dx: number, dz: number): PlayerSim {
  const position = { get x(): number { return body.position.x + dx; }, get y(): number { return body.position.y; }, get z(): number { return body.position.z + dz; } };
  return new Proxy(body, { get: (target, key): unknown => key === 'position' ? position : key === 'roadPlace' ? true : Reflect.get(target, key, target) });
}

interface Shown { readonly host: SimHost; readonly body: PlayerSim; readonly view: PlayerSim }
/** The rows one room shows of bodies in another: what its `SimNetWorld.edge` visits. */
export class EdgeList {
  private readonly rows = new Map<string, Shown>();
  get size(): number { return this.rows.size; }
  /** Each shown body whose own host still holds it as it was listed, and shows it (a seat, not a parked lead). */
  visit(visitor: NetVisitor): void {
    for (const [id, { host, body, view }] of this.rows) {
      if (host.players.get(body.id) !== body || (host.parked.has(body.id) && !host.shown.has(body.id))) continue;
      visitor.entity(id, PLAYER_CLASS, view);
    }
  }
  /** The list as `next` says, keeping each row whose body and shift are unchanged so its view is the same object. */
  set(next: ReadonlyMap<string, { readonly host: SimHost; readonly body: PlayerSim; readonly dx: number; readonly dz: number }>): void {
    for (const id of this.rows.keys()) if (!next.has(id)) this.rows.delete(id);
    for (const [id, { host, body, dx, dz }] of next) if (this.rows.get(id)?.body !== body) this.rows.set(id, { host, body, view: shifted(body, dx, dz) });
  }
  clear(): void { this.rows.clear(); }
}

/** One cell this worker hosts, as the exchange reads it. */
export interface EdgeCell { readonly slug: string; readonly host: SimHost; readonly list: EdgeList; readonly taken: number }
/** This worker's road, as the exchange reads it. */
export interface EdgeRoad { readonly host: SimHost; readonly list: EdgeList; readonly taken: number; readonly homes: () => ReadonlyMap<string, string | null> }

/**
 * The exchange on one worker. `refresh` reads every cell's bodies near its edge for the road and the road's bodies near each cell's
 * edge for that cell. A cell nobody stands in sends nothing and is shown nothing; with nobody on the road, nothing goes either way.
 */
export class EdgeRows {
  private homes: ReadonlyMap<string, string | null> = new Map();
  /** Whether the road seat with body `player` is kept from row `entity`: another cell's, not its home's. */
  hides(player: string, entity: string): boolean {
    if (!entity.startsWith(EDGE_PREFIX)) return false;
    const home = this.homes.get(player);
    return home === undefined || home === null || !entity.startsWith(`${EDGE_PREFIX}${home}:`);
  }
  /** `origins`: each grid cell's centre in the world's frame (the road's), by instance. */
  refresh(road: EdgeRoad, cells: Iterable<EdgeCell>, origins: ReadonlyMap<string, Place>): void {
    const toRoad = new Map<string, { host: SimHost; body: PlayerSim; dx: number; dz: number }>();
    const live = road.taken > 0;
    this.homes = live ? road.homes() : new Map();
    const homes = new Set(this.homes.values());
    for (const cell of cells) {
      const origin = origins.get(cell.slug);
      if (!live || cell.taken === 0 || origin === undefined) { cell.list.clear(); continue; }
      const toCell = new Map<string, { host: SimHost; body: PlayerSim; dx: number; dz: number }>();
      for (const body of road.host.players.values()) {
        const at = edgeDistance(origin, body.position);
        if (at > 0 && at <= EDGE_REACH) toCell.set(`${EDGE_PREFIX}${ROAD}:${body.id}`, { host: road.host, body, dx: -origin.x, dz: -origin.z });
      }
      cell.list.set(toCell);
      // only a home of someone on the road is ever shown there
      if (!homes.has(cell.slug)) continue;
      for (const body of cell.host.players.values()) {
        const at = edgeDistance({ x: 0, z: 0 }, body.position);
        if (at <= 0 && at >= -EDGE_REACH) toRoad.set(`${EDGE_PREFIX}${cell.slug}:${body.id}`, { host: cell.host, body, dx: origin.x, dz: origin.z });
      }
    }
    road.list.set(toRoad);
  }
}
