import {admissionNative} from './fixtures/nalati-return-modules';
import { expect, expectTypeOf, test, vi } from 'vitest';
import { NativeEliteRoster, NativeEliteProjection, type NativeEliteRosterRows, type NativeEliteScript } from '../src/server/engine/ai/eliteRoster';
import { NativeEliteLifecycle } from '../src/server/engine/ai/eliteLifecycle';
import type { SimHost } from '../src/server/engine/sim';
import { eliteBindings, type EliteEncounterRow, type EliteEncounterSpec } from './fixtures/nativeEliteEncounters';

import { nativeKernelOwners } from './fixtures/nativeEliteKernelOwners';
import { nativeEliteCore } from './fixtures/nativeEliteCore';
import type { EliteCoreDef } from '../src/shared/game/eliteSystem';

test('canonical roster declarations retain the original readonly public definition and wire', () => {
  expectTypeOf<NativeEliteRosterRows['rows'][number]['def']>().toEqualTypeOf<EliteCoreDef>();
  expectTypeOf<Pick<EliteEncounterRow, 'def' | 'snapshot' | 'continuation'>>().toEqualTypeOf<{
    readonly def: EliteCoreDef; readonly snapshot: string;
    readonly continuation?: { readonly borrowed?: { readonly group: number; readonly role: 'guard' }; readonly detachable?: true };
  }>();
  expectTypeOf<Pick<EliteEncounterSpec, 'step' | 'version' | 'wire'>>().toEqualTypeOf<{
    readonly step: string; readonly version: number; readonly wire: { readonly detached?: string };
  }>();
});

function method<O extends object, K extends keyof O>(owner: O, key: K): O[K] { return owner[key]; }
function fixture() {
  const f = nativeKernelOwners(), core = nativeEliteCore(f.host), bindings = eliteBindings(), order: string[] = [];
  let adapter: Parameters<SimHost['onStep']>[2], step: ((dt: number) => void) | undefined;
  const add = core.add.bind(core), initialize = core.initialize.bind(core), update = core.update.bind(core);
  vi.spyOn(core, 'add').mockImplementation(script => { order.push(`add:${script.def.id}`); return add(script); });
  const initialized = vi.spyOn(core, 'initialize').mockImplementation(() => { order.push('initialize'); initialize(); });
  const updated = vi.spyOn(core, 'update').mockImplementation((dt, t) => { order.push('update'); return update(dt, t); });
  Object.defineProperty(f.host, 'onStep', { value: (_id: string, fn: (dt: number) => void, saved: Parameters<SimHost['onStep']>[2]) => {
    order.push('step'); step = fn; adapter = saved; return () => undefined;
  } });
  const kernels = f.rows.map((row, i) => ({ ...row, id: `quarry.${String(i * 2)}` }));
  const rows = ['quarry.0', 'quarry.borrowed', 'quarry.2'].map((id, i) => ({
    def: { id, rule: 'storm' as const, lair: { x: kernels[i === 2 ? 1 : 0]?.lair.x ?? 0, z: kernels[i === 2 ? 1 : 0]?.lair.z ?? 0, r: 1 },
      awareR: 10, engageR: 3, leashR: 20, respawnMin: 1, name: 'Quarry watch' },
    snapshot: `unit${String(i)}`, member: { kind: f.actor.kind, variant: id, source: 'spawn' as const, yaw: 0 },
  }));
  const input = { step: 'quarry.elites', version: 1, wire: {}, rows, roles: ['native', 'borrowed', 'native'] as const, kernels };
  const loans = { host: f.host, core, bindings, kernel: f.loans };
  const borrowed = () => {
    order.push('borrowed'); const row = rows[1]; if (row === undefined) throw new Error('Missing borrowed row');
    const controller = new NativeEliteProjection({ signal: 'argymaqTick', states: { display: 1 }, bondedState: 'bonded' }, admissionNative(f.host), f.scope);
    const member = { row, controller, animal: null, phase2: false, pack: null, adopted: false, detached: false };
    const script: NativeEliteScript = { def: row.def, get animal() { return member.animal; },
      spawn: vi.fn<() => void>(), despawn: vi.fn<() => void>(), reset: vi.fn<() => void>(), enterPhase2: vi.fn<() => void>(), trophy: vi.fn<() => void>(), tick: vi.fn<NativeEliteScript['tick']>() };
    return { member, script, controller };
  };
  const save = () => { if (adapter === undefined) throw new Error('Missing original adapter'); return adapter; };
  const tick = (dt: number) => { if (step === undefined) throw new Error('Missing original step'); step(dt); };
  return { ...f, core, bindings, input, loans, borrowed, save, tick, initialized, updated, order };
}

