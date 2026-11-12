// A page stops looking after a fall once it's on the wire (`installBounds`), so the server does. Below the shard's declared floor a
// one-shard player goes back to the last firm ground they stood on, and a grid player dies of the fall, as each page has it.
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import type { Bounds } from '@wildshard/engine/level/spec';
import { declaredPlayArea, type PlayArea } from '@wildshard/engine/game/shardfile/playArea';
import type { ShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';

/** Below this a player has left a cell's world (half a chunk down): what recovery falls back to where a shard declares no floor. */
export const FALL_FLOOR: number = -CHUNK_HALF;
/** Where a shard's fall is caught: its declared bounds floor, never under the chunk's own. */
export const shardFallFloor = (declared: number | undefined): number => Math.max(FALL_FLOOR, declared ?? FALL_FLOOR);
/** SS6: a shard's play area as its page reads it, the manifest's bounds under its `client/plan` rows (`playArea.ts`), each
 *  floor never under the chunk's own. A shard that declares none has no x/z edge and the chunk's floor. */
export function shardPlayArea(authored: Bounds | undefined, product: Pick<ShardProduct, 'has' | 'section'> | undefined): PlayArea {
  const area = declaredPlayArea(authored, product);
  if (area === undefined) return { x0: -Infinity, x1: Infinity, z0: -Infinity, z1: Infinity, floorAt: () => FALL_FLOOR };
  return { x0: area.x0, x1: area.x1, z0: area.z0, z1: area.z1, floorAt: (x, z) => shardFallFloor(area.floorAt(x, z)) };
}
/** A bare floor height: no x/z edge (a road's). */
const flatArea = (floor: number): PlayArea => ({ x0: -Infinity, x1: Infinity, z0: -Infinity, z1: Infinity, floorAt: () => floor });

/** Seconds on firm ground before a spot is safe to come back to, the page's. */
const SAFE_SECONDS = 0.2;
const STEP_SECONDS = 1 / 60;
/** ENG-18: how long a resident's player may be off every collider under the floor before the net takes them. A shard's
 * edge docks sit under its declared floor (Sky Reach's at y 0 under 12): a step or a settle there is not a fall. */
export const RESIDENT_FALL_GRACE = 0.25;

type Body = Pick<PlayerSim, 'yaw' | 'led' | 'resetPose'> & { readonly position: { x: number; y: number; z: number }; readonly fall: { readonly grounded: boolean }; readonly board: { readonly on: boolean } };
/** One cell's fall recovery. `soft` takes a player back; a hard floor is a death. `start` is where they go with no safe ground yet.
 *  The floor is the area's at the player's x/z. Its x/z edge is not enforced here: a lone cell's walls hold the player (P1-E3.9's
 *  lone-cell test walks Dunes past its ±200 area to the wall at 250), so the page's offline x/z reset stays the page's. */
export class FallFloor {
  private since = 0;
  private spot: { x: number; y: number; z: number } | null = null;
  private readonly area: PlayArea;
  private readonly soft: boolean;
  private readonly start: { readonly x: number; readonly y: number; readonly z: number };
  private air = 0;
  private readonly grace: number;
  /** `grace`: seconds a player may be off every collider under the floor before it counts (0, the page's: at once). */
  constructor(floor: number | PlayArea, soft: boolean, start: { readonly x: number; readonly y: number; readonly z: number }, grace = 0) { this.area = typeof floor === 'number' ? flatArea(floor) : floor; this.soft = soft; this.start = start; this.grace = grace; }
  /** One tick for this player. */
  step(player: Body, die: () => void): void {
    if (player.led) { this.since = 0; this.air = 0; return; }
    const { position } = player, { area } = this;
    if (position.y < area.floorAt(position.x, position.z) && !player.fall.grounded) { // a deck going down to the road carries its rider past it, standing
      this.since = 0; this.air += STEP_SECONDS;
      if (this.air < this.grace) return;
      this.air = 0;
      if (this.soft) player.resetPose(this.spot ?? this.start, player.yaw); else die();
      return;
    }
    this.air = 0;
    if (!player.fall.grounded || player.board.on) { this.since = 0; return; }
    this.since += STEP_SECONDS;
    if (this.since < SAFE_SECONDS) return;
    this.since = 0;
    if (this.spot === null) this.spot = { x: position.x, y: position.y, z: position.z };
    else { this.spot.x = position.x; this.spot.y = position.y; this.spot.z = position.z; }
  }
}

/**
 * ENG-18: a host with no room around it (a headless tape, the bake worker, a shard's CI journey) catches its own players' falls,
 * as a lone room's seats and the page do: below `floor` each goes back to the last firm ground they stood on, else `start`.
 * Call it after each world step; a room's seats keep their own `FallFloor`s instead.
 */
export function residentFallNet(host: Pick<SimHost, 'players' | 'parked' | 'embedded'>, floor: number | PlayArea, start: { readonly x: number; readonly y: number; readonly z: number }): () => void {
  const nets = new Map<string, FallFloor>();
  return () => {
    if (host.embedded) return;
    for (const id of nets.keys()) if (!host.players.has(id)) nets.delete(id);
    for (const player of host.players.values()) {
      if (!player.hasMotor || player.borrowed || host.parked.has(player.id)) continue;
      let net = nets.get(player.id);
      if (net === undefined) { net = new FallFloor(floor, true, start, RESIDENT_FALL_GRACE); nets.set(player.id, net); }
      net.step(player, () => { throw new Error('A soft fall floor never kills'); });
    }
  };
}
