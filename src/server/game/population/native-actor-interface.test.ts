import { expect, test } from 'vitest';
import { NativeActors } from './actors';
import { EntityIds } from '@wildshard/engine/entities/ids';

interface Body { readonly name: string; alive: boolean }

// A fictitious salt-marsh shard reserves a heron, keeps its dead sentry as a corpse, and owns a trap body.
test('fictitious shard identities distinguish dormant, dead and retired bodies and preserve allocator order', () => {
  const actors = new NativeActors<Body>('creature', 8), oracle = new EntityIds('creature');
  const dormant = { id: actors.allocate(), kind: 'heron', variant: 'reed' };
  expect(dormant.id).toBe(oracle.allocate());
  actors.dormant(dormant, { group: 'flock.north', encounter: 'watch.at.dusk', listed: false });
  expect(actors.actor(dormant.id)).toBeNull(); expect(actors.identity(dormant.id)?.state).toBe('dormant');
  const body: Body = { name: 'watcher', alive: true };
  actors.materialize(dormant, body); body.alive = false;
  expect(actors.identity(dormant.id)).toMatchObject({ state: 'materialized', group: 'flock.north', listed: false });
  expect(actors.actor(dormant.id)).toBe(body);
  expect(() => { actors.materialize(dormant, body); }).toThrow('materialized');
  actors.adoptAuxiliary({ id: 'trap.left', actor: dormant.id, service: 'traps', handle: 42 });
  expect(() => { actors.retire(dormant.id); }).toThrow('auxiliary');
  expect(() => { actors.adoptAuxiliary({ id: 'trap.right', actor: dormant.id, service: 'traps', handle: 42 }); }).toThrow('aliased');
  actors.releaseAuxiliary('trap.left'); actors.sleep(dormant.id);
  expect(actors.actor(dormant.id)).toBeNull(); expect(actors.identity(dormant.id)?.state).toBe('dormant');
  actors.materialize(dormant, body); actors.retire(dormant.id);
  expect(actors.identity(dormant.id)?.state).toBe('retired');
  expect(() => { actors.materialize(dormant, body); }).toThrow('identity');
  expect(actors.allocate()).toBe(oracle.allocate()); expect(actors.allocatorState()).toEqual(oracle.snapshot());
});

test('versioned actor restore validates every identity and handle without changing state or resolving dormant bodies', () => {
  const live: Body = { name: 'gate sentry', alive: true }, actors = new NativeActors<Body>('creature', 8);
  const id = actors.allocate(), asleep = actors.allocate();
  actors.materialize({ id, kind: 'mudcrab', variant: 'blue' }, live);
  actors.own(id, { group: 'shore', encounter: null, listed: true });
  actors.dormant({ id: asleep, kind: 'heron', variant: 'white' });
  actors.adoptAuxiliary({ id: 'trap', actor: id, service: 'traps', handle: 5 });
  const saved = actors.snapshot(), next = new NativeActors<Body>('creature', 8);
  next.materialize({ id, kind: 'mudcrab', variant: 'blue' }, live);
  const before = next.snapshot(), commit = next.prepareRestore(saved);
  expect(next.snapshot()).toEqual(before); commit();
  expect(next.snapshot()).toEqual(saved); expect(next.actor(id)).toBe(live); expect(next.actor(asleep)).toBeNull();
  for (const invalid of [
    { ...saved, version: 2 }, { ...saved, allocator: { next: -1, used: [] } },
    { ...saved, actors: [...saved.actors, saved.actors[0]] },
    { ...saved, auxiliary: [...saved.auxiliary, { id: 'other', actor: id, service: 'traps', handle: 5 }] },
    { ...saved, auxiliary: [{ id: 'trap', actor: asleep, service: 'traps', handle: 5 }] },
  ]) {
    expect(() => next.prepareRestore(invalid)).toThrow(); expect(next.snapshot()).toEqual(saved);
  }
  expect(() => new NativeActors<Body>('creature', 8).prepareRestore(saved)).toThrow(); expect(next.snapshot()).toEqual(saved);
});

test('adopting an authored identity before allocation cannot issue it again', () => {
  const actors = new NativeActors<Body>('creature', 8);
  actors.dormant({ id: 'creature:0', kind: 'heron', variant: 'reed' });
  expect(actors.allocate()).toBe('creature:1');
  expect(actors.allocatorState()).toEqual({ next: 2, used: ['creature:0', 'creature:1'] });
});
