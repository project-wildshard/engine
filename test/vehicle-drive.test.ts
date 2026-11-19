import type { VehicleHandling } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { stepVehicle, vehicleAt, type VehicleCommand, type VehicleState, type VehicleStepOut, type VehicleWorld } from '../src/shared/engine/sim/vehicle';

// MIRROR-SALT-ZONE MSZ7: the handling step, with the vehicles example's salt buggy (sharddev c4b321f6): 22 m/s, reverse 6,
// accel 9, brake 18, turn 1.6, grip 0.8, drift 0.4, boost 1.5, on its 3.4 m tub (bow and stern 1.7 m, half width 0.95 m).
const BUGGY: VehicleHandling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true };
const DT = 1 / 60;
const flat = (): number => 0;
const world = (floor: VehicleWorld['floor'] = flat): VehicleWorld => ({ floor, bow: 1.7, stern: 1.7, side: 0.95 });
const stick = (throttle: number, turn = 0, boost = false, handbrake = false): VehicleCommand => ({ throttle, turn, boost, handbrake });
function drive(from: VehicleState, command: VehicleCommand, seconds: number, place: VehicleWorld = world(), handling: VehicleHandling = BUGGY, each?: (state: VehicleState, out: VehicleStepOut) => void): VehicleState {
  let state = from; const out: VehicleStepOut = { blocked: false, sliding: 0 };
  for (let i = 0; i < Math.round(seconds / DT); i++) { state = stepVehicle(state, command, handling, place, DT, out); each?.(state, out); }
  return state;
}
const rest = (): VehicleState => vehicleAt({ x: 0, y: 0, z: 0 }, 0);

test('full throttle reaches top speed in the time accel says, and boost past it', () => {
  const seconds = BUGGY.speed / BUGGY.accel; // 2.44 s
  expect(drive(rest(), stick(1), seconds - 0.1).forward).toBeLessThan(BUGGY.speed);
  const top = drive(rest(), stick(1), seconds + 0.05);
  expect(top.forward).toBeCloseTo(BUGGY.speed, 6);
  expect(top.z).toBeLessThan(-20); expect(top.x).toBeCloseTo(0, 9); // forward is -z at yaw 0
  expect(drive(top, stick(1, 0, true), 2).forward).toBeCloseTo(BUGGY.speed * BUGGY.boost, 6);
  expect(drive(top, stick(1), 5).forward).toBeCloseTo(BUGGY.speed, 6); // and holds it
});

test('a back stick brakes to a stop, then reverses; let go, it coasts', () => {
  const top = drive(rest(), stick(1), 3);
  let stopped = -1, t = 0;
  drive(top, stick(-1), 1.5, world(), BUGGY, state => { t += DT; if (stopped < 0 && state.forward <= 0) stopped = t; });
  expect(stopped).toBeGreaterThan(BUGGY.speed / BUGGY.brake - 2 * DT); expect(stopped).toBeLessThan(BUGGY.speed / BUGGY.brake + 2 * DT);
  const backing = drive(top, stick(-1), 4);
  expect(backing.forward).toBeCloseTo(-BUGGY.reverse, 6);
  const coasted = drive(top, stick(0), 2);
  expect(coasted.forward).toBeGreaterThan(BUGGY.speed - 3.1); expect(coasted.forward).toBeLessThan(BUGGY.speed - 2.9);
  expect(rest().forward).toBe(drive(rest(), stick(0, 1), 1).forward); // a parked car does not spin
  expect(drive(rest(), stick(0, 1), 1).yaw).toBe(0);
});

test('a hard turn at speed slides; a slide runs further at low grip; a gentle turn holds', () => {
  for (const grip of [0.3, 0.9]) {
    const handling = { ...BUGGY, grip }; let most = 0;
    drive(drive(rest(), stick(1), 3, world(), handling), stick(1, 1), 1, world(), handling, (_state, out) => { most = Math.max(most, Math.abs(out.sliding)); });
    expect(most).toBeGreaterThan(0.5);
  }
  // the same slide (15 m/s on, 8 m/s across), let go: how far it travels sideways before the tyres hold
  const slide = (grip: number): number => {
    let across = 0;
    drive({ ...rest(), forward: 15, slip: 8 }, stick(0), 4, world(), { ...BUGGY, grip }, (_state, out) => { across += out.sliding * DT; });
    return across;
  };
  const icy = slide(0.3), grippy = slide(0.9);
  expect(grippy).toBeGreaterThan(0);
  expect(icy).toBeGreaterThan(grippy * 2);
  expect(slide(0.9)).toBe(grippy);
  let gentle = 0;
  drive(drive(rest(), stick(0.3), 3), stick(0.3, 0.2), 2, world(), BUGGY, (_state, out) => { gentle = Math.max(gentle, Math.abs(out.sliding)); });
  expect(gentle).toBeLessThan(0.5);
});

test('a 15 degree climb is slower than the flat, and pitches the nose up', () => {
  const slope = Math.tan(15 * Math.PI / 180), climb = world((_x, z) => -z * slope); // rising toward -z
  const flatRun = drive(rest(), stick(1), 2), uphill = drive(rest(), stick(1), 2, climb);
  expect(-uphill.z).toBeLessThan(-flatRun.z * 0.85);
  expect(uphill.y).toBeCloseTo(-uphill.z * slope, 1);
  expect(uphill.pitch).toBeCloseTo(15 * Math.PI / 180, 2);
  expect(uphill.roll).toBeCloseTo(0, 9);
  // left on it, it rolls back down
  expect(drive(uphill, stick(0), 6, climb).forward).toBeLessThan(0);
});

test('it stops at a 2.5 m wall, its bow short of the face, and can back away', () => {
  const face = -30, wall = world((_x, z) => (z < face ? 2.5 : 0));
  let hit = false;
  const stopped = drive(rest(), stick(1), 6, wall, BUGGY, (_state, out) => { hit ||= out.blocked; });
  expect(hit).toBe(true);
  expect(stopped.forward).toBe(0);
  const bow = stopped.z - 1.7;
  expect(bow).toBeGreaterThanOrEqual(face); expect(bow).toBeLessThan(face + 0.6);
  expect(stopped.y).toBe(0);
  expect(drive(stopped, stick(-1), 1, wall).z).toBeGreaterThan(stopped.z);
});

test('the same commands give the same drive, bit for bit', () => {
  const commands = Array.from({ length: 600 }, (_, i) => stick(Math.sin(i / 37), Math.cos(i / 23), i % 90 < 20, i % 200 > 180));
  const hills = world((x, z) => Math.sin(x / 9) * 2 + Math.cos(z / 13) * 1.5);
  const run = (): VehicleState[] => { let state = vehicleAt({ x: 3, y: 0, z: 4 }, 0.4); return commands.map(command => (state = stepVehicle(state, command, BUGGY, hills, DT))); };
  expect(run()).toEqual(run());
});
