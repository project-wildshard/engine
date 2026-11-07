/**
 * The shard's physics world for code that isn't handed it (weapons, aim assist, interact, FX): bootstrap sets it once
 * the `physics` step has built the world. Null before that and in node tests that build their own.
 */
import type { Physics } from '../../../shared/engine/physics/Physics';
import type { Bodies } from '../../../shared/engine/physics/bodies';
import { app } from '../app/runtime';

export function setActivePhysics(p: Physics | null): void { app.physics = p; }

export function activePhysics(): Physics | null { return app.physics; }

/** The page's dynamic-body service (`app.bodies`, PHYSICS P7): bootstrap sets it once the world is built; null before
 *  that and in node tests. */
export function setActiveBodies(b: Bodies | null): Bodies | null { app.bodies = b; return b; }
