import type { VehicleHandling } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { rivalAdvance, rivalCap, rivalCommand, rivalCourse, rivalPoint, type RivalCourse } from '../src/shared/engine/sim/rivalDriver';
import { stepVehicle, vehicleAt, type VehicleState, type VehicleWorld } from '../src/shared/engine/sim/vehicle';

// MIRROR-SALT-ZONE MSZ33: the rival's AI driver laps a line on the engine's own vehicle step: he keeps to it, slows into its
// bends, and keeps within his catch-up band of the player.
const SAIL: VehicleHandling = { speed: 14, reverse: 0, accel: 4, brake: 8, turn: 1.2, grip: 0.95, drift: 0.2, boost: 1.6, mass: 250, ground: true };
const BUGGY: VehicleHandling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true };
const FLAT: VehicleWorld = { floor: () => 0, bow: 1.6, stern: 1.6, side: 0.9 };
const DT = 1 / 60;
/** A stadium: two 120 m straights joined by two 15 m half circles, from (0, 0) heading -z. */
function stadium(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let z = 0; z > -120; z -= 10) out.push([0, 0, z]);
  for (let a = 0; a < Math.PI; a += Math.PI / 12) out.push([15 - 15 * Math.cos(a), 0, -120 - 15 * Math.sin(a)]);
  for (let z = -120; z < 0; z += 10) out.push([30, 0, z]);
  for (let a = 0; a < Math.PI; a += Math.PI / 12) out.push([15 + 15 * Math.cos(a), 0, 15 * Math.sin(a)]);
  return out;
}
/** Drive a rival round `course` for `seconds`, the player `playerAt(t)` m along it; returns his run. */
function race(course: RivalCourse, handling: VehicleHandling, top: number, seconds: number, playerAt: (t: number) => number, band = 40): { travelled: number; worst: number; speeds: number[]; leads: number[] } {
  const start = rivalPoint(course, 0), next = rivalPoint(course, 5);
  let state: VehicleState = vehicleAt({ x: start.x, y: 0, z: start.z }, Math.atan2(-(next.x - start.x), -(next.z - start.z)));
  let travelled = 0, worst = 0;
  const speeds: number[] = [], leads: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const lead = travelled - playerAt(i * DT);
    state = stepVehicle(state, rivalCommand(state, course, travelled, lead, band, handling, top), handling, FLAT, DT);
    travelled = rivalAdvance(course, travelled, state.x, state.z);
    const on = rivalPoint(course, travelled); worst = Math.max(worst, Math.hypot(on.x - state.x, on.z - state.z));
    speeds.push(state.forward); leads.push(lead);
  }
  return { travelled, worst, speeds, leads };
}

test('a bend allows less speed than a straight, and the line brakes in time for it', () => {
  const course = rivalCourse(stadium(), true, SAIL, 14);
  expect(course.length).toBeCloseTo(240 + 2 * Math.PI * 15, -1);
  expect(rivalCap(course, 30)).toBe(14); // the first straight
  const bend = rivalCap(course, 120 + 23.5); // the far bend's middle
  expect(bend).toBeLessThan(14);
  expect(bend).toBeGreaterThan(Math.sqrt(0.95 * 9.81 * 15) * 0.7);
  expect(rivalCap(course, 115)).toBeLessThan(14); // braking already, short of the bend
});

test('alone, the AI driver laps a closed line twice, on it, slowing into each bend', () => {
  const course = rivalCourse(stadium(), true, SAIL, 14);
  const { travelled, worst, speeds } = race(course, SAIL, 14, 75, t => t * 1000); // a player far ahead: he never eases
  expect(travelled).toBeGreaterThan(2 * course.length);
  expect(worst).toBeLessThan(4); // never far off his line
  expect(Math.max(...speeds)).toBeGreaterThan(12);
  expect(Math.min(...speeds.slice(600))).toBeLessThan(Math.max(...speeds) - 1.5); // he slows for the bends once going
});

test('far ahead of the player he eases off, far behind he pushes, so he stays near the band', () => {
  const course = rivalCourse(stadium(), true, BUGGY, 18);
  const idle = race(course, BUGGY, 18, 40, () => 0, 40); // the player never leaves the line
  const alone = race(course, BUGGY, 18, 40, t => t * 1000);
  expect(idle.travelled).toBeLessThan(alone.travelled); // he eased once past his band
  expect(idle.travelled).toBeGreaterThan(0.5 * alone.travelled); // but still drives on: an idle player loses
  const chased = race(course, BUGGY, 18, 40, t => 40 + t * 22, 40); // a player pulling away at the buggy's top speed
  expect(chased.travelled).toBeGreaterThan(alone.travelled * 0.98); // pushes when behind
});

test('a lap counts only once driven: a point near the start on lap one is not lap two', () => {
  const course = rivalCourse(stadium(), true, SAIL, 14), start = rivalPoint(course, 0);
  expect(rivalAdvance(course, 0, start.x, start.z + 2)).toBeLessThan(5);
  expect(rivalAdvance(course, course.length - 3, start.x, start.z - 2)).toBeCloseTo(course.length + 2, 0);
  expect(rivalAdvance(course, 10, 30, -60)).toBeLessThan(70); // across the infield on the back straight: still the first
});

test('in a sail, downwind or upwind, he drives to his speed, not to a fixed stick', () => {
  const line: [number, number, number][] = [[0, 0, 0], [0, 0, -400]];
  for (const toward of [[0, -1], [0, 1]] as const) { // with the wind, then into it
    const sail: VehicleHandling = { ...SAIL, speed: 12, wind: { toward: [...toward], push: 4 } };
    const course = rivalCourse(line, false, sail, 4.5);
    let state: VehicleState = vehicleAt({ x: 0, y: 0, z: 0 }, 0), travelled = 0;
    const speeds: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      state = stepVehicle(state, rivalCommand(state, course, travelled, 0, 40, sail, 4.5), sail, FLAT, DT);
      travelled = rivalAdvance(course, travelled, state.x, state.z);
      if (i > 60 * 5) speeds.push(state.forward);
    }
    expect(Math.max(...speeds)).toBeLessThan(4.5 + 1); // the wind behind him adds nothing past his speed
    expect(Math.min(...speeds)).toBeGreaterThan(4.5 - 1); // nor holds him back under it
  }
});
