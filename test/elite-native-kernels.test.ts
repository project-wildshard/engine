import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
// oxlint-disable-next-line import/no-nodejs-modules -- Real native restore regression loads the shipped physics runtime.
import { readFileSync } from 'node:fs';
import { createSimHost } from '../src/server/engine/sim';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { expect, test, vi } from 'vitest';
import { NativeEliteKernels } from '../src/server/engine/ai/eliteKernels';
import { StalkerBrain, readHowlerSpec } from '../src/shared/engine/ai/stalker';
import * as reach from '../src/shared/engine/ai/reach';
import { nativeKernelOwners } from './fixtures/nativeEliteKernelOwners';

function swipe(kernel: StalkerBrain<ReturnType<typeof nativeKernelOwners>['actor']>): void {
  const saved = kernel.snapshot(); if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Missing native state');
  kernel.restore({ ...saved, st: 'swipe', hitDone: 0 });
}

test('native kernel rows preserve original kernels, contact selection and the second reach check', () => {
  const f = nativeKernelOwners(), canReach = vi.spyOn(reach, 'canReach');
  try {
    const kernels = new NativeEliteKernels(f.rows, f.loans), state = { animal: f.actor, phase2: false, pack: null };
    const first = f.rows[0]; if (first === undefined) throw new Error('Missing native row');
    const kernel = kernels.create(first.id, state); expect(kernel).toBeInstanceOf(StalkerBrain);
    kernels.bind(first.id, kernel, state, f.actor); swipe(kernel);
    canReach.mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValue(true);
    f.loans.brains.get(f.actor)?.act(f.actor);
    expect(canReach).toHaveBeenCalledTimes(4); expect(f.hit).toHaveBeenCalledTimes(1);
    expect(f.hit.mock.calls[0]?.[0]).toMatchObject({ amount: 14, cause: { kind: 'leopard', label: 'Guardian' } });
  } finally { canReach.mockRestore(); f.scope.dispose(); }
});

test('independent quarry rows choose original kernels and route only their declared lifecycle ids', () => {
  const f = nativeKernelOwners();
  try {
    const rows = f.rows.map((row, i) => ({ ...row, id: `quarry.guardian.${String(i)}`, lair: { x: 90 + i, z: -30 }, awareRadius: 12 }));
    const kernels = new NativeEliteKernels(rows, f.loans), row = rows.find(candidate => candidate.profile.pattern === 'howler');
    if (row === undefined) throw new Error('Missing native profile');
    Object.defineProperty(f.actor, 'lastHitT', { value: -Infinity });
    const kernel = kernels.create(row.id, { animal: f.actor, phase2: false, pack: null });
    kernel.spawned(f.actor); kernel.advance(f.actor, 100, 100, true, false);
    expect(f.signature).toHaveBeenCalledExactlyOnceWith(row.id); expect(f.hit).not.toHaveBeenCalled();
    expect(f.host.rng.snapshot().streams).toEqual([]);
  } finally { f.scope.dispose(); }
});

test('all native profile/contact suffixes and authored getters refuse before registration or entropy', () => {
  const f = nativeKernelOwners(), before = f.host.rng.snapshot(); let getters = 0;
  try {
    expect(() => new NativeEliteKernels({ get rows() { getters++; return f.rows; } }, f.loans)).toThrow('plain JSON');
    const first = f.rows[0]; if (first === undefined) throw new Error('Missing native row');
    for (const bad of [{ ...first, fallbackStrike: 'missing' }, { ...first, profile: { pattern: 'pouncer', spec: {} } },
      { ...first, factory: 'make.body' }, { ...first, knockdown: { ...first.knockdown, speed: Infinity } }]) {
      expect(() => new NativeEliteKernels([first, { ...bad, id: 'suffix' }], f.loans)).toThrow();
    }
    expect(getters).toBe(0); expect(f.loans.brains.size).toBe(0); expect(f.hit).not.toHaveBeenCalled();
    expect(f.host.rng.snapshot()).toEqual(before);
  } finally { f.scope.dispose(); }
});

