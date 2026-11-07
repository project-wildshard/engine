import type { Collider } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';

/** A collider that exists only while a player is near: where it stands, how far it reaches, and how to make it in a world. */
export interface HeldCollider { readonly x: number; readonly z: number; readonly reach: number; readonly make: (physics: Physics) => Collider | null }
/** A collider loads this close to the player, past the 45 m body band with room for what flies, and leaves this far off. */
const LOAD = 70, DROP = 85;
/** How far the player moves between looks. */
const STRIDE = 4;

/** How far a solid's points reach sideways from its centre. */
export function solidReach(points: ArrayLike<number>): number {
  let far = 0;
  for (let at = 0; at < points.length; at += 3) far = Math.max(far, Math.hypot(points[at] ?? 0, points[at + 2] ?? 0));
  return far;
}

/**
 * P1-E5.2b (J68, J78): a phone's server worker holds only the solids near its player, the way the client streams its world. A Rapier
 * heap never shrinks, and hulls are nearly all of it (Nalati: 2021 hulls, 22 of 27 MB), so the rest stay as data here. The ground
 * stays whole, so a creature out of range keeps walking on it and its obstacles come back with the player. Its save holds none of
 * these: `suspend` them around a capture, and a restored world `attach`es the same list.
 */
export class NearColliders {
  private readonly held: HeldCollider[] = [];
  private readonly live = new Map<HeldCollider, Collider>();
  private physics: Physics | null = null;
  private lookedX = Number.NaN;
  private lookedZ = Number.NaN;
  /** Serve this world from now on. Whatever a world held before dies with it. */
  attach(physics: Physics): void { this.physics = physics; this.live.clear(); this.lookedX = Number.NaN; }
  /** Keep a solid as data rather than building it. */
  hold(row: HeldCollider): void { this.held.push(row); }
  /** Solids held, and those in the world now. */
  get counts(): { readonly held: number; readonly live: number } { return { held: this.held.length, live: this.live.size }; }
  /** Bring the world up to where the player stands. Call before a tick; it does nothing until they have moved a stride. */
  update(x: number, z: number): void {
    if (Math.hypot(x - this.lookedX, z - this.lookedZ) < STRIDE) return;
    const { physics } = this;
    if (physics === null) throw new Error('Near colliders have no world');
    this.lookedX = x; this.lookedZ = z;
    for (const row of this.held) {
      const away = Math.hypot(row.x - x, row.z - z) - row.reach, collider = this.live.get(row);
      if (collider === undefined && away <= LOAD) { const made = row.make(physics); if (made !== null) this.live.set(row, made); }
      else if (collider !== undefined && away > DROP) { this.live.delete(row); physics.world.removeCollider(collider, false); }
    }
  }
  /** Take every solid out for a capture. `resume` puts back those still in reach. */
  suspend(): void {
    const { physics } = this;
    if (physics !== null) for (const collider of this.live.values()) physics.world.removeCollider(collider, false);
    this.live.clear();
  }
  resume(x: number, z: number): void { this.lookedX = Number.NaN; this.update(x, z); }
}
