import type { Physics } from '../../../shared/engine/physics/Physics';
import { addPiece } from '../../../shared/engine/physics/pieces';
import { addTrainingTarget, type TrainingTargetBodies } from '../../../shared/engine/physics/trainingTargets';
import type { ColliderDesc } from '../world/registry';

/** One dummy's place in the room: the object its hits answer to, and its feet. */
export interface StandSpot { readonly target: object; readonly x: number; readonly y: number; readonly z: number }

/**
 * QA 11-25 row 86 (c): a practice room's walls and dummies, built once into each physics the player opens it from. On the
 * grid the player walks in the entered cell's or the road's world, not the page's own, so a room built only into the page's
 * (the registry's) let them fall through its floor, with no landing to flash. E300: shot at and walked in only while open.
 */
export class RoomStands {
  private readonly built = new WeakMap<Physics, { setEnabled: (on: boolean) => void }>();
  private live: Physics | null = null;
  private readonly room: readonly ColliderDesc[];
  private readonly spots: readonly StandSpot[];
  constructor(room: readonly ColliderDesc[], spots: readonly StandSpot[]) { this.room = room; this.spots = spots; }
  /** The physics the room stands in now (the last it was opened in), null before it first opens. */
  get physics(): Physics | null { return this.live; }
  /** Open the room in `physics`, the one the player walks in, closing it wherever it last stood. */
  open(physics: Physics): void {
    if (this.live !== null && this.live !== physics) this.built.get(this.live)?.setEnabled(false);
    let stand = this.built.get(physics);
    if (stand === undefined) {
      const walls = addPiece(physics, { id: 'practice-arena-room', name: 'Practice room walls', category: 'ground', file: 'src/client/engine/practice/TrainingArena.ts', colliders: [...this.room], surface: 'metal' }).colliders;
      const dummies: TrainingTargetBodies[] = this.spots.map(spot => addTrainingTarget(physics, spot.target, spot.x, spot.y, spot.z));
      stand = { setEnabled: (on) => { for (const c of walls) c.setEnabled(on); for (const d of dummies) d.setEnabled(on); } };
      this.built.set(physics, stand);
    }
    this.live = physics;
    stand.setEnabled(true);
  }
  /** Close the room: no wall or dummy volume left for the world's rays over the shard (E300). */
  close(): void { if (this.live !== null) this.built.get(this.live)?.setEnabled(false); }
}
