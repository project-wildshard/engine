// @vitest-environment node
// MIRROR-SALT-ZONE MSZ11: the view from a vehicle's seat (Jake's call 7, B). First person from the seat: the eye at the seat's
// height on the vehicle (sat or stood), the look the player's, a wider field of view past top speed (through the camera's
// zoom, since the held weapon owns its fov); one press away the chase view, behind and above, pulled in at a wall and eased
// back out. Through the ride: a seat sets the player's eye and pushes the `drive` context, where V (or a tap on the gauge)
// swaps the views; leaving hands the camera back with its own field of view.
import { MathUtils, PerspectiveCamera } from 'three';
import { afterEach, expect, test } from 'vitest';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import type { PlayerEye } from '@wildshard/engine/player/Player';
import type { MoverPose } from '@wildshard/format/moverPose';
import { INPUT_CONTEXTS } from '../inputContexts';
import { vehiclePoint } from './followedMovers';
import { CHASE, PORTRAIT_DROP, SEAT_EYE, SEAT_PITCH, SEAT_WIDEN, SeatEye, seatWiden, type SeatNow } from './seatView';
import { installVehicleRide } from './steerRide';

const BASE_FOV = 72, HANDLING = { speed: 20, boost: 1.5 } as const;
const poseAt = (x: number, y: number, z: number, yaw: number): MoverPose => ({ position: { x, y, z }, euler: { x: 0, y: yaw, z: 0 }, enabled: true });
/** The field of view a camera shows: its fov through its zoom. */
const shownFov = (camera: PerspectiveCamera): number => MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom));

let scope: Scope | null = null;
afterEach(() => { scope?.dispose(); scope = null; });

test('the eye sits at the seat\'s height on the vehicle, sat or stood, looking where the player looks', () => {
  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 500), look = { yaw: 0.9, pitch: -0.2 };
  let seat: SeatNow = { pose: poseAt(10, 2, 5, 0.35), at: [-0.45, 0.9, 0.3], sit: 'sit', speed: 0, handling: HANDLING };
  const eye = new SeatEye({ seat: () => seat, look, chase: () => false });
  eye.pose(camera, 1 / 60);
  const [x, y, z] = vehiclePoint(seat.pose, [-0.45, 0.9 + SEAT_EYE.sit, 0.3]);
  expect([camera.position.x, camera.position.y, camera.position.z]).toEqual([x, y, z]);
  expect(camera.position.y).toBeCloseTo(2 + 0.9 + 0.88, 9); // the seat's base, then the seated eye: lower than on foot (1.68)
  expect([camera.rotation.order, camera.rotation.y, camera.rotation.x, camera.rotation.z]).toEqual(['YXZ', 0.9, -0.2, 0]);
  seat = { ...seat, at: [0, 0.83, 1.2], sit: 'stand' }; // the land-sail's deck
  eye.pose(camera, 1 / 60);
  expect(camera.position.y).toBeCloseTo(2 + 0.83 + 1.6, 9);
  camera.aspect = 402 / 874; eye.pose(camera, 1 / 60); // a portrait phone's taller view tips further down the road
  expect(camera.rotation.x).toBeCloseTo(-0.2 - PORTRAIT_DROP, 9);
  camera.aspect = 1;
  seat = { ...seat, pose: poseAt(10, 2, -20, 0.35) }; // the vehicle moves on: the eye rides it within the frame
  eye.pose(camera, 1 / 60);
  expect(camera.position.z).toBeCloseTo(vehiclePoint(seat.pose, [0, 0, 1.2])[2], 9);
});

test('the field of view widens past top speed: none below 60%, +6° at top speed, +14° at the boosted top', () => {
  expect(seatWiden(0, HANDLING)).toBe(0);
  expect(seatWiden(SEAT_WIDEN.from * HANDLING.speed, HANDLING)).toBe(0);
  expect(seatWiden(HANDLING.speed, HANDLING)).toBeCloseTo(SEAT_WIDEN.top, 9);
  expect(seatWiden(HANDLING.speed * HANDLING.boost, HANDLING)).toBeCloseTo(SEAT_WIDEN.boost, 9);
  expect(seatWiden(HANDLING.speed * 3, HANDLING)).toBeCloseTo(SEAT_WIDEN.boost, 9); // a tail wind past the boost widens no more
  expect(seatWiden(HANDLING.speed * 2, { speed: 20, boost: 1 })).toBeCloseTo(SEAT_WIDEN.top, 9); // a kind with no boost stops at top
  let previous = -1;
  for (let speed = 0; speed <= 32; speed += 0.5) { const widen = seatWiden(speed, HANDLING); expect(widen).toBeGreaterThanOrEqual(previous); previous = widen; }
  // through the camera: the held weapon's fov stays, the zoom widens what shows, and leaving the seat gives it back
  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 500);
  let seat: SeatNow = { pose: poseAt(0, 0, 0, 0), at: [0, 0.9, 0], sit: 'sit', speed: 0, handling: HANDLING };
  const eye = new SeatEye({ seat: () => seat, look: { yaw: 0 }, chase: () => false });
  eye.pose(camera, 1 / 60);
  expect(camera.fov).toBe(BASE_FOV); expect(shownFov(camera)).toBeCloseTo(BASE_FOV, 6);
  seat = { ...seat, speed: HANDLING.speed * HANDLING.boost };
  eye.pose(camera, 1 / 60);
  expect(camera.fov).toBe(BASE_FOV); expect(shownFov(camera)).toBeCloseTo(BASE_FOV + SEAT_WIDEN.boost, 6);
  eye.release();
  expect(camera.zoom).toBe(1);
});

