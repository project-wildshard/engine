import liftInputs from './fixtures/engine-lift/inputs.json' with { type: 'json' };
const { DRIFTWOOD_FEATS } = liftInputs;
// oxlint-disable-next-line import/no-nodejs-modules -- The native behaviour fixture uses the actual shipped physics binary.
import { installQuestKillSteps } from '@wildshard/engine/game/quest/killSteps';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import rows from './fixtures/engine-lift/kill-steps.json' with { type: 'json' };
import { SIM_LEVEL } from './fixtures/sim-level/level';

import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { creditNativeInventory,debitNativeInventory,NativeInventory,type NativeInventoryProfile } from '../src/shared/game/inventoryLaw';
import { commitQuestEffects } from '../src/shared/game/quest/effects';
import { QuestStepRunner } from '../src/shared/game/quest/steps';

test('native kill counters resume old progress, keep flag/emission order and refuse malformed saves', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  const bodies: { kind: string; actor: ReturnType<typeof host.spawn> }[] = [], facts: string[] = [];
  try {
    const kills = installQuestKillSteps(host, rows, DRIFTWOOD_FEATS, () => bodies, (name, identity) => {
      if (name === 'driftwood.sailor') expect(host.flags.has('dead:sailor')).toBe(true);
      facts.push(identity);
    });
    const saved = host.adapters.get(rows.step); if (saved === undefined) throw new Error('Missing existing kill continuation');
    saved.restore({ sailor: 0, crab10: 4, monkey6: 0 });
    expect(kills.count('crab10')).toBe(4);
    expect(kills.count('missing')).toBe(0); expect(kills.count('__proto__')).toBe(0); expect(kills.count('toString')).toBe(0);
    const recipe = SIM_LEVEL.entities[0]; if (recipe === undefined) throw new Error('Missing real body recipe');
    const defeat = (kind: string, id: string): void => {
      const actor = host.spawn({ ...recipe, id, spec: { ...recipe.spec, kind, hp: 1 }, at: { x: 8, y: 0, z: 8 } });
      bodies.push({ kind, actor });
      host.combat.hit({ source: 'env', sourceTags: ['cover.checked'], target: actor.combatActor(), amount: 100,
        point: actor.position.clone(), dir: new Vector3() });
      host.step();
    };
    defeat('sailor', 'sailor'); expect(facts).toContain('sailor:1');
    defeat('crab', 'crab'); expect(kills.count('crab10')).toBeGreaterThan(4); expect(facts).toContain('crab10:5');
    saved.restore({ sailor: 1, crab10: 10, monkey6: 0 });
    const emitted = facts.length; defeat('crab', 'saturated-crab'); expect(facts.length).toBe(emitted);
    const progress = kills.count('crab10');
    expect(() => saved.restore({ sailor: 1, crab10: Infinity, monkey6: 0 })).toThrow();
    expect(kills.count('crab10')).toBe(progress);
    expect(() => saved.restore({ sailor: 1, crab10: 10, monkey6: 0, extra: 1 })).toThrow();
    host.step(); expect([leadPlayer(host).position.x, leadPlayer(host).position.y, leadPlayer(host).position.z].every(Number.isFinite)).toBe(true);
  } finally { host.dispose(); }
});

test('delivery rows debit the registered native pack before flags and grants across restore', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  const profile = { kinds: ['ore', 'token'], slots: 2, counts: { min: 1, max: 1000, integer: true, complete: true },
    quantity: 'positive-safe-integer', snapshot: 'order', restoreError: 'Invalid fixture pack' } satisfies NativeInventoryProfile<string>;
  try {
    const pack = new NativeInventory(profile, host, 'satchel'), stash = new NativeInventory(profile, host, 'stash');
    expect(creditNativeInventory(host, 'satchel', { item: 'ore', count: 4 })).toBe(true);
    expect(creditNativeInventory(host, 'stash', { item: 'ore', count: 9 })).toBe(true);
    const before = pack.snapshot();
    expect(debitNativeInventory(host, 'satchel', { item: 'ore', count: 5 })).toBe(false);
    expect(pack.snapshot()).toEqual(before);
    for (const count of [0, -1, Number.NaN]) expect(() => debitNativeInventory(host, 'satchel', { item: 'ore', count })).toThrow();
    expect(() => debitNativeInventory(host, 'missing', { item: 'ore', count: 1 })).toThrow('Missing native inventory');
    expect(() => debitNativeInventory(host, 'satchel', { item: 'unknown', count: 1 })).toThrow();
    expect(pack.snapshot()).toEqual(before);
    pack.restore({ counts: { ore: 5 }, order: ['ore'] });
    const steps = new QuestStepRunner({ version: 1, guards: [], steps: [{ id: 'deliver', kind: 'deliver', target: 'smith',
      item: 'ore', count: 3, once: 'paid', effects: [{ kind: 'item', item: 'token', count: 2 }] }] });
    const order: string[] = [];
    host.scope.onDispose(host.flags.onChange((flag, on) => {
      if (flag !== 'paid' || !on) return;
      expect(pack.count('ore')).toBe(2); expect(pack.count('token')).toBe(0); order.push(flag);
    }));
    const deliver = (): void => { commitQuestEffects(host, 'satchel', steps.signal({ kind: 'deliver', target: 'smith' },
      { flags: host.flags.all, inventory: pack.snapshot().counts })); };
    deliver(); deliver();
    expect(order).toEqual(['paid']); expect(pack.snapshot()).toEqual({ counts: { ore: 2, token: 2 }, order: ['ore', 'token'] });
    expect(stash.snapshot()).toEqual({ counts: { ore: 9 }, order: ['ore'] });
  } finally { host.dispose(); }
});
