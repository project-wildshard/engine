// P1-E5.3-C5 (E5-REPLICATION §5.2): the world the client predicts against, beyond the static collision it already holds.
// Movers stand at the tick the command will run on the server, not the one on screen, or a player would ride a deck 100 ms
// behind (J59 Q4). Creatures and other players near the client stand as capsules at their interpolated pose, so the feet
// stop about where the server stops them, and any error is a correction (Source collides with interpolated entities the
// same way). A gate this player has opened is gone for its capsule alone (J106). None of this is ever rolled back: only
// the character replays (J59 Q10), and a replay re-poses the movers without stepping the world.
import type { Collider } from '@dimforge/rapier3d-simd';
import type { CharacterMotor } from '../../../shared/engine/physics/CharacterMotor';
import type { Physics } from '../../../shared/engine/physics/Physics';
import type { PredictedRide } from '../../../shared/engine/player/modes';
import { groups } from '../../../shared/engine/physics/groups';
import { tagCollider } from '../../../shared/engine/physics/surface';
import { creatureBodyDistance, keepsCreatureBody } from '../../../shared/engine/sim/bands';
import type { Player } from '../player/Player';
import { FIXED_STEP } from '../../../shared/engine/core/fixedStep';
import type { PredictedBody } from './predictor';

/** A mover whose pose the client can work out for a tick. A mover it cannot (a script drives it from server state) is simply
 *  not added: its row poses it, and the player on it is corrected. */
export interface PredictedMover {
  /** Stand at `tick`. Off a replay, for the next physics step to carry; on a replay, at once: nothing will step. */
  readonly at: (tick: number, replay: boolean) => void;
}
/** One visible body, at its interpolated pose. */
export interface PredictedRow {
  readonly handle: number;
  readonly x: number; readonly y: number; readonly z: number;
  readonly alive: boolean;
  /** A body that does not block this player: its own mount. */
  readonly driven: boolean;
  /** Its capsule (`creatureBodyShape`, or the player's). */
  readonly radius: number; readonly height: number;
}

/** The client's prediction world over one Physics. */
export class PredictionWorld {
  private physics: Physics;
  private readonly movers = new Set<PredictedMover>();
  private readonly capsules = new Map<number, Collider>();
  private readonly seen = new Set<number>();
  private frameTick = 0;
  private frameSeq = 0;
  constructor(physics: Physics) { this.physics = physics; }

  /** The page has moved to another world's physics, on a crossing: what stood in the last one stays behind. */
  rebind(physics: Physics): void {
    this.removeCapsules();
    this.physics = physics;
  }
  /** The newest frame: the server stood at `tick` having stepped `lastSeq`. */
  frame(tick: number, lastSeq: number): void { this.frameTick = tick; this.frameSeq = lastSeq; }
  /** The server tick command `seq` will reach: one command, one server step (J125), from the newest frame. */
  tickOf(seq: number): number { return this.frameTick + (((seq - this.frameSeq) << 16) >> 16); }

  addMover(mover: PredictedMover): () => void { this.movers.add(mover); return () => { this.movers.delete(mover); }; }
  /** Every mover to where command `seq` meets it. */
  poseFor(seq: number, replay: boolean): void {
    const tick = this.tickOf(seq);
    for (const mover of this.movers) mover.at(tick, replay);
  }

  /** The capsules, from this frame's rows around `feet`: a body gains one inside the physics LOD and loses it past it. */
  syncRows(rows: Iterable<PredictedRow>, feet: { readonly x: number; readonly z: number }): void {
    const { capsules, seen, physics } = this, { R, world } = physics;
    seen.clear();
    for (const row of rows) {
      const has = capsules.get(row.handle);
      if (!keepsCreatureBody(has !== undefined, row.alive, row.driven, creatureBodyDistance(row, feet))) continue;
      const half = Math.max(0.01, row.height / 2 - row.radius);
      const capsule = has ?? world.createCollider(R.ColliderDesc.capsule(half, row.radius).setCollisionGroups(groups('CREATURE')));
      if (has === undefined) { tagCollider(capsule, 'flesh', row.handle); capsules.set(row.handle, capsule); }
      capsule.setTranslation({ x: row.x, y: row.y + row.height / 2 + 0.005, z: row.z });
      seen.add(row.handle);
    }
    for (const [handle, capsule] of capsules) if (!seen.has(handle)) { world.removeCollider(capsule, false); capsules.delete(handle); }
  }
  /** Capsules standing now. */
  get capsuleCount(): number { return this.capsules.size; }

  /** The gates this player's capsule walks through: exactly `handles`, whatever opened or closed since the last call. */
  phase(motor: CharacterMotor, handles: Iterable<number>): void {
    const { phased } = motor;
    phased.clear();
    for (const handle of handles) phased.add(handle);
  }
  private removeCapsules(): void {
    for (const capsule of this.capsules.values()) this.physics.world.removeCollider(capsule, false);
    this.capsules.clear();
  }
  dispose(): void { this.removeCapsules(); this.movers.clear(); }
}

/** The Player as a predictor drives it: every step, first run or replay, meets the movers at its own tick. */
export function predictedPlayer(player: Player, world: PredictionWorld): PredictedBody {
  return { motionState: player.motionState, get motor(): CharacterMotor { return player.motor; }, get ride(): PredictedRide | null { return player.ride?.predicted ?? null; }, renderOffset: player.renderOffset,
    step: (command, replay) => {
      if (replay) world.poseFor(command.seq, true);
      return player.stepNet(FIXED_STEP, command, replay);
    } };
}
