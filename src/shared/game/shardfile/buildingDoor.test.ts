import { expect, test } from 'vitest';
import { buildingDoor, buildingDoorCollides, buildingDoorSwinging, buildingDoorYaw, stepBuildingDoor, toggleBuildingDoor } from './buildingDoor';

test('a door toggles, swings over its seconds and rests at each side', () => {
  const door = buildingDoor('inn');
  expect(door).toEqual({ id: 'inn', open: false, t: 0, enabled: true });
  expect(stepBuildingDoor(door, 0.1, 0.8)).toBe(false);
  expect(toggleBuildingDoor(door)).toBe(true);
  expect(buildingDoorSwinging(door)).toBe(true);
  for (let i = 0; i < 7; i++) expect(stepBuildingDoor(door, 0.1, 0.8)).toBe(true);
  expect(door.t).toBeCloseTo(0.875, 12);
  expect(stepBuildingDoor(door, 0.1, 0.8)).toBe(true);
  expect(door.t).toBe(1);
  expect(buildingDoorSwinging(door)).toBe(false);
  expect(stepBuildingDoor(door, 0.1, 0.8)).toBe(false);
  // shut mid-swing: it turns back from where it is
  expect(toggleBuildingDoor(door)).toBe(false);
  stepBuildingDoor(door, 0.4, 0.8);
  expect(door.t).toBe(0.5);
});

test('the leaf eases in and out to the look angle', () => {
  expect(buildingDoorYaw(0, 1.5)).toBe(-0);
  expect(buildingDoorYaw(0.25, 1.5)).toBe(-0.125 * 1.5);
  expect(buildingDoorYaw(0.5, 1.5)).toBe(-0.5 * 1.5);
  expect(buildingDoorYaw(1, 1.5)).toBe(-1.5);
});

test('a moving leaf stops colliding and rearms only once the player is clear', () => {
  const door = buildingDoor('barn');
  let clear = false, asked = 0;
  const ask = (): boolean => { asked++; return clear; };
  expect(buildingDoorCollides(door, ask)).toBe(true);
  expect(asked).toBe(0);
  toggleBuildingDoor(door);
  expect(buildingDoorCollides(door, ask)).toBe(false);
  stepBuildingDoor(door, 2, 0.8);
  expect(buildingDoorCollides(door, ask)).toBe(false);
  expect(asked).toBe(1);
  clear = true;
  expect(buildingDoorCollides(door, ask)).toBe(true);
  expect(buildingDoorCollides(door, ask)).toBe(true);
  expect(asked).toBe(2);
});