test('native and borrowed constructors keep row order before any Core registration', () => {
  const f = fixture(), create = method(NativeEliteLifecycle.prototype, 'create');
  const spy = vi.spyOn(NativeEliteLifecycle.prototype, 'create').mockImplementation(function ordered(this: NativeEliteLifecycle, def, member) {
    f.order.push(`native:${def.id}`); return create.call(this, def, member);
  });
  try {
    const rng = f.host.rng.snapshot(), roster = new NativeEliteRoster(f.input, f.loans);
    expect(roster.borrowedIndex).toBe(1); expect(f.core.entries).toEqual([]); expect(f.order).toEqual(['native:quarry.0']);
    expect(() => roster.scripts).toThrow('Incomplete');
    const borrowed = f.borrowed(); roster.bindBorrowed(1, borrowed.member, borrowed.script);
    expect(roster.borrowedIndex).toBeNull(); expect(f.core.entries).toEqual([]);
    expect(f.order).toEqual(['native:quarry.0', 'borrowed', 'native:quarry.2']);
    expect(Object.isFrozen(roster.scripts)).toBe(true);
    expect(Reflect.set(roster.scripts, 2, borrowed.script)).toBe(false); expect(Reflect.set(roster.scripts, 'length', 1)).toBe(false);
    roster.install();
    expect(f.order).toEqual(['native:quarry.0', 'borrowed', 'native:quarry.2', 'add:quarry.0', 'add:quarry.borrowed', 'add:quarry.2', 'step']);
    expect(f.core.entries[1]?.script).toBe(borrowed.script); expect(roster.scripts[1]).toBe(borrowed.script);
    roster.initialize(); f.tick(.125);
    expect(f.initialized).toHaveBeenCalledTimes(1); expect(f.updated).toHaveBeenCalledExactlyOnceWith(.125, f.host.clock.now);
    expect(f.host.rng.snapshot()).toEqual(rng);
    expect(() => roster.install()).toThrow();
    f.scope.dispose(); f.tick(.5); expect(f.updated).toHaveBeenCalledTimes(1); expect(() => roster.initialize()).toThrow();
  } finally { spy.mockRestore(); f.scope.dispose(); }
});

test('whole row suffix refuses before any native controller or registration', () => {
  const f = fixture(), create = vi.spyOn(NativeEliteLifecycle.prototype, 'create'); let getters = 0;
  try {
    expect(() => new NativeEliteRoster({ get rows() { getters++; return []; } }, f.loans)).toThrow('plain JSON');
    expect(getters).toBe(0);
    const [first, borrowed, last] = f.input.rows; if (first === undefined || borrowed === undefined || last === undefined) throw new Error('Missing rows');
    for (const input of [
      { ...f.input, projections: { 'quarry.borrowed': { signal: 'tick', states: {}, bondedState: 'ready' } } },
      { ...f.input, projections: { 'quarry.0': { signal: 'tick', states: {}, bondedState: 'ready' } } },
      { ...f.input, roles: ['native'] }, { ...f.input, kernels: f.input.kernels.slice(0, 1) },
      { ...f.input, rows: [first, borrowed, { ...last, def: first.def }] },
      { ...f.input, rows: [first, borrowed, { ...last, snapshot: 'records' }] },
      { ...f.input, rows: [first, borrowed, { ...last, def: { ...last.def, rule: 'later' } }] },
      { ...f.input, rows: [first, borrowed, { ...last, member: { ...last.member, yaw: Infinity } }] },
      { ...f.input, rows: [first, { ...borrowed, continuation: { borrowed: { group: 0, role: 'guard' } } }, last] },
      { ...f.input, rows: [first, borrowed, { ...last, pack: { variants: [], kind: 'quarry', idPrefix: 'body.' } }] },
    ]) expect(() => new NativeEliteRoster(input, f.loans)).toThrow();
    expect(create).not.toHaveBeenCalled(); expect(f.core.entries).toEqual([]); expect(f.order).toEqual([]);
  } finally { create.mockRestore(); f.scope.dispose(); }
});

