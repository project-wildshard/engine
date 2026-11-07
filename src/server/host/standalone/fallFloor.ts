// A page stops looking after a fall once it's on the wire (`installBounds`), so the server does. Below the shard's declared floor a
// one-shard player goes back to the last firm ground they stood on, and a grid player dies of the fall, as each page has it.
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

/** Seconds on firm ground before a spot is safe to come back to, the page's. */
const SAFE_SECONDS = 0.2;
const STEP_SECONDS = 1 / 60;

type Body = Pick<PlayerSim, 'yaw' | 'led' | 'resetPose'> & { readonly position: { x: number; y: number; z: number }; readonly fall: { readonly grounded: boolean }; readonly board: { readonly on: boolean } };
/** One cell's fall recovery. `soft` takes a player back; a hard floor is a death. `start` is where they go with no safe ground yet. */
export class FallFloor {
  private since = 0;
  private spot: { x: number; y: number; z: number } | null = null;
  private readonly floor: number;
  private readonly soft: boolean;
  private readonly start: { readonly x: number; readonly y: number; readonly z: number };
  constructor(floor: number, soft: boolean, start: { readonly x: number; readonly y: number; readonly z: number }) { this.floor = floor; this.soft = soft; this.start = start; }
  /** One tick for this player. */
  step(player: Body, die: () => void): void {
    if (player.led) { this.since = 0; return; }
    const { position } = player;
    if (position.y < this.floor && !player.fall.grounded) { // a deck going down to the road carries its rider past it, standing
      this.since = 0;
      if (this.soft) player.resetPose(this.spot ?? this.start, player.yaw); else die();
      return;
    }
    if (!player.fall.grounded || player.board.on) { this.since = 0; return; }
    this.since += STEP_SECONDS;
    if (this.since < SAFE_SECONDS) return;
    this.since = 0;
    if (this.spot === null) this.spot = { x: position.x, y: position.y, z: position.z };
    else { this.spot.x = position.x; this.spot.y = position.y; this.spot.z = position.z; }
  }
}