test('a trailing pouncer rejects the original ledge bound before any controller construction', () => {
  const f = nativeKernelOwners(), before = f.host.rng.snapshot();
  try {
    const first = f.rows.find(row => row.profile.pattern === 'howler'), last = f.rows.find(row => row.profile.pattern === 'pouncer');
    if (first === undefined || last === undefined) throw new Error('Missing native profiles');
    const ledges = Array.from({ length: 7 }, (_, i) => ({ x: i, z: 0, y: 1, r: 1 }));
    expect(() => new NativeEliteKernels([first, last], { ...f.loans, ledges })).toThrow(new RangeError('Pouncer ledge bound exceeded'));
    expect(f.loans.brains.size).toBe(0); expect(f.hit).not.toHaveBeenCalled(); expect(f.signature).not.toHaveBeenCalled();
    expect(f.host.rng.snapshot()).toEqual(before);
    expect(() => new NativeEliteKernels([first], { ...f.loans, ledges })).not.toThrow();
    expect(() => new NativeEliteKernels([first, last], { ...f.loans, ledges: ledges.slice(0, 6) })).not.toThrow();
  } finally { f.scope.dispose(); }
});

test('native terrain queries preserve the original concrete sampler receiver and fence replacement', () => {
  const f = nativeKernelOwners(), receivers: object[] = [];
  try {
    const terrain = { height: 3, heightAt(x: number, z: number): number { receivers.push(this); return this.height + x - z; } };
    const kernels = new NativeEliteKernels(f.rows, { ...f.loans, terrain }), row = f.rows.find(candidate => candidate.profile.pattern === 'pouncer');
    if (row === undefined) throw new Error('Missing native profile');
    const kernel = kernels.create(row.id, { animal: f.actor, phase2: false, pack: null });
    f.actor.yOffset = 0;
    kernel.advance(f.actor, 1 / 60, 0, false, false);
    expect(receivers.length).toBeGreaterThan(0); expect(receivers.every(receiver => receiver === terrain)).toBe(true);
    expect(f.actor.yOffset).toBe(0);
    terrain.heightAt = () => 12;
    const count = receivers.length;
    expect(() => kernel.advance(f.actor, 1 / 60, 1 / 60, false, false)).toThrow('owner');
    expect(receivers).toHaveLength(count);
  } finally { f.scope.dispose(); }
});

test('native owner and callable replacement refuse before construction and ancestor disposal closes the binder', () => {
  for (const replacement of ['terrain', 'environment', 'contact', 'lifecycle', 'scope']) {
    const f = nativeKernelOwners();
    try {
      const kernels = new NativeEliteKernels(f.rows, f.loans), first = f.rows[0]; if (first === undefined) throw new Error('Missing native row');
      if (replacement === 'terrain') f.loans.terrain.heightAt = () => 4;
      else if (replacement === 'environment') Object.defineProperty(f.loans.environment, 'grassHeightAt', { value: () => 1 });
      else if (replacement === 'contact') f.loans.contacts.contact = () => true;
      else if (replacement === 'lifecycle') Object.defineProperty(f.loans.lifecycle, 'signature', { value: () => undefined });
      else f.scope.dispose();
      expect(() => kernels.create(first.id, { animal: null, phase2: false, pack: null })).toThrow('owner');
      expect(f.loans.brains.size).toBe(0); expect(f.hit).not.toHaveBeenCalled();
    } finally { f.scope.dispose(); }
  }
});

test('sliced ancestor retirement closes native callbacks before the child is disposed', () => {
  const f = nativeKernelOwners(), child = f.scope.child('entered-kernels');
  Object.defineProperty(f.host, 'scope', { value: child });
  const kernels = new NativeEliteKernels(f.rows, { ...f.loans, scope: child }), row = f.rows[0];
  if (row === undefined) throw new Error('Missing native row');
  const state = { animal: f.actor, phase2: false, pack: null }, kernel = kernels.create(row.id, state);
  kernels.bind(row.id, kernel, state, f.actor); swipe(kernel);
  f.scope.onDispose(() => undefined);
  const retirement = f.scope.disposeSteps();
  try {
    expect(retirement.next().done).toBe(false); expect(child.disposed).toBe(false); expect(child.disposing).toBe(true);
    expect(() => kernels.create(row.id, state)).toThrow('owner');
    f.loans.brains.get(f.actor)?.act(f.actor);
    expect(f.combat.damageMul?.({ source: 'env', sourceTags: [], target: leadPlayer(f.host).health, amount: 1, point: f.actor.position, dir: f.actor.position })).toBe(1);
    expect(f.hit).not.toHaveBeenCalled();
  } finally { for (const _step of retirement) { /* complete the original owner retirement */ } }
});


