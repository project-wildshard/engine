import type { NetClient } from '@wildshard/engine/net/client';
import type { PredictedMover, PredictedRow, PredictionWorld } from '@wildshard/engine/net/predictionWorld';
import { ANIMAL_CLASS } from '@wildshard/engine/net/netSchemas';

const X = ANIMAL_CLASS.row.findIndex(column => column.name === 'x'), Y = ANIMAL_CLASS.row.findIndex(column => column.name === 'y'),
  Z = ANIMAL_CLASS.row.findIndex(column => column.name === 'z'), ALIVE = ANIMAL_CLASS.row.findIndex(column => column.name === 'alive');
/** Same bounded half-second projection as predicted moving decks. */
const RUN_ON_TICKS = 30;

/** Owned row scratch from presentation, reused for command-time collision. */
export type CreaturePredictionRow = { -readonly [Key in keyof PredictedRow]: PredictedRow[Key] };

/** Creature collision poses follow commands; the rendered bodies keep interpolation. */
export class CreaturePrediction implements PredictedMover {
  private readonly row = new Float64Array(ANIMAL_CLASS.row.length);
  constructor(private readonly interpolator: NetClient['interpolator'], private readonly world: PredictionWorld,
      private readonly rows: CreaturePredictionRow[], private readonly feet: { readonly x: number; readonly z: number }) {}
  at(tick: number): void {
    for (const creature of this.rows) {
      // SimHost moves players before stepping creatures. A row stamped N is
      // the creature after that step; command N therefore meets its N-1 pose.
      if (!this.interpolator.project(creature.handle, tick - 1, this.row, RUN_ON_TICKS)) { creature.alive = false; continue; }
      creature.x = this.row[X] ?? 0; creature.y = this.row[Y] ?? 0; creature.z = this.row[Z] ?? 0;
      creature.alive = this.row[ALIVE] === 1;
    }
    this.world.syncRows(this.rows, this.feet);
  }
}
