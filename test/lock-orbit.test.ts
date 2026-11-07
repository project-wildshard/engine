import { beforeAll, describe, expect, test } from 'vitest';
import { LOCK_REACH } from '../src/shared/engine/player/lockOrbit';
import { simCommandOf } from '../src/server/engine/sim/playerSim';
import { GATE_Z, HostSide, loadCourseRapier, type MotionScenario } from './fixtures/motion-trace/parity';
import { floorBelow } from '../src/shared/engine/physics/query';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';

// P1-E5.3-A7, J116: the server takes a lock only for a real living body in reach. Parity covers the law; this covers the word.
const TARGET = 'lock:1', SOUTH = Math.PI;
const scenario = (lockAt: NonNullable<MotionScenario['lockAt']>): MotionScenario => ({ id: 'lock', start: { x: 40, z: 60, yaw: SOUTH }, ticks: 1, intent: () => ({}), lockAt });
const steer = { keyX: 1, keyY: 0, stickX: 0, stickY: 0 };
const command = (seq: number, lockTarget?: string) => ({ seq, viewTick: 0, yaw: SOUTH, pitch: 0, steer, buttons: 0, ...(lockTarget === undefined ? {} : { lockTarget }) });
/** How far `run` moves the feet from a body 6 m away, and whether they held the radius. */
function strafe(side: HostSide, lockTarget: string | undefined, ticks = 60): { moved: number; radius: number } {
  const { player, host } = side, x = player.position.x, z = player.position.z;
  for (let tick = 0; tick < ticks; tick++) { side.course.advance(tick); host.step(new Map([[player.id, command(tick + 1, lockTarget)]])); }
  const [body] = host.entities.values();
  if (body === undefined) throw new Error('No body');
  return { moved: Math.hypot(player.position.x - x, player.position.z - z), radius: Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z) };
}

describe('a command\'s lockTarget', () => {
  let R: Rapier;
  beforeAll(async () => { R = await loadCourseRapier(); });
  test('the wire carries it into the step', () => {
    expect(simCommandOf(command(1, TARGET))).toMatchObject({ lockTarget: TARGET });
    expect(simCommandOf(command(1))).not.toHaveProperty('lockTarget');
  });
  test('a real body in reach bends the strafe round it', () => {
    const side = new HostSide(R, scenario({ x: 40, z: 54, r0: 6 }));
    try { const held = strafe(side, TARGET); expect(side.player.lockHeld).toBe(TARGET); expect(Math.abs(held.radius - 6)).toBeLessThan(.15); } finally { side.dispose(); }
  });
  test.each([['no such body', 'nobody:9'], ['a player\'s own id', 'player']])('%s is ignored, not fatal: a straight strafe', (_name, id) => {
    const bad = new HostSide(R, scenario({ x: 40, z: 54, r0: 6 })), free = new HostSide(R, scenario({ x: 40, z: 54, r0: 6 }));
    try {
      strafe(bad, id); strafe(free, undefined);
      expect(bad.player.lockHeld).toBeNull();
      expect(bad.player.position.toArray()).toEqual(free.player.position.toArray());
    } finally { bad.dispose(); free.dispose(); }
  });
  test('a dead body lets go', () => {
    const side = new HostSide(R, scenario({ x: 40, z: 54, r0: 6 }));
    try {
      strafe(side, TARGET, 5); expect(side.player.lockHeld).toBe(TARGET);
      const [body] = side.host.entities.values();
      if (body === undefined) throw new Error('No body');
      body.alive = false;
      strafe(side, TARGET, 1); expect(side.player.lockHeld).toBeNull();
    } finally { side.dispose(); }
  });
  test('a body past the reach is refused', () => {
    const side = new HostSide(R, scenario({ x: 40, z: 60 - LOCK_REACH - 1, r0: 6 }));
    try { strafe(side, TARGET, 1); expect(side.player.lockHeld).toBeNull(); } finally { side.dispose(); }
  });
  test('a held lock survives a save and omits itself without one', () => {
    const side = new HostSide(R, scenario({ x: 40, z: 54, r0: 6 }));
    try {
      strafe(side, undefined, 1);
      expect(snapshotSimHost(side.host).players[0]).not.toHaveProperty('lock');
      strafe(side, TARGET, 30);
      const r0 = side.player.lock.r0, saved = snapshotSimHost(side.host), basis = side.host.physics.snapshot();
      expect(r0).toBeGreaterThan(5);
      const restored = restoreSimHost(side.host.level, { rapier: R }, decodeSimSnapshot(serializeSimSnapshot(saved, basis), basis));
      try { expect(leadPlayer(restored).lockHeld).toBe(TARGET); expect(leadPlayer(restored).lock.r0).toBe(r0); } finally { restored.dispose(); }
    } finally { side.dispose(); }
  });
  test('the orbit\'s radius starts where the feet stand, and a new body starts again', () => {
    const side = new HostSide(R, scenario({ x: 40, z: 54, r0: 6 }));
    try { strafe(side, TARGET, 1); expect(side.player.lock.r0).toBeCloseTo(6, 1); side.player.restoreLock(undefined); expect(side.player.lockHeld).toBeNull(); expect(side.player.lock.r0).toBe(0); } finally { side.dispose(); }
  });
});

describe('a phased gate as a floor (P1-E5.3-A13)', () => {
  let R: Rapier;
  beforeAll(async () => { R = await loadCourseRapier(); });
  test('it is no floor to the capsule it opened for, and stays one to everyone else', () => {
    const side = new HostSide(R, { id: 'gate', start: { x: -32, z: GATE_Z - 3, yaw: SOUTH }, ticks: 1, intent: () => ({}) }), { host, player } = side;
    try {
      side.course.place(0); host.physics.step();
      const below = (): number | undefined => floorBelow(host.physics, -32, GATE_Z, 10, 20, player.motor.collider, player.motor.solidOnly);
      expect(below()).toBeCloseTo(4, 1); // the bars' top
      expect(player.motor.solidOnly).toBeUndefined();
      side.phaseGate();
      expect(below()).toBeUndefined(); // the course has no ground collider: nothing under the bars
      expect(floorBelow(host.physics, -32, GATE_Z, 10, 20)).toBeCloseTo(4, 1); // a query that is not this capsule's
    } finally { side.dispose(); }
  });
});