test('foreign or out-of-order borrowed owner refuses before suffix construction or Core registration', () => {
  const f = fixture();
  try {
    const roster = new NativeEliteRoster(f.input, f.loans), borrowed = f.borrowed();
    expect(() => roster.install()).toThrow('Incomplete');
    expect(() => roster.bindBorrowed(2, borrowed.member, borrowed.script)).toThrow('Foreign');
    expect(() => roster.bindBorrowed(1, { ...borrowed.member, row: { ...borrowed.member.row } }, borrowed.script)).toThrow('Foreign');
    expect(() => roster.bindBorrowed(1, borrowed.member, { ...borrowed.script, def: { ...borrowed.script.def } })).toThrow('Foreign');
    expect(f.core.entries).toEqual([]); expect(f.order).toEqual(['borrowed']);
    roster.bindBorrowed(1, borrowed.member, borrowed.script);
    expect(() => roster.bindBorrowed(1, borrowed.member, borrowed.script)).toThrow('Foreign');
  } finally { f.scope.dispose(); }
});

test('owner and callable replacements after borrowed construction publish no Core entries', () => {
  for (const change of ['player', 'clock', 'initialize', 'rows', 'controller', 'tick', 'getter', 'terrain', 'pins', 'scope']) {
    const f = fixture();
    try {
      const roster = new NativeEliteRoster(f.input, f.loans), borrowed = f.borrowed(); roster.bindBorrowed(1, borrowed.member, borrowed.script);
      if (change === 'player') Object.defineProperty(f.host, 'players', { value: new Map([['actor.player', {}]]) });
      else if (change === 'clock') Object.defineProperty(f.host, 'clock', { value: {} });
      else if (change === 'initialize') Object.defineProperty(f.core, 'initialize', { value: () => undefined });
      else if (change === 'rows') f.input.rows.reverse();
      else if (change === 'controller') borrowed.controller.prepareRestore = () => () => undefined;
      else if (change === 'tick') Object.defineProperty(borrowed.script, 'tick', { value: () => undefined });
      else if (change === 'getter') Object.defineProperty(borrowed.script, 'animal', { get: () => null });
      else if (change === 'terrain') Object.defineProperty(f.loans.kernel, 'terrain', { value: { heightAt: () => 0 } });
      else if (change === 'pins') Object.defineProperty(f.bindings, 'pinned', { value: new Set() });
      else f.scope.dispose();
      expect(() => roster.install()).toThrow(); expect(f.core.entries).toEqual([]); expect(f.order).toEqual(['borrowed']);
    } finally { f.scope.dispose(); }
  }
});

test('the original adapter retains the borrowed controller and exact historical wire', () => {
  const f = fixture();
  try {
    const roster = new NativeEliteRoster(f.input, f.loans), borrowed = f.borrowed(); roster.bindBorrowed(1, borrowed.member, borrowed.script); roster.install();
    const legacy = { laneT: -0, runT: -3, lastState: 'future-state', laneFrom: [-0, 2, 3], laneTo: [4, 5, -0] };
    borrowed.controller.restore(legacy);
    const saved = f.save().snapshot(), rng = f.host.rng.snapshot(); f.save().restore(saved);
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Missing saved bank');
    expect(JSON.stringify(f.save().snapshot())).toBe(JSON.stringify(saved));
    expect(borrowed.controller.snapshot()).toEqual({ ...legacy, elapsed: 0 });
    expect(Object.is(borrowed.controller.snapshot().laneFrom[0], -0)).toBe(true); expect(f.host.rng.snapshot()).toEqual(rng);
    const before = JSON.stringify(f.core.snapshot()); expect(() => f.save().restore({ ...saved, unit2: { bad: true } })).toThrow();
    expect(JSON.stringify(f.core.snapshot())).toBe(before);
  } finally { f.scope.dispose(); }
});
