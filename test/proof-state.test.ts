// oxlint-disable-next-line import/no-nodejs-modules -- A fresh realm proves page.evaluate can serialize the reader without imports.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { readProofState } from '../src/scripts/proof-state.mjs';

function snapshot(window: object, creatureKinds: string[] = ['boar']) {
  return runInNewContext(`(${readProofState.toString()})({creatureKinds})`, { window, creatureKinds }) as ReturnType<typeof readProofState>;
}
const local = () => ({ appState: 'playing', quest: { adventure: [], level: [] }, creatures: [], player: { health: 100 } });
const cells = [{ instance: 'wrong-first', slug: 'wrong' }, { instance: 'honey', slug: 'honeyknoll' }];
function page(cell = 2) {
  return {
    __wildshard: { world: {}, state: local, shard: { grid: { state: () => ({ cells, inside: 'honey' }) } } },
    __workerClient: () => ({ cell, flags: [], quests: {} }),
    __workerClientNet: () => ({ client: { flags: () => new Set(['shared', 'both']), phased: new Set(['private', 'both']), quests: new Map([
      ['honey.quest', { quest: 'honey.quest', started: true, step: 'boar', n: 1 }],
    ]) } }),
    __workerClientRows: (kind: string) => kind === 'boar' ? [{ x: 6.7, y: 0, z: 2 }] : [],
  };
}

test('MMO proofs read the seat, private quests and creature rows rather than the empty shell', () => {
  const result = snapshot(page());
  expect(result?.quest.flags).toEqual(['both', 'private', 'shared']);
  expect(result?.quest.quests).toEqual([{ quest: 'honey.quest', started: true, step: 'boar', n: 1 }]);
  expect(result?.creatures).toEqual([{ kind: 'boar', pos: { x: 6.7, y: 0, z: 2 } }]);
  expect(result?.seat).toMatchObject({ cell: 2, instance: 'honey', slug: 'honeyknoll', status: 'cell' });
  expect(snapshot(page(0))?.seat).toMatchObject({ cell: 0, instance: null, status: 'road' });
  expect(snapshot(page(99))?.seat).toMatchObject({ instance: null, status: 'unknown' });
});

test('local dev uses the worker report when the dev-only net reader is absent', () => {
  const original = page();
  const { __workerClientNet: _net, ...rest } = original;
  const dev = { ...rest, __workerClient: () => ({ cell: 2, flags: ['found'], quests: { 'honey.quest': null } }) };
  const result = snapshot(dev);
  expect(result?.quest.flags).toEqual(['found']);
  expect(result?.quest.quests).toEqual([{ quest: 'honey.quest', started: true, step: null }]);
  expect(result?.creatures).toHaveLength(1);
});

test('local probes preserve authored quests, and the title is explicitly unavailable', () => {
  const state = { ...local(), quest: { adventure: ['local-quest'], level: ['found'] }, creatures: [{ kind: 'boar', pos: { x: 1, y: 2, z: 3 }, hp: 8 }] };
  expect(snapshot({ __wildshard: { world: {}, state: () => state, area: () => ({ flags: ['found'] }) } })).toMatchObject({ quest: { adventure: ['local-quest'], flags: ['found'] }, creatures: state.creatures, seat: null });
  expect(snapshot({})).toBeNull();
});

test('a retired browser probe is unavailable without invoking its retired state reader', () => {
  expect(snapshot({ __wildshard: { world: undefined, state: () => { throw new Error('Debug level has retired'); } } })).toBeNull();
});
