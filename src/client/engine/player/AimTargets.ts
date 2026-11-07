import { app } from '../app/runtime';
/**
 * AimTargets — the live list of things the touch aim assist (AimAssist.ts) may help you onto.
 *
 *   setAimTargets(animals.animals)   // main.ts, ONCE at boot — the AnimalManager mutates this array in place
 *   app.aimTargets                  // ReadonlyArray<AimTarget>
 *
 * The shape is the subset of `Animal` (src/engine/entities/Animal.ts) the assist reads: `alive`, `position` (feet, world),
 * `kind`, optional `hidden` (faded-out corpse), optional `scale`, optional `headWorld(out)` for the head sphere centre and
 * optional `dims` (`bodyY` = body height above the feet, `bodyRadius`). Anything else (velocity) the assist estimates
 * itself from position deltas, so a plain `{ alive, position }` object also works.
 */
import type * as THREE from 'three';

export interface AimTarget {
  kind?: string;
  alive: boolean;
  hidden?: boolean;
  position: THREE.Vector3;
  scale?: number;
  headWorld?: (out: THREE.Vector3) => THREE.Vector3;
  dims?: { bodyY?: number; bodyRadius?: number; bodyHalfLen?: number };
  /** the AI state ('attack' while winding up a hit) — the lock-on's tie-break (src/client/engine/player/LockOnTarget.ts) */
  state?: string;
  /** Flight-body targets opt into 3-D range and the full camera pitch envelope; ground targets keep their old policy. */
  flying?: boolean;
  /** Authored LOCK / target-tap eligibility; omitted targets opt in only with a flight body. */
  lockable?: boolean;
  /** the lock-on's acquire range for this target (m, feet → body edge; eye → body edge for flyers) when it is not the usual 12 m — Nalati's Storm
   *  Titan, a 110 m giant beyond the rim, is locked on from the arena (NALATI-MERGE H3); it breaks at 1.5 × this */
  lockRange?: number | undefined;
}

export function setAimTargets(list: readonly AimTarget[]): void { app.aimTargets = list; }

/**
 * The sword's melee lock (Sword.ts writes it every frame it is held): `target` = the animal a swing would lunge onto right
 * now (in range, in the cone — null when none), `lunging` = a lunge onto it is running. Read by the HUD's lock brackets
 * (src/client/engine/ui/LockOn.ts) and the touch layer's lunge camera turn (TouchControls.ts).
 */
export const meleeLock: { target: AimTarget | null; lunging: boolean } = { target: null, lunging: false };

/**
 * The Zelda-style lock-on (E50, project/archive/2026-09-23-lock-on.md — src/client/engine/player/LockOnTarget.ts runs it): `state` 'off' (nothing to lock),
 * 'available' (`candidate` could be locked — the LOCK disc pulses, a hollow ▽ hangs over it), 'locked' (`target`, the view
 * tracks it, MOVE orbits it, DODGE side-hops round it, the sword lunges only onto it). `offYaw` / `offPitch` are the ±10° /
 * ±6° glance a look drag makes while locked (it springs back); `r0` is the orbit radius MOVE holds; `left` / `right` the
 * next targets a flick would switch to (the HUD's edge chevrons), with their distances.
 */
export const lockOn: {
  state: 'off' | 'available' | 'locked';
  target: AimTarget | null; candidate: AimTarget | null;
  offYaw: number; offPitch: number; r0: number;
  left: AimTarget | null; right: AimTarget | null; leftDist: number; rightDist: number;
} = { state: 'off', target: null, candidate: null, offYaw: 0, offPitch: 0, r0: 0, left: null, right: null, leftDist: 0, rightDist: 0 };
