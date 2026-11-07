// oxlint-disable-next-line import/no-nodejs-modules -- The item consumes the actual native host actor and combat authority.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ItemRuntime, type ItemPorts } from '../src/shared/engine/combat/items';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

test('idle tool clocks still consume fuel and process depletion callbacks before the current command snapshot', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier }), log: unknown[] = [];
  let active = true;
  const ports: ItemPorts = { actor: leadPlayer(host).health, combat: host.combat, active: () => active, hook: null,
    targets: () => { throw new Error('A light must not acquire a weapon target'); }, effect: () => { throw new Error('A light must not install a combat effect'); },
    changed(item, phase) {
      log.push([phase, item.remainingFuel, item.lightOn]);
      if (item.remainingFuel === 0) { item.queue(4); item.queue(3); }
    } };
  const item = new ItemRuntime({ id: 'light', kind: 'tool', action: null, fuelSeconds: 0.04, intensity: 1 }, ports);
  try {
    item.queue(3); item.step(0, 0.01);
    for (let tick = 1; tick <= 4; tick++) item.step(tick, 0.01);
    expect(log).toEqual([['light', 1, true], ['light', 0, false], ['light', 1, false], ['light', 1, true]]);
    expect(item.snapshot()).toEqual({ version: 1, id: 'light', tick: 4, cooldown: 0, fuel: 1, lit: true, held: false, chargeTime: 0, pending: [] });
    active = false; item.queue(3); item.step(5, 0.01);
    const saved = item.snapshot();
    expect(saved).toEqual({ version: 1, id: 'light', tick: 5, cooldown: 0, fuel: 0.75, lit: true, held: false, chargeTime: 0, pending: [] });
    item.restore(saved); expect(item.snapshot()).toEqual(saved);
    saved.pending.push({ action: 3, aim: null });
    item.step(6, 0.01); expect(item.remainingFuel).toBe(0.5); expect(item.lightOn).toBe(true);
    const before = item.snapshot();
    for (const [tick, dt] of [[6, 0.01], [7, 0], [7, Number.NaN], [Number.NaN, 0.01]] as const) {
      expect(() => { item.step(tick, dt); }).toThrow('Invalid item tick'); expect(item.snapshot()).toEqual(before);
    }
  } finally { host.dispose(); }
});

test('an empty weapon queue still advances held charge and cooldown through native fire and detached restore', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier }), log: string[] = [];
  const attack = { id: 'swing', damage: 1, cooldown: 0.5, range: 3, width: 1, tags: [], effect: null };
  const item = new ItemRuntime({ id: 'weapon', kind: 'weapon', light: attack, heavy: attack, charge: 0.2 }, {
    actor: leadPlayer(host).health, combat: host.combat, targets: () => [], hook: null,
    effect: () => { throw new Error('No contacted target'); }, changed: (_item, phase) => { log.push(phase); },
  });
  const aim = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  try {
    item.hold(true, aim); item.step(0, 0.125); item.step(1, 0.125);
    expect(item.snapshot()).toEqual({ version: 1, id: 'weapon', tick: 1, cooldown: 0, fuel: 1, lit: false, held: true, chargeTime: 0.25, pending: [] });
    item.hold(false, aim); item.step(2, 0.125); item.step(3, 0.125);
    expect(log).toEqual(['fire']);
    const saved = item.snapshot();
    expect(saved).toEqual({ version: 1, id: 'weapon', tick: 3, cooldown: 0.375, fuel: 1, lit: false, held: false, chargeTime: 0, pending: [] });
    item.restore(saved); saved.cooldown = 9; item.step(4, 0.125);
    expect(item.remainingCooldown).toBe(0.25); expect(log).toEqual(['fire']);
  } finally { host.dispose(); }
});
