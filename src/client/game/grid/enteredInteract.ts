import type { Vector3 } from 'three';
import { pickInteractable } from '@wildshard/engine/world/interact/Interactables';

type Interactable = Parameters<typeof pickInteractable>[0][number];
type Physics = NonNullable<Parameters<typeof pickInteractable>[2]>;

/**
 * The page's "[E] …" prompt inside the grid (SHARD-PLATFORM grid-interact, E435). The page picks its prompt from one list,
 * in one frame, with one eye:
 *
 * - **standalone, or in the grid's home frame** (a borrowed home): the page runtime's own list and the camera as it is;
 * - **inside an entered runtime cell** (Sky Reach, Pine Hollow, Nalati, an owned home): that cell's own scoped runtime list
 *   (emptied on entry, ended with its runtime), only once its hooks completed and only while the feet stand in its cell,
 *   with the eye in the cell's frame: the camera less the render origin the live session applied this frame (C39: the
 *   scene stays in the home frame, so the camera is offset by the active frame's origin minus the home origin, while
 *   every prompt, collider and the player's feet are frame-local);
 * - **anywhere else** (the road, a template copy, a cell still entering or crossing): nothing.
 *
 * So exactly one runtime's prompts are scanned at a time: a crossing never offers the old cell's, the next cell's or the
 * home's prompts at their local coordinates in another frame.
 */
export interface EnteredRuntimeState {
  /** the hybrid session's active runtime and whether its trusted hooks completed */
  readonly hybrid: Readonly<{ instance: string | null; ready: boolean }>;
  /** the live frame the traveller stands in (null: the road) */
  readonly current: string | null;
  /** the cell the feet stand in geometrically (independent of the motor frame's hysteresis) */
  readonly feetCell: string | null | undefined;
}

/** The runtime cell whose prompts (and aim bodies) the page may use now, or null. */
export function enteredRuntime(state: EnteredRuntimeState): string | null {
  const { instance, ready } = state.hybrid;
  if (!ready || instance === null || state.current !== instance || state.feetCell !== instance) return null;
  return instance;
}

/** The nearest prompt the eye sees in the active frame: `camera` less `renderOffset` (the offset applied this frame). */
export function pickInFrame<T extends Interactable>(list: readonly T[], camera: Readonly<Vector3>, renderOffset: Readonly<{ x: number; y: number; z: number }>, physics: Physics | null, eye: Vector3): T | undefined {
  if (list.length === 0) return undefined;
  eye.set(camera.x - renderOffset.x, camera.y - renderOffset.y, camera.z - renderOffset.z);
  return pickInteractable(list, eye, physics);
}
