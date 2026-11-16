import * as v from 'valibot';
import { expect, test } from 'vitest';
import type { SimHost } from '../src/server/engine/sim';
import { NativeInventory, nativeInventories } from '../src/shared/game/inventoryLaw';
import { AuthorProofPlanSchema, AuthorProofReportSchema } from '../src/shared/host/tickProtocol';

// meta NEW-SHARD-E2E F27 (MINI-UNBLOCK MU6): an author proof reports every native pack's stacks when its tape ends, and a tape
// may require stacks (`requiredItems`), so a quest's loot is asserted, not assumed.
const PROFILE = { kinds: ['honeycomb', 'bear-claw', 'smoker'] as const, slots: 8, counts: { min: 0, max: 99, integer: true, complete: false },
  quantity: 'positive-safe-integer' as const, snapshot: 'order' as const, restoreError: 'Invalid pack' };

test('the packs a host registered read back as stacks by pack id', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pack registry keys on the host's identity alone
  const host = {} as SimHost, pack = new NativeInventory(PROFILE, host), other = new NativeInventory(PROFILE, host, 'bot:1');
  expect(nativeInventories(host)).toEqual({ pack: {}, 'bot:1': {} });
  pack.add('honeycomb', 6); pack.add('bear-claw'); other.add('smoker');
  expect(nativeInventories(host)).toEqual({ pack: { honeycomb: 6, 'bear-claw': 1 }, 'bot:1': { smoker: 1 } });
  expect(nativeInventories({} as SimHost)).toEqual({});
});

test('a tape may require stacks, and the report carries the packs', () => {
  const plan = { version: 1, tape: [[]], checkpointTick: 1, requiredFacts: ['honey.thief'], requiredItems: { honeycomb: 6, smoker: 1 } };
  expect(v.parse(AuthorProofPlanSchema, plan).requiredItems).toEqual({ honeycomb: 6, smoker: 1 });
  expect(() => v.parse(AuthorProofPlanSchema, { ...plan, requiredItems: { smoker: 0 } })).toThrow();
  const { requiredItems: _, ...plain } = plan;
  expect(v.parse(AuthorProofPlanSchema, plain)).not.toHaveProperty('requiredItems');
  const report = { version: 1, ticks: 1, checkpointTick: 1,
    grid: { reserveBeforePhysics: true, runtimeFence: true, refusedSave: true, restored: true, frozenTicks: 5, loads: 2, leasesAfterDispose: 0 },
    ledger: { facts: [], granted: 0, durableReload: true, duplicateStable: true }, inventory: { pack: { honeycomb: 6, smoker: 1 } } };
  expect(v.parse(AuthorProofReportSchema, report).inventory).toEqual({ pack: { honeycomb: 6, smoker: 1 } });
});
