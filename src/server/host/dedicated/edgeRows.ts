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
import { ANIMAL_CLASS, PLAYER_CLASS } from '@wildshard/engine/net/netSchemas';
import type { AnimalPoseSample, AnimalSim } from '@wildshard/engine/entities/AnimalSim';

/** How far from a cell's edge, either side, a body is shown across it (Q36's starting 60 m). */
export const EDGE_REACH = 60;
/** How often the lists are read again, in fixed ticks: 10 Hz at 60. A shown body's place is read live at every frame between. */
export const EDGE_EVERY = 6;
/** Every shown row's id starts so: `edge:<cell>:<body>` for a cell's body on its road, `edge:road:<body>` for a road body in a cell. */
export const EDGE_PREFIX = 'edge:';
const ROAD = 'road', ANIMAL = 'animal';

interface Place { readonly x: number; readonly z: number }
/** Metres from `at` to the edge of the cell square round `origin`: negative inside, positive outside. */
export function edgeDistance(origin: Place, at: Place): number {
  const dx = Math.abs(at.x - origin.x) - CHUNK_HALF, dz = Math.abs(at.z - origin.z) - CHUNK_HALF;
  return dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);
}

/** `body` as another room reads it: its own fields, its place moved by (dx, dz) into that room's frame. */
function shifted<T extends { readonly position: { readonly x: number; readonly y: number; readonly z: number } }>(body: T, dx: number, dz: number, extra: Readonly<Record<string, unknown>> = {}): T {
  const position = { get x(): number { return body.position.x + dx; }, get y(): number { return body.position.y; }, get z(): number { return body.position.z + dz; } };
  return new Proxy(body, { get: (target, key): unknown => key === 'position' ? position : typeof key === 'string' && key in extra ? extra[key] : Reflect.get(target, key, target) });
}

/** What the animal class samples: a creature, its pose this tick, its target and whether it is a mount (`animalNet.ts`). */
type AnimalNetView = Parameters<(typeof ANIMAL_CLASS.row)[number]['sample']>[0];

/** One row shown across the edge: whether its body still stands where it was listed, and how it says itself. */
interface Shown { readonly source: object; readonly live: () => boolean; readonly say: (id: string, visitor: NetVisitor) => void }
/** A row for the list: its body, and how to make its view the first time the list holds it. */
export interface EdgeEntry { readonly source: object; readonly make: () => Shown }

/** A player across the edge: its row says its place as a road place (`roadX`/`roadZ`), unclamped in the showing room's frame. */
export function edgePlayer(host: SimHost, body: PlayerSim, dx: number, dz: number): EdgeEntry {
  return { source: body, make: () => {
    const view = shifted(body, dx, dz, { roadPlace: true });
    return { source: body, live: () => host.players.get(body.id) === body && (!host.parked.has(body.id) || host.shown.has(body.id)),
      say: (id, visitor) => { visitor.entity(id, PLAYER_CLASS, view); } };
  } };
}
/** MP5.2b: a creature across the edge, read-only: no target, never a mount, its place a road place (wire 1.3's `animal.roadX`/`roadZ`). */
export function edgeAnimal(host: SimHost, id: string, sim: AnimalSim, dx: number, dz: number): EdgeEntry {
  return { source: sim, make: () => {
    const pose: AnimalPoseSample = { attackT: -1, attackDur: 1, groundY: 0, tiltRollT: 0, stunT: 0, flinch: 0, flinchRoll: 0, flinchPitch: 0, brace: 0, deathSide: 0 };
    const view: AnimalNetView = { sim: shifted(sim, dx, dz), pose, target: null, rideable: false, road: true };
    return { source: sim, live: () => host.entities.get(id) === sim,
      say: (row, visitor) => { sim.samplePose(pose); visitor.entity(row, ANIMAL_CLASS, view, sim.lives); } };
  } };
}

/** The rows one room shows of bodies in another: what its `SimNetWorld.edge` visits. */
export class EdgeList {
  private readonly rows = new Map<string, Shown>();
  get size(): number { return this.rows.size; }
  /** Each shown body whose own host still holds it as it was listed, and shows it (a seat, not a parked lead). */
  visit(visitor: NetVisitor): void { for (const [id, shown] of this.rows) if (shown.live()) shown.say(id, visitor); }
  /** The list as `next` says, keeping each row whose body is unchanged so its view is the same object. */
  set(next: ReadonlyMap<string, EdgeEntry>): void {
    for (const id of this.rows.keys()) if (!next.has(id)) this.rows.delete(id);
    for (const [id, entry] of next) if (this.rows.get(id)?.source !== entry.source) this.rows.set(id, entry.make());
  }
  clear(): void { this.rows.clear(); }
}

/** One cell this worker hosts, as the exchange reads it. */
export interface EdgeCell { readonly slug: string; readonly host: SimHost; readonly list: EdgeList; readonly taken: number }
/** This worker's road, as the exchange reads it. */
export interface EdgeRoad { readonly host: SimHost; readonly list: EdgeList; readonly taken: number; readonly homes: () => ReadonlyMap<string, string | null> }

/**
 * The exchange on one worker. `refresh` reads the road's bodies near each cell's edge for whoever stands in that cell, and each road seat's
 * home's bodies and creatures near its edge for the road. A cell nobody stands in and nobody on the road calls home sends nothing and is
 * shown nothing; with nobody on the road, nothing goes either way.
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
    const toRoad = new Map<string, EdgeEntry>();
    const live = road.taken > 0;
    this.homes = live ? road.homes() : new Map();
    const homes = new Set(this.homes.values());
    for (const cell of cells) {
      const origin = origins.get(cell.slug);
      if (!live || origin === undefined) { cell.list.clear(); continue; }
      // the road's bodies near this cell's edge, for whoever stands in it
      const toCell = new Map<string, EdgeEntry>();
      if (cell.taken > 0) for (const body of road.host.players.values()) {
        const at = edgeDistance(origin, body.position);
        if (at > 0 && at <= EDGE_REACH) toCell.set(`${EDGE_PREFIX}${ROAD}:${body.id}`, edgePlayer(road.host, body, -origin.x, -origin.z));
      }
      cell.list.set(toCell);
      // only a home of someone on the road is shown there, awake or asleep (its creatures then stand still)
      if (!homes.has(cell.slug)) continue;
      for (const body of cell.host.players.values()) {
        const at = edgeDistance({ x: 0, z: 0 }, body.position);
        if (at <= 0 && at >= -EDGE_REACH) toRoad.set(`${EDGE_PREFIX}${cell.slug}:${body.id}`, edgePlayer(cell.host, body, origin.x, origin.z));
      }
      // MP5.2b: and its creatures, which never leave it (MP5.1a)
      for (const [id, sim] of cell.host.entities) {
        const at = edgeDistance({ x: 0, z: 0 }, sim.position);
        if (at <= 0 && at >= -EDGE_REACH) toRoad.set(`${EDGE_PREFIX}${cell.slug}:${ANIMAL}:${id}`, edgeAnimal(cell.host, id, sim, origin.x, origin.z));
      }
    }
    road.list.set(toRoad);
  }
}
