// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native motor across two worlds.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { prepareFrameMotors } from '../src/shared/engine/physics/frame';
import { groups } from '../src/shared/engine/physics/groups';
import { Physics } from '../src/shared/engine/physics/Physics';
import { floorBelow } from '../src/shared/engine/physics/query';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { TransferWalls } from '../src/shared/engine/physics/transferWalls';
import { stepPlayerMotion, type MotionWorld, type PlayerMotionState } from '../src/shared/engine/player/motion';

// ZONE-ENTRY ZE2 (RP1's hold 1): no stop at the home edge. Online the page's crossing waits on the server's say: the
// server leaves the home at 10 m and enters it at 6 m, and its word reaches the page a round trip later. Meanwhile the
// page's transfer fences hold the feet in the frame they stand in. The walk carries on through that wait and through
// the rebind itself: its ground speed never drops under 90 % of the approach.

const DT = 1 / 60, PITCH = 562.5, LAG_TICKS = 18; // 300 ms between the server's line and the page's commit
function state(x: number): PlayerMotionState {
  return { position: new Vector3(x, 0, 0), yaw: 0, tick: 0, lock: { r0: 0 }, moveScale: 1, impulse: new Vector3(), velocity: new Vector3(), fall: { grounded: true },
    shove: { t: 0, vx: 0, vz: 0 }, dash: { t: 0, vx: 0, vz: 0 }, dodge: { cd: 0, t: 0 }, jump: { ago: Infinity, left: 0 },
    board: { on: false, hoverAir: false, hoverBob: 0, onGround: false },
    swim: { on: false, stood: false, diving: false, climbTo: null, climbCooldown: 0, strokeTime: 0 },
    footing: { water: null, depth: 0, wading: false, onPlatform: false, sliding: false } };
}
interface Frame { physics: Physics; motor: CharacterMotor; walls: TransferWalls; origin: number }
function world(frame: Frame): MotionWorld {
  return { get motor() { return frame.motor; }, ride: null, hasWater: false, water: () => null, heightAt: () => 0, platforms: [],
    floor: (x, z, fromY, maxDrop) => floorBelow(frame.physics, x, z, fromY, maxDrop, frame.motor.collider, frame.motor.solidOnly), bob: () => 0,
    foot: { speed: () => 4.3, crouching: false, coyoteMs: 100 },
    boardTop: () => 14, boardCapped: () => false, jumped: () => undefined, dodged: () => undefined, landed: () => undefined, boardLanded: () => undefined,
    lunged: () => undefined, dodgeScale: () => 1, swimChanged: () => undefined, stroked: () => undefined, scratch: null };
}

test('the walk keeps its speed past the home edge while the server says so, and through the rebind', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const scope = new Scope('test.road-rebind');
  // the home frame has the cell at its origin; the road frame is the highway's, with the cell at (PITCH, 0)
  const homePhysics = new Physics(R), roadPhysics = new Physics(R);
  homePhysics.world.createCollider(R.ColliderDesc.cuboid(400, .5, 40).setTranslation(0, -.5, 0).setCollisionGroups(groups('WORLD')));
  roadPhysics.world.createCollider(R.ColliderDesc.cuboid(400, .5, 40).setTranslation(PITCH, -.5, 0).setCollisionGroups(groups('WORLD')));
  const s = state(CHUNK_HALF - 12), radius = PLAYER_CAPSULE.radius;
  const home: Frame = { physics: homePhysics, motor: new CharacterMotor(homePhysics, { ...PLAYER_CAPSULE, ...PLAYER_BODY }), walls: new TransferWalls(() => homePhysics, [{ x: 0, z: 0 }], radius, 'exit', scope), origin: PITCH };
  const road: Frame = { physics: roadPhysics, motor: home.motor, walls: new TransferWalls(() => roadPhysics, [{ x: PITCH, z: 0 }], radius, 'entry', scope), origin: 0 };
  home.motor.resetAt(s.position);
  let frame = home;
  const live: Frame = { ...home }, w = world(live);
  /** Rebind the traveller into `to`, as `live.ts` does at a fixed boundary. */
  const rebind = (to: Frame): void => {
    const member = { position: s.position, motor: frame.motor };
    const prepared = prepareFrameMotors([member], to.physics, { x: frame.origin - to.origin, z: 0 });
    to.physics.step(); prepared.commit();
    to.motor = member.motor; frame = to; Object.assign(live, to);
  };
  /** Walk `direction` (+1 out of the cell, -1 back in) until `done`; the commit lands LAG_TICKS after the server's line. */
  const leg = (direction: number, line: (cellDistance: number) => boolean, to: Frame, done: (cellDistance: number) => boolean): number[] => {
    const speeds: number[] = [];
    let crossedAt = -1;
    for (let tick = 0; tick < 900; tick++) {
      const cellDistance = Math.abs(s.position.x + frame.origin - PITCH) - CHUNK_HALF; // world feet against the cell
      if (done(cellDistance)) return speeds;
      if (crossedAt < 0 && line(cellDistance)) crossedAt = tick;
      if (crossedAt >= 0 && tick - crossedAt === LAG_TICKS && frame !== to) rebind(to);
      const before = s.position.x + frame.origin;
      frame.walls.sync(); frame.physics.step(); frame.motor.carry(s.position);
      stepPlayerMotion(s, { moveX: direction, moveZ: 0, yaw: 0 }, w, DT);
      speeds.push(Math.abs(s.position.x + frame.origin - before) / DT);
    }
    throw new Error('The leg never ended');
  };
  try {
    const out = leg(1, d => d > 10, road, d => d > 26);
    const back = leg(-1, d => d <= 6, home, d => d < -12);
    for (const [name, speeds] of [['out', out], ['back', back]] as const) {
      const cruise = speeds[90] ?? 0;
      expect(cruise, name).toBeGreaterThan(4);
      speeds.slice(90).forEach((speed, at) => { expect(speed, `${name} tick ${String(at + 90)}`).toBeGreaterThanOrEqual(cruise * 0.9); });
    }
    expect(frame).toBe(home);
  } finally { scope.dispose(); frame.motor.dispose(); homePhysics.dispose(); roadPhysics.dispose(); }
});
