// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real native owner with shipped physics bytes.
import { parseItems } from '@wildshard/format/items';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { installNativeMelee,type NativeMeleeCommand } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { builtFolder } from './fixtures/engine-lift/folder';
import { SIM_LEVEL } from './fixtures/sim-level/level';
const SKY_ITEMS=(await loadHeadlessFolder(builtFolder('far-reach'))).section('combat/items').items;

test('native direct gust keeps its independent clock, landing order and restore', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  const item = parseItems(SKY_ITEMS).rows[0];
  if (item?.kind !== 'weapon' || item.native === undefined) throw new Error('Missing fan native row');
  let commands: readonly NativeMeleeCommand[] = [], enabled = true;
  const landed: number[] = [];
  const native = { ...item.native }; delete native.input; delete native.held;
  try {
    const melee = installNativeMelee(host, item, native, { commands: () => commands, enabled: () => enabled,
      landed: action => { landed.push(action); } });
    commands = [{ kind: 'move', action: 2 }, { kind: 'move', action: 2 }, { kind: 'move', action: 1 }];
    host.step();
    expect(landed).toEqual([2, 1]);
    expect(melee.family.secondaryCooldown).toBe(1.6); expect(melee.family.cooldown).toBe(0.85);
    const continuation = host.adapters.get(native.step);
    if (continuation === undefined) throw new Error('Missing melee continuation');
    const saved = continuation.snapshot();
    enabled = false; host.step(); expect(landed).toEqual([2, 1]);
    continuation.restore(saved); expect(melee.family.secondaryCooldown).toBe(1.6);
    enabled = true; commands = []; for (let tick = 0; tick < 97; tick++) host.step();
    commands = [{ kind: 'move', action: 2 }]; host.step();
    expect(landed).toEqual([2, 1, 2]);
  } finally { host.dispose(); }
});
