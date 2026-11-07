import * as v from 'valibot';
import { BuildingContinuationSchema, type BuildingContinuation } from '@wildshard/format/buildings';
import type { InstanceSaveKeyDef, SaveStore } from '@wildshard/engine/saves/store';
import { instanceSave, type LocalSaveInstance } from '../instanceSaves';

/** A building door's own state, toggle and clock, with no scene, renderer, prompt or light: LivingBuildings poses its leaf
 *  and relabels its prompt from it, and the Node simulation (CI12's door verbs) drives the same owner without a renderer.
 *  `t` runs 0 (shut) to 1 (open) over the look's `seconds`; `enabled` is the moving leaf's collision, off while it swings
 *  and until the player clears the hinge. */
export interface BuildingDoorState { readonly id: string; open: boolean; t: number; enabled: boolean }

/** The world flag a server keeps a door's state in: up while it stands open. */
export const buildingDoorFlag = (id: string): string => `door:${id}`;

/** A page's own building save, by group. A server keeps its doors in world flags and reads this once, to take a page's doors over. */
export const buildingSave: InstanceSaveKeyDef<Record<string, BuildingContinuation>> = { key: 'platform.buildings', scope: 'shard', version: 1,
  schema: v.record(v.string(), BuildingContinuationSchema), initial: (): Record<string, BuildingContinuation> => ({}) };

/** The doors a page's save left open in one placement. */
export function pageOpenDoors(store: SaveStore, placement: LocalSaveInstance): ReadonlySet<string> {
  return new Set(Object.values(instanceSave(store, buildingSave, placement).read()).flatMap(group => group.doors.filter(door => door.open).map(door => door.id)));
}

/** A shut, enabled door. */
export function buildingDoor(id: string): BuildingDoorState { return { id, open: false, t: 0, enabled: true }; }

/** Open a shut door or shut an open one (its leaf then swings toward the new side); returns whether it is now open. */
export function toggleBuildingDoor(door: BuildingDoorState): boolean { door.open = !door.open; return door.open; }

/** Whether the leaf is between its sides. */
export function buildingDoorSwinging(door: BuildingDoorState): boolean { return door.t !== (door.open ? 1 : 0); }

/** Advance the swing by `dt` s toward its side; returns whether `t` moved (the leaf needs a new pose). */
export function stepBuildingDoor(door: BuildingDoorState, dt: number, seconds: number): boolean {
  const target = door.open ? 1 : 0;
  if (door.t === target) return false;
  door.t = Math.min(1, Math.max(0, door.t + Math.sign(target - door.t) * dt / seconds));
  return true;
}

/** The leaf's yaw at swing `t` for a door that opens by `angle` rad (ease in-out). */
export function buildingDoorYaw(t: number, angle: number): number {
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return -eased * angle;
}

/** The moving leaf's collision this frame: off while it swings, back on once `clear()` (the player is past the hinge). */
export function buildingDoorCollides(door: BuildingDoorState, clear: () => boolean): boolean {
  if (buildingDoorSwinging(door)) door.enabled = false;
  else if (!door.enabled) door.enabled = clear();
  return door.enabled;
}
