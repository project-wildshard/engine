import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import {admissionNative,admission} from './fixtures/nalati-return-modules';
import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { SimHost } from '../src/server/engine/sim';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { HerdBrain, type HerdPorts } from '../src/server/engine/ai/herd';
import { nativeEliteBindings as eliteBindings, NativeEliteRoster, type NativeEliteBond } from '../src/server/engine/ai/eliteRoster';

import { installEliteEncounters as originalInstall, type EliteEncounterPorts as OriginalPorts } from './fixtures/originalEliteEncounters';
import { nativeKernelOwners } from './fixtures/nativeEliteKernelOwners';
import { nativeEliteCore } from './fixtures/nativeEliteCore';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const profile = { signal: 'argymaqTick', states: { display: 1, charge: 2, beaten: 3 }, bondedState: 'bonded', brokenState: 'beaten', adoption: { variant: 'reward', scale: 1.3 } };
function fixture(original = false) {
  const f = nativeKernelOwners(), bindings = eliteBindings(), events: unknown[] = [];
  f.actor.variant = 'guard'; Object.defineProperties(f.actor, { hp: { value: 100, writable: true }, maxHp: { value: 100 } });
  const reward = legacyDouble<AnimalSim>({ entityId: 'reward.1', kind: f.actor.kind, variant: 'reward', alive: true, scale: 1 }); f.host.entities.set(reward.entityId, reward);
  const group = new HerdBrain([f.actor], { walkSpeed: 1, trotSpeed: 2, gallopSpeed: 3, chargeSpeed: 3, sightRadius: 10, grazingSightRadius: 5,
    coneAngle: 1, hearing: [1,2,3,4], alertThreshold: .5, flightMinDistance: 1, flightMaxDistance: 10,
    stallionVariant: 'guard', foalPrefix: 'young', snortCue: 'snort', neighCue: 'neigh', squealCue: 'squeal' }, legacyDouble<HerdPorts<AnimalSim>>({}));
  group.stallion = f.actor;
  vi.spyOn(group, 'leadAway').mockImplementation((x, z) => { events.push(['lead', x, z]); });
  const bond: NativeEliteBond & { phase: string; companion: AnimalSim | null } = { scope: f.scope, phase: 'wild', companion: null };
  let adapter: Parameters<SimHost['onStep']>[2];
  Object.defineProperty(f.host, 'onStep', { value: (_id: string, _tick: unknown, saved: Parameters<SimHost['onStep']>[2]) => { adapter = saved; return () => undefined; } });
  const row = { def: { id: 'quarry.borrowed', rule: 'always' as const, lair: { x: 0, z: 0, r: 1 }, awareR: 10, engageR: 3, leashR: 20, respawnMin: 1 }, snapshot: 'borrowed',
    member: { kind: f.actor.kind, variant: 'guard', source: 'herd' as const, yaw: 0 }, continuation: { borrowed: { group: 0, role: 'guard' as const }, detachable: true as const } };
  const input = { step: 'quarry.elites', version: 1, wire: { detached: 'detached' }, rows: [row], roles: ['borrowed'] as const, kernels: [], projections: { [row.def.id]: profile } };
  const groups = { packs: [], herds: [group] }, program = admissionNative(f.host);
  const core = original ? originalInstall(f.host, { step: input.step, version: 1, wire: input.wire, conditions: { mode: 'phase', phase: () => 'day', storm: () => false },
    rows: [{ ...row, keeper: 'herd', brokenState: profile.brokenState, onAdopted: { action: 'win-and-detach', ...profile.adoption } }],
    ports: legacyDouble<OriginalPorts>({ bindings, ledges: [], heightAt: () => 0, environment: () => f.loans.environment, herd: () => group, taming: () => ({ phase: bond.phase, tulpar: bond.companion }),
      keepers: legacyDouble<OriginalPorts['keepers']>({ herd: { rows: { signal: profile.signal, states: profile.states }, program: admission } }) }) }).core : nativeEliteCore(f.host);
  const signature = core.signature.bind(core), won = core.won.bind(core);
  vi.spyOn(core, 'signature').mockImplementation(id => { events.push(['signature', id]); signature(id); });
  vi.spyOn(core, 'won').mockImplementation(id => { events.push(['won', id, reward.scale]); won(id); });
  let roster: NativeEliteRoster | undefined;
  if (!original) { roster = new NativeEliteRoster(input, { host: f.host, core, bindings, groups }); roster.bindProjected(0, program, core); roster.install(); roster.bindBond(bond); }
  const script = core.entries[0]?.script; if (script === undefined) throw new Error('Missing projected script');
  script.spawn();
  const saved = () => { if (adapter === undefined) throw new Error('Missing native continuation'); return adapter.snapshot(); };
  const restore = () => { const value = saved(); if (adapter === undefined) throw new Error('Missing continuation'); adapter.restore(value); };
  return { ...f, core, script, saved, restore, roster, bond, reward, group, bindings, input, groups, program, events };
}

test('projected native binding matches the frozen original keeper, wire, RNG and effect order', () => {
  const old = fixture(true), next = fixture();
  try {
    for (let i = 0; i < 400; i++) {
      const state = i < 70 ? 'display' : i < 160 ? 'charge' : i < 300 ? 'watch' : 'beaten';
      for (const f of [old, next]) {
        f.group.stallionState = state; f.actor.position.set(i % 7, -0, i / 13); leadPlayer(f.host).position.set(-i / 9, 2, i % 11);
        if (i === 80) f.script.enterPhase2();
        if (i === 301) { f.bond.phase = 'bonded'; f.bond.companion = f.reward; f.group.stallion = null; }
        f.script.tick([.017,.031,.09,.004][i % 4] ?? 0, i / 60, i % 5 !== 0, false);
      }
      if (i === 40) { old.restore(); next.restore(); }
      expect(next.saved()).toEqual(old.saved()); expect(JSON.stringify(next.saved())).toBe(JSON.stringify(old.saved()));
      expect(next.events).toEqual(old.events); expect(next.host.rng.snapshot()).toEqual(old.host.rng.snapshot());
      expect(next.bindings.pinned.has(next.actor)).toBe(old.bindings.pinned.has(old.actor));
    }
    expect(next.events.some(event => Array.isArray(event) && event[0] === 'lead')).toBe(true);
    expect(next.events).toContainEqual(['won', 'quarry.borrowed', 1.3]);
    expect(next.reward.scale).toBe(old.reward.scale); expect(admissionNative(next.host)).toBe(next.program);
  } finally { old.scope.dispose(); next.scope.dispose(); }
});

test('projected binding pins original programme, group, scope and late bond owner', () => {
  for (const changed of ['program', 'group', 'bond-scope', 'bond-reader', 'group-reader', 'scope'] as const) {
    const f = fixture(), foreign = new Scope('foreign.bond');
    try {
      if (changed === 'program') vi.spyOn(f.program, 'project').mockReturnValue({ signature: 1 });
      else if (changed === 'group') f.groups.herds = [];
      else if (changed === 'bond-reader') Object.defineProperty(f.bond, 'companion', { get: () => { throw new Error('Getter invoked'); } });
      else if (changed === 'group-reader') Object.defineProperty(f.group, 'leader', { get: () => { throw new Error('Getter invoked'); } });
      else if (changed === 'bond-scope') Object.defineProperty(f.bond, 'scope', { value: foreign });
      else f.scope.dispose();
      expect(() => f.script.tick(.1, 0, true, false)).toThrow(/Retired|Replaced/); expect(f.events).toEqual([]); expect(f.reward.scale).toBe(1);
    } finally { f.scope.dispose(); foreign.dispose(); }
  }
});
