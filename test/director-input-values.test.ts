// oxlint-disable-next-line import/no-nodejs-modules -- Native hosts consume the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare every complete native continuation field without partial tolerances.
import { deepStrictEqual } from 'node:assert';
import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { DirectorStageLane } from '../src/shared/game/plugin/director';
import { directorDayRange, type DirectorStagesData } from '@wildshard/format/directorStages';
import { inNormalizedDayRange } from '../src/shared/engine/world/dayCycle';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SimHost } from '../src/server/engine/sim';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

const data = (): DirectorStagesData => ({ version: 2, id: 'loop', script: null,
  inputs: { ready: 'flag:ready', window: 'day:0.2..0.6', other: 'flag:other' },
  stages: [{ id: 'waiting', do: [{ flag: { key: 'armed', value: true } }, { flag: { key: 'done', value: false } }],
    next: [{ target: 'active', when: 'ready && window' }] },
  { id: 'active', do: [{ flag: { key: 'done', value: true } }], next: [{ target: 'waiting', when: '!ready' }] }] });

test('live native director observations retain every original host byte across mutations and silent restore', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const source = emptyShardfile({ slug: 'director-inputs', name: 'Director', author: 'Test', seed: 31, revision: 1 }), row = data();
  source.quests.flags = ['ready', 'other', 'fresh', 'armed', 'done']; source.directors = [row];
  const current = createShardfileSim(source, new Map(), { rapier: R });
  let before: ShardfileSimulation | undefined;
  // Replace only the second host's director callback with the complete frozen
  // original observation producer; every registration and adapter stays real.
  const original: unknown = Reflect.get(SimHost.prototype, 'onStep');
  if (typeof original !== 'function') throw new Error('Missing actual native registration');
  const onStep = vi.spyOn(SimHost.prototype, 'onStep').mockImplementation(function onStep(this: SimHost, id, run, adapter, phase) {
    let callback = run, state = adapter;
    if (id === 'director.loop') {
      const director = new DirectorStageLane(row);
      callback = (_dt, native) => {
        const observation = Object.fromEntries(Object.entries(row.inputs).map(([name, binding]) => {
          const range = directorDayRange(binding);
          if (range === null) return [name, native.flags.has(binding.slice(5))];
          const clock = native.dayClock; if (clock === undefined) throw new Error('Missing director day clock');
          return [name, inNormalizedDayRange(clock.hour, range[0], range[1])];
        }));
        for (const action of director.step(native.state.tick, observation)) {
          if (!('flag' in action)) throw new Error('Director action has no native owner');
          native.flags.set(action.flag.key, action.flag.value);
        }
      };
      state = { snapshot: () => director.snapshot(), restore: value => {
        if (typeof value !== 'string') throw new Error('Invalid director row continuation'); director.restore(value);
      } };
    }
    const remove: unknown = Reflect.apply(original, this, [id, callback, state, phase]);
    if (typeof remove !== 'function') throw new Error('Missing actual native removal');
    return () => { Reflect.apply(remove, undefined, []); };
  });
  try {
    before = createShardfileSim(source, new Map(), { rapier: R }); onStep.mockRestore();
    const reference = before;
    const oldAdapter = reference.host.adapters.get('director.loop'), newAdapter = current.host.adapters.get('director.loop');
    if (oldAdapter === undefined || newAdapter === undefined) throw new Error('Missing admitted native director state');
    deepStrictEqual(snapshotSimHost(current.host), snapshotSimHost(reference.host));
    let saved: ReturnType<typeof newAdapter.snapshot> | undefined;
    for (let tick = 0; tick < 160; tick++) {
      if (tick % 13 === 0) row.inputs['ready'] = tick % 26 === 0 ? 'flag:fresh' : 'flag:ready';
      // More distinct valid bindings than the bounded decode cache retains.
      row.inputs['window'] = `day:0.${String(tick % 40).padStart(2, '0')}..1`;
      for (const host of [current.host, reference.host]) {
        host.flags.set('ready', tick % 7 < 4); host.flags.set('fresh', tick % 11 < 6); host.flags.set('other', tick % 3 === 0);
        host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
      }
      deepStrictEqual(snapshotSimHost(current.host), snapshotSimHost(reference.host));
      if (tick === 32) saved = newAdapter.snapshot();
      if (tick === 96) {
        if (saved === undefined) throw new Error('Missing original director continuation');
        const flags = current.host.flags.all; oldAdapter.restore(saved); newAdapter.restore(saved);
        deepStrictEqual(current.host.flags.all, flags); deepStrictEqual(snapshotSimHost(current.host), snapshotSimHost(reference.host));
      }
    }
    for (const invalid of ['day:0.8..0.2', 'day:invalid']) {
      row.inputs['window'] = invalid;
      expect(() => current.host.step(leadCommands(current.host, { moveX: 0, moveZ: 0, yaw: 0 }))).toThrow();
      expect(() => reference.host.step(leadCommands(reference.host, { moveX: 0, moveZ: 0, yaw: 0 }))).toThrow();
      deepStrictEqual(snapshotSimHost(current.host), snapshotSimHost(reference.host));
    }
    row.inputs['window'] = 'day:0..1';
    Object.defineProperty(row.inputs, '__proto__', { value: 'flag:ready', enumerable: true, configurable: true });
    expect(() => current.host.step(leadCommands(current.host, { moveX: 0, moveZ: 0, yaw: 0 }))).toThrow('Invalid stage director observation');
    expect(() => reference.host.step(leadCommands(reference.host, { moveX: 0, moveZ: 0, yaw: 0 }))).toThrow('Invalid stage director observation');
    deepStrictEqual(snapshotSimHost(current.host), snapshotSimHost(reference.host));
  } finally { onStep.mockRestore(); current.dispose(); before?.dispose(); }
});
