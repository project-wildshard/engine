// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// FORMAT-PRUNE FP53b: a runtime plan's keeper step is gone, but a live save taken before it still carries the keeper's
// continuation. The installer retires that id, so the save restores without it and the next save leaves it out.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const KEEPER = 'far.population';
const keeperState = { version: 1, rng: { s: 7 }, tokens: [], homes: [], boss: null };

/** A pre-FP53b host: its keeper step registers a continuation beside the bodies. */
function oldSave(): ReturnType<typeof snapshotSimHost> {
  const host = createSimHost(SIM_LEVEL, { rapier });
  host.onStep(KEEPER, () => undefined, { snapshot: () => keeperState, restore: () => undefined });
  host.step(); host.step();
  const saved = snapshotSimHost(host); host.dispose(); return saved;
}

test('a save carrying a retired continuation restores without it, and the next save leaves it out', () => {
  const saved = oldSave();
  expect(saved.adapters.map(entry => entry.id)).toContain(KEEPER);
  const back: SimHost = restoreSimHost(SIM_LEVEL, { rapier }, saved, fresh => { fresh.retireAdapter(KEEPER); });
  try {
    expect(back.state.tick).toBe(saved.state.tick);
    back.step();
    expect(snapshotSimHost(back).adapters.map(entry => entry.id)).not.toContain(KEEPER);
  } finally { back.dispose(); }
});

test('an installer that does not retire it still refuses the save, and a retired id cannot be registered', () => {
  const saved = oldSave();
  expect(() => restoreSimHost(SIM_LEVEL, { rapier }, saved, () => undefined)).toThrow('Snapshot instance registrations do not match');
  const host = createSimHost(SIM_LEVEL, { rapier });
  try {
    host.onStep('live.step', () => undefined, { snapshot: () => null, restore: () => undefined });
    expect(() => { host.retireAdapter('live.step'); }).toThrow('Invalid retired registration live.step');
  } finally { host.dispose(); }
});
