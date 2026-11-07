// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { SimCommand } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { canonicalSimDigest } from './fake/simState';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import recorded from './fixtures/sim-snapshot-v1.json';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

// P1-E5.2a: old saves load. Every wire here came out of the real version 1 writer and is never re-recorded. J112 moved the
// law, so the digests and end states are where each tape reaches on the one law, re-recorded at P1-E5.3-A2, at A6 for the
// capsule (J127: only walk-strike's end moved, 1.4 mm) and at A9 for the coyote clock (the jump's digest, no end). A pass
// means the save still loads on the page's capsule and nothing about the continuation moved since.
const target = SIM_LEVEL.entities[0]?.id ?? '';
const tapes: Record<string, (tick: number) => SimCommand> = {
  'walk-strike': tick => ({ moveX: Math.sin(tick / 40), moveZ: Math.cos(tick / 55), yaw: tick / 90, ...(tick % 50 === 7 ? { attack: { targetId: target } } : {}) }),
  'versioned-jump': tick => ({ moveX: 0.3, moveZ: -0.8, yaw: 0.4, commandVersion: 1, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, sprint: true,
    ...(tick % 37 === 3 ? { jump: true as const } : {}), ...(tick === 200 ? { dodge: true as const } : {}) }),
  board: tick => ({ moveX: 0.6, moveZ: 0.2, yaw: 1, ...(tick === 5 ? { hover: true as const } : {}) }),
  swim: tick => ({ moveX: 1, moveZ: 0.05, yaw: -1.2, dive: tick % 80 > 40 }),
};

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

test.each(recorded.states)('the $name save continues exactly as the version 1 engine did', state => {
  const tape = tapes[state.name];
  if (tape === undefined) throw new Error(`No tape for ${state.name}`);
  const host = restoreSimHost(SIM_LEVEL, { rapier }, decodeSimSnapshot(state.wire), fresh => {
    if (state.water) fresh.useWater({ surfaceAt: x => x > 6 ? 2 : null });
  });
  try {
    expect(leadPlayer(host).motor.collider.radius()).toBeCloseTo(.38, 6);
    for (let tick = 0; tick < state.tail; tick++) host.step(leadCommands(host, tape(state.ticks + tick)));
    const p = leadPlayer(host).position;
    expect({ tick: host.state.tick, position: [p.x, p.y, p.z], hp: leadPlayer(host).health.attributes.health, flags: host.flags.all }).toEqual(state.end);
    expect(canonicalSimDigest(snapshotSimHostBytes(host))).toBe(state.digest);
  } finally { host.dispose(); }
});
