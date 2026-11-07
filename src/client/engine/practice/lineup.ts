/**
 * The practice arena's lineup (E285; E348, the E315 M5 leftover): its three training dummies as placements of the shared
 * model shared/training-dummy (src/client/engine/models/trainingDummy.ts), room-local (x, z; the room's floor is y 0), one armour each.
 * The arena (./TrainingArena.ts) stands a figure at each, built by the model's own builder, and swings them on springs;
 * the Model Explorer's card counts them (src/client/engine/models/roster.ts).
 *
 * The centre figure stands forward, the two sides a step back and close in, so all three and their labels fit the
 * narrowest portrait frame (Nalati's) from a spawn the arena picks from the camera's FOV.
 */
import type { Placement } from '../models/model';
import type { TrainingDummyParams } from '../models/trainingDummy';

export const ARENA_LINEUP: readonly Placement<TrainingDummyParams>[] = [
  { x: -2.1, y: 0, z: -8.5, variant: 'wood' },
  { x: 0, y: 0, z: -7, variant: 'straw-cloth' },
  { x: 2.1, y: 0, z: -8.5, variant: 'wood-steel' },
];
