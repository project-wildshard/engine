// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimCommand, type SimHost } from '../src/server/engine/sim';
import { leadCommands, leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { decodeSimSnapshot, leadSnapshot, serializeSimSnapshot, snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { simWireV1 } from './fake/simState';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E5.3: the motion state a step reads is state, so it survives a save.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const wet = (fresh: SimHost): void => { fresh.useWater({ surfaceAt: x => x > 2 ? .3 : null }); };
const walkEast: SimCommand = { moveX: 1, moveZ: 0, yaw: -Math.PI / 2 };

function wading(): SimHost {
  const host = createSimHost(SIM_LEVEL, { rapier });
  wet(host);
  for (let tick = 0; tick < 240 && !leadPlayer(host).wading; tick++) host.step(leadCommands(host, walkEast));
  expect(leadPlayer(host).wading).toBe(true);
  return host;
}

test('the depth a wade reads survives a restore', () => {
  const host = wading(), depth = leadPlayer(host).footing.depth;
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, snapshotSimHost(host), wet);
  try {
    expect({ ...leadPlayer(restored).footing }).toEqual({ ...leadPlayer(host).footing });
    expect(depth).toBeGreaterThan(0);
    for (let tick = 0; tick < 30; tick++) {
      host.step(leadCommands(host, walkEast)); restored.step(leadCommands(restored, walkEast));
      expect(leadPlayer(restored).position.toArray()).toEqual(leadPlayer(host).position.toArray());
    }
  } finally { restored.dispose(); host.dispose(); }
});

test('a seat on a cable survives a restore: its next tick takes no free step', () => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  leadPlayer(host).carried = true;
  const saved = snapshotSimHost(host), restored = restoreSimHost(SIM_LEVEL, { rapier }, saved);
  try {
    const seat = leadPlayer(restored), from = seat.position.clone();
    expect(leadSnapshot(saved).carried).toBe(true);
    expect(seat.carried).toBe(true); expect(seat.led).toBe(true);
    restored.step(leadCommands(restored, walkEast));
    expect(seat.position.distanceTo(from)).toBe(0);
  } finally { restored.dispose(); host.dispose(); }
});

test('an older save rebuilds the feet from its pose', () => {
  const host = wading(), wire = simWireV1(serializeSimSnapshot(snapshotSimHost(host)));
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, decodeSimSnapshot(wire), wet);
  try {
    expect(leadPlayer(restored).wading).toBe(true);
    expect(leadPlayer(restored).footing.depth).toBe(leadPlayer(host).footing.depth);
  } finally { restored.dispose(); host.dispose(); }
});

test('an older save stands on the page\'s capsule (J127)', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), saved = snapshotSimHost(host), { motor } = leadSnapshot(saved);
  host.dispose();
  const old = createSimHost(SIM_LEVEL, { rapier }), { collider } = leadPlayer(old).motor;
  collider.setShape(new rapier.Capsule(.55, .35));
  const wire = simWireV1(serializeSimSnapshot(snapshotSimHost(old)));
  old.dispose();
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, decodeSimSnapshot(wire));
  try {
    expect(motor.climbAngle).toBeCloseTo(40 * Math.PI / 180, 5);
    const player = leadPlayer(restored);
    expect(player.motor.collider.radius()).toBeCloseTo(.38, 6);
    for (let tick = 0; tick < 30; tick++) restored.step(leadCommands(restored, walkEast));
    expect(player.fall.grounded).toBe(true); expect(player.position.x).toBeGreaterThan(.5);
  } finally { restored.dispose(); }
});
