import { expect, test } from 'vitest';
import type { LedgerRule } from '@wildshard/format/ledger';
import { PlayerStore } from '../src/server/host/dedicated/playerStore';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { carryRetiredLedger, Ledger, type LedgerCatalogueItem, type LedgerState } from '../src/shared/game/ledger';

// TEMPLATE-E2E TC-SHIP-g: Brasscap Mesa's API slug was blender-template until TC-SHIP-a. The profile ledger keys achievements
// and catalogue entitlements by shard slug, so what a player earned under the old slug must count under the new one.
const OLD = 'blender-template', NEW = 'brasscap-mesa', INSTANCE = 'blender-template';
const origin = { kind: 'engine', source: 'quests' } as const;
const rules: LedgerRule[] = [
  { fact: 'bounty.wyrm', origin, rewards: [{ kind: 'achievement', id: 'wyrm-slayer', title: 'Wyrm Slayer', threshold: 1 }] },
  { fact: 'bounty.badge', origin, rewards: [{ kind: 'catalogue', item: 'badge', tier: 0, quantity: 1 }] },
];
const catalogue: LedgerCatalogueItem[] = [{ id: 'badge', maxTier: 0 }];
const fact = (shard: string, name: string, tick: number, instance = INSTANCE) => ({ instance, shard, revision: 3, entity: 'player', tick, ordinal: 0, name, origin });
const input = (slug: string) => ({ shard: { identity: { slug, revision: 3 }, ledger: rules }, catalogue }) as unknown as HeadlessRuntimeInput;

test('an achievement and an entitlement earned under the retired slug count under its replacement', () => {
  const before = new PlayerStore({}, () => undefined);
  const old = new Ledger(before.saves, [{ id: INSTANCE, shard: OLD }], [{ shard: OLD, revision: 3, rules }], catalogue);
  expect(old.record(fact(OLD, 'bounty.wyrm', 1)).status).toBe('granted');
  expect(old.record(fact(OLD, 'bounty.badge', 2)).status).toBe('granted');

  // the server reads the player's saved profile back after the rename (a fresh room, the same documents)
  const after = new PlayerStore(before.documents(), () => undefined), facts = after.facts(input(NEW), INSTANCE);
  expect(facts.achievement('wyrm-slayer'), 'the profile read under the new slug').toEqual({ count: 1, earned: true });
  const ledger = new Ledger(after.saves, [{ id: INSTANCE, shard: NEW }], [{ shard: NEW, revision: 3, rules }], catalogue);
  expect(ledger.record(fact(NEW, 'bounty.wyrm', 5)).status, 'earned once, never again').toBe('duplicate');
  expect(ledger.record(fact(NEW, 'bounty.badge', 6)).status, 'the catalogue grant is not paid twice').toBe('duplicate');
  expect(Object.values(ledger.state().items)).toEqual([{ item: 'badge', tier: 0, quantity: 1 }]);
  expect(ledger.state().achievements[JSON.stringify([OLD, 'wyrm-slayer'])], 'the old entry stays').toMatchObject({ earned: true });
});

test('a new slug keeps its own progress, and a profile with nothing retired is left alone', () => {
  const state: LedgerState = { facts: {}, entitlements: {}, items: {}, achievements: {
    [JSON.stringify([OLD, 'a'])]: { shard: OLD, id: 'a', title: 'A', count: 1, threshold: 3, earned: false },
    [JSON.stringify([NEW, 'a'])]: { shard: NEW, id: 'a', title: 'A', count: 2, threshold: 3, earned: false },
    [JSON.stringify([OLD, 'b'])]: { shard: OLD, id: 'b', title: 'B', count: 1, threshold: 1, earned: true },
  } };
  expect(carryRetiredLedger(state, [[OLD, NEW]])).toBe(true);
  expect(state.achievements[JSON.stringify([NEW, 'a'])]?.count, 'the entry under the new slug wins').toBe(2);
  expect(state.achievements[JSON.stringify([NEW, 'b'])]).toEqual({ shard: NEW, id: 'b', title: 'B', count: 1, threshold: 1, earned: true });
  expect(carryRetiredLedger(state, [[OLD, NEW]]), 'a second pass adds nothing').toBe(false);
  const other: LedgerState = { facts: {}, entitlements: { 'not json': { grants: 1, lastTick: 0 } }, items: {}, achievements: {} };
  expect(carryRetiredLedger(other, [[OLD, NEW]])).toBe(false);
});

test('a dedicated room named after the retired slug pays nothing twice once it carries the new name', () => {
  const before = new PlayerStore({}, () => undefined);
  for (const instance of [OLD, `${OLD}-solo`]) {
    const old = new Ledger(before.saves, [{ id: instance, shard: OLD }], [{ shard: OLD, revision: 3, rules }], catalogue);
    expect(old.record(fact(OLD, 'bounty.badge', 2, instance)).status).toBe('granted');
  }
  for (const instance of [NEW, `${NEW}-solo`]) {
    const after = new PlayerStore(before.documents(), () => undefined);
    const ledger = new Ledger(after.saves, [{ id: instance, shard: NEW }], [{ shard: NEW, revision: 3, rules }], catalogue);
    expect(ledger.record(fact(NEW, 'bounty.badge', 6, instance)).status, `${instance} pays the badge once`).toBe('duplicate');
  }
});

test('a retitled achievement carries under its new title, and one the reader does not declare waits', () => {
  const before = new PlayerStore({}, () => undefined);
  const old = new Ledger(before.saves, [{ id: INSTANCE, shard: OLD }], [{ shard: OLD, revision: 3, rules }], catalogue);
  expect(old.record(fact(OLD, 'bounty.wyrm', 1)).status).toBe('granted');
  const retitled: LedgerRule[] = [{ fact: 'bounty.wyrm', origin, rewards: [{ kind: 'achievement', id: 'wyrm-slayer', title: 'Wyrm Hunter', threshold: 2 }] }];
  const after = new PlayerStore(before.documents(), () => undefined);
  const ledger = new Ledger(after.saves, [{ id: INSTANCE, shard: NEW }], [{ shard: NEW, revision: 3, rules: retitled }], catalogue);
  expect(ledger.record(fact(NEW, 'bounty.wyrm', 5)).status, 'no identity refusal; once earned, earned').toBe('duplicate');
  expect(ledger.state().achievements[JSON.stringify([NEW, 'wyrm-slayer'])]).toEqual({ shard: NEW, id: 'wyrm-slayer', title: 'Wyrm Hunter', count: 1, threshold: 2, earned: true });
  const other = new Ledger(new PlayerStore(before.documents(), () => undefined).saves, [], [], []);
  expect(other.state().achievements[JSON.stringify([NEW, 'wyrm-slayer'])], 'a reader without the rule carries nothing').toBeUndefined();
});
