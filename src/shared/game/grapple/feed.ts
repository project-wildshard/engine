import type { Vector3 } from 'three';
import type { GrappleCourse, GrappleEvent, GrapplePhase, GrappleTarget, GrappleView, LockResult } from './sim';

/** Every phase, in the order the server's rows number them. */
export const GRAPPLE_PHASES: readonly GrapplePhase[] = ['idle', 'fire', 'bite', 'lift', 'zip', 'vault', 'settle', 'miss', 'reel', 'dock'];
/** No hook: a row's `hook` while nothing is locked. */
export const NO_HOOK = -1;
/** A player's claw as `state` rows: `state:grapple.<player>.<field>`. */
export const grappleRow = (player: string, field: 'phase' | 'clock' | 'hook' | 'armed' | 'mx' | 'my' | 'mz'): string => `grapple.${player}.${field}`;

/**
 * The claw a grapple view draws and presses (E6: port first, flip last). A page holds a `GrappleSim`, whose law moves the
 * capsule on the fixed step; a client holds `netClaw`, whose presses go to the server and whose phases come back off its
 * rows, while the owner block's `led` carries the body.
 */
export interface GrappleClaw {
  phase: GrapplePhase; readonly clock: number; readonly target: GrappleTarget | null; readonly missEnd: Vector3;
  course: GrappleCourse;
  holding: () => boolean;
  guardOpen: () => boolean;
  drainEvents: () => readonly GrappleEvent[];
  lock: (view: GrappleView, candidate: GrappleTarget | null, lockedOn: boolean) => LockResult;
  fire: (view: GrappleView) => boolean;
  /** One fixed step; true while it owns the body's move. */
  traverse: (dt: number) => boolean;
  release: () => void;
}