test('equal native damage amounts retain the declared pattern contact precedence', () => {
  const f = nativeKernelOwners(), canReach = vi.spyOn(reach, 'canReach').mockReturnValue(true), contact = vi.spyOn(f.loans.contacts, 'contact');
  try {
    const row = f.rows.find(candidate => candidate.profile.pattern === 'howler'); if (row === undefined) throw new Error('Missing native profile');
    const spec = readHowlerSpec(row.profile.spec); row.profile = { pattern: 'howler', spec: { ...spec, bite: { ...spec.bite, damage: 14 } } };
    const kernels = new NativeEliteKernels([row], f.loans), state = { animal: f.actor, phase2: false, pack: null };
    const kernel = kernels.create(row.id, state), saved = kernel.snapshot();
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Missing native state');
    kernel.restore({ ...saved, st: 'hunt', bit: false }); kernels.bind(row.id, kernel, state, f.actor);
    f.loans.brains.get(f.actor)?.act(f.actor);
    expect(contact.mock.calls[0]?.[0]).toBe(f.loans.strikes[2]);
    expect(f.hit.mock.calls[0]?.[0]).toMatchObject({ amount: 14 });
    expect(f.host.rng.snapshot().streams).toEqual([]);
  } finally { contact.mockRestore(); canReach.mockRestore(); f.scope.dispose(); }
});


test('native kernels resume against the restored physics owner after real snapshot replacement', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const level = { ...SIM_LEVEL, entities: [], quests: [] }, host = createSimHost(level, { rapier });
  const f = nativeKernelOwners(); f.actor.yOffset = 0;
  let initialPhysics: typeof host.physics | undefined;
  let kernels: NativeEliteKernels | undefined;
  let kernel: ReturnType<NativeEliteKernels['create']> | undefined;
  const row = f.rows.find(candidate => candidate.profile.pattern === 'pouncer');
  if (row === undefined) throw new Error('Missing native profile');
  let restored: typeof host | undefined;
  try {
    restored = restoreSimHost(level, { rapier }, snapshotSimHost(host), owner => {
      initialPhysics = owner.physics;
      kernels = new NativeEliteKernels(f.rows, { ...f.loans, host: owner, scope: owner.scope });
      kernel = kernels.create(row.id, { animal: f.actor, phase2: false, pack: null });
    });
    expect(restored.physics).not.toBe(initialPhysics);
    if (kernels === undefined || kernel === undefined) throw new Error('Missing restored kernel owner');
    const resumed = kernel;
    expect(() => resumed.advance(f.actor, 1 / 60, 0, false, false)).not.toThrow();
    const canReach = vi.spyOn(reach, 'canReach').mockReturnValue(true), hit = vi.spyOn(restored.combat, 'hit');
    try {
      // Install a fresh binder after instrumenting the original combat authority.
      const live = new NativeEliteKernels(f.rows, { ...f.loans, host: restored, scope: restored.scope });
      const contact = live.create(row.id, { animal: f.actor, phase2: false, pack: null });
      swipe(contact); contact.act(f.actor);
      expect(canReach).toHaveBeenCalledTimes(4);
      expect(canReach.mock.calls.every(call => call[2] === restored?.physics)).toBe(true);
      expect(hit).toHaveBeenCalledTimes(2);
    } finally { canReach.mockRestore(); hit.mockRestore(); }
  } finally { restored?.dispose(); host.dispose(); f.scope.dispose(); }
});


for (const swapAt of [1, 2]) test(`a physics replacement at reach ${String(swapAt)} refuses before damage`, () => {
  const f = nativeKernelOwners();
  let queries = 0;
  const canReach = vi.spyOn(reach, 'canReach').mockImplementation(() => {
    if (++queries === swapAt) Object.defineProperty(f.host, 'physics', { value: {} });
    return true;
  });
  try {
    const kernels = new NativeEliteKernels(f.rows, f.loans), row = f.rows.find(candidate => candidate.profile.pattern === 'pouncer');
    if (row === undefined) throw new Error('Missing native profile');
    const kernel = kernels.create(row.id, { animal: f.actor, phase2: false, pack: null });
    swipe(kernel);
    expect(() => kernel.act(f.actor)).toThrow('Replaced elite contact physics owner');
    expect(canReach).toHaveBeenCalledTimes(swapAt); expect(f.hit).not.toHaveBeenCalled();
  } finally { canReach.mockRestore(); f.scope.dispose(); }
});
