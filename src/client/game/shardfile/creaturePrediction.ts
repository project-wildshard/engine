import type { NetClient } from '@wildshard/engine/net/client';
import type { PredictedMover, PredictedRow, PredictionWorld } from '@wildshard/engine/net/predictionWorld';
import { ANIMAL_CLASS } from '@wildshard/engine/net/netSchemas';

const X = ANIMAL_CLASS.row.findIndex(column => column.name === 'x'), Y = ANIMAL_CLASS.row.findIndex(column => column.name === 'y'),
  Z = ANIMAL_CLASS.row.findIndex(column => column.name === 'z'), ALIVE = ANIMAL_CLASS.row.findIndex(column => column.name === 'alive');
const COLLISION_COLUMNS = [X, Y, Z, ALIVE] as const;
/** Same bounded half-second projection as predicted moving decks. */
const RUN_ON_TICKS = 30;
/** NET-LAG NL13b3: a creature whose feet stand this far above the player's is off the ground under them (a diving flyer), and
 *  never blocks the predicted capsule: it reacts to the player, so its projected pose is a guess the room does not share. */
export const AIRBORNE_ABOVE_FEET = 0.5;

/** Owned row scratch from presentation, reused for command-time collision. */
export type CreaturePredictionRow = { -readonly [Key in keyof PredictedRow]: PredictedRow[Key] };

/** Creature collision poses enter the broad phase before physics; visible bodies keep interpolation.
 * Replays can repose narrow-phase shapes, but Rapier retains the last stepped broad phase until the next fixed step. */
export class CreaturePrediction implements PredictedMover {
  private nextTick = 0;
  private readonly row = new Float64Array(ANIMAL_CLASS.row.length);
  private readonly interpolator: NetClient['interpolator'];
  private readonly world: PredictionWorld;
  private readonly rows: CreaturePredictionRow[];
  private readonly feet: { readonly x: number; readonly y: number; readonly z: number };
  constructor(interpolator: NetClient['interpolator'], world: PredictionWorld,
      rows: CreaturePredictionRow[], feet: { readonly x: number; readonly y: number; readonly z: number }) {
    this.interpolator = interpolator; this.world = world; this.rows = rows; this.feet = feet;}
  at(tick: number, replay: boolean): void {
    this.nextTick = tick;
    if (replay) this.pose(tick - 1);
  }
  /** A normal command N queued creature N for the next physics step: command N+1 meets that completed pose.
   * setTranslation after physics leaves Rapier's broad phase stale and can miss a creature moving into the path. */
  prepare(): void { this.pose(this.nextTick); }
  private pose(tick: number): void {
    for (const creature of this.rows) {
      if (!this.interpolator.project(creature.handle, tick, this.row, RUN_ON_TICKS, COLLISION_COLUMNS)) { creature.alive = false; continue; }
      creature.x = this.row[X] ?? 0; creature.y = this.row[Y] ?? 0; creature.z = this.row[Z] ?? 0;
      creature.alive = this.row[ALIVE] === 1 && creature.y <= this.feet.y + AIRBORNE_ABOVE_FEET;
    }
    this.world.syncRows(this.rows, this.feet);
  }
}