test('the chase view stands behind and above, pulls in at a wall at once and eases back out', () => {
  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 500), yaw = 0.35, pose = poseAt(4, 0, -6, yaw);
  let wall = Infinity;
  const eye = new SeatEye({ seat: () => ({ pose, at: [-0.45, 0.9, 0.3], sit: 'sit', speed: 0, handling: HANDLING }), look: { yaw, pitch: SEAT_PITCH }, chase: () => true,
    clear: (from, to) => Math.min(wall, Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)) });
  const pivot = { x: 4, y: 0.9 + SEAT_EYE.sit, z: -6 }, full = Math.hypot(CHASE.back, CHASE.up);
  const reach = (): number => Math.hypot(camera.position.x - pivot.x, camera.position.y - pivot.y, camera.position.z - pivot.z);
  eye.pose(camera, 1 / 60);
  expect(reach()).toBeCloseTo(full, 6);
  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) }; // a vehicle's heading
  expect((camera.position.x - pivot.x) * forward.x + (camera.position.z - pivot.z) * forward.z).toBeLessThan(-4); // behind
  expect(camera.position.y).toBeGreaterThan(pivot.y); // above
  expect(camera.rotation.x).toBeCloseTo(-CHASE.tilt, 9); // the seat's rest pitch looks down a touch, over the vehicle
  wall = 2; eye.pose(camera, 1 / 60);
  expect(reach()).toBeCloseTo(2 - CHASE.margin, 6); // pulled in short of the wall, in one frame
  eye.pose(camera, 1 / 60);
  expect(camera.rotation.x).toBeLessThan(-CHASE.tilt - 0.05); // and tilted further down, so the vehicle stays in frame
  wall = 0.5; eye.pose(camera, 1 / 60);
  expect(reach()).toBeCloseTo(CHASE.near, 6); // never into the driver's head
  wall = Infinity; eye.pose(camera, 1 / 60);
  expect(reach()).toBeGreaterThan(CHASE.near); expect(reach()).toBeLessThan(full - 1); // easing out, not popping
  for (let i = 0; i < 180; i++) eye.pose(camera, 1 / 60);
  expect(reach()).toBeCloseTo(full, 3);
});

test('a seat hands the player its eye and the drive context; V and a tap on the gauge swap the views; leaving hands it back', () => {
  scope = new Scope('seat-view-ride');
  const drive = INPUT_CONTEXTS.find(row => row.id === 'drive'); if (drive === undefined) throw new Error('Missing drive context');
  for (const def of INPUT_CONTEXTS.filter(row => row.id === 'onFoot' || row.id === 'drive')) app.input.register(def, scope);
  app.input.push('onFoot', scope);
  const systems: SystemSpec[] = [], camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 500);
  const player: { yaw: number; pitch: number; position: { x: number; y: number; z: number }; eye: PlayerEye | null; ride: null; hover: boolean; swimming: boolean; wading: boolean } =
    { yaw: 2, pitch: 0, position: { x: 0, y: 0, z: 0 }, eye: null, ride: null, hover: false, swimming: false, wading: false };
  let seat: { vehicle: string; seat: number } | undefined, tap: (() => void) | null = null;
  const pose = poseAt(0, 0, 0, 0.5);
  const port = { seatOf: () => seat, pose: () => pose, clear: () => Infinity,
    kindOf: () => ({ seats: [{ role: 'driver', at: [-0.45, 0.9, 0.3] as const, pose: 'sit' as const }], handling: HANDLING }) };
  installVehicleRide(() => port, { system: spec => { systems.push(spec); }, scope, player, boost: () => false,
    view: { show: () => undefined, tap: run => { tap = run; } } });
  const frame = (): void => { for (const system of systems) system.run(1 / 60, 0); player.eye?.pose(camera, 1 / 60); };
  frame();
  expect(player.eye).toBe(null); expect(app.input.top).toBe('onFoot');
  seat = { vehicle: 'yard.buggy:me', seat: 0 }; frame();
  expect(player.eye).not.toBe(null); expect(app.input.top).toBe('drive');
  expect(camera.position.y).toBeCloseTo(0.9 + SEAT_EYE.sit, 9); // the seat's eye
  expect(player.pitch).toBe(SEAT_PITCH); // boarding looks down the road
  app.input.press('drive.view'); frame();
  expect(camera.position.y).toBeGreaterThan(2); // the chase view
  expect(app.input.pressed('dodge')).toBe(false); // V is no dodge in a seat
  (tap as (() => void) | null)?.(); frame();
  expect(camera.position.y).toBeCloseTo(0.9 + SEAT_EYE.sit, 9); // a tap on the gauge swaps back
  camera.zoom = 0.8; seat = undefined; frame();
  expect(player.eye).toBe(null); expect(app.input.top).toBe('onFoot'); expect(camera.zoom).toBe(1);
  expect(drive.keys?.['drive.view']).toEqual(['KeyV']);
});
