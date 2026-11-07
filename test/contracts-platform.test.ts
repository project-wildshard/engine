import { expect, test } from 'vitest';
import { CONTRACTS } from './fixtures/pine-contracts';
import { parseContractCatalogue } from '@wildshard/format/contracts';
import { ContractBoard, CONTRACT_ACTION } from '../src/shared/game/quest/contractBoard';
import { contractKill, counts, draw, loadBoard, newBoard, recordKill, saveBoard } from '../src/shared/game/quest/contracts';

// A made-up island has two notices, different species/ranks, a tag objective,
// a first-claim finish and four-item rewards. It has no lodge or Pine ids.
const island = () => parseContractCatalogue({
  program: CONTRACTS.program,
  id: 'island.notices', store: 'notices', slots: 2, attempts: 7,
  initial: [{ kind: 'hunt', target: 'crab' }, { kind: 'clear', target: 'invader' }],
  fallback: { kind: 'hunt', target: 'gull' },
  draws: [{ below: 0.2, kind: 'hunt', targets: ['crab', 'gull'] }, { below: 1, kind: 'clear', targets: ['invader'] }],
  ranks: { plain: 0, bright: 1, royal: 2 }, defaultRank: 'plain',
  tags: [{ tag: 'invader', any: [{ kind: 'crab', variant: 'armoured' }, { label: 'Old Invader' }] }],
  matches: [{ kind: 'hunt', match: 'species', excludeTags: ['invader'], excludeElite: false },
    { kind: 'clear', match: 'tag', excludeTags: [], excludeElite: false },
    { kind: 'shine', match: 'rarity', excludeTags: [], excludeElite: true, belowRank: 2 },
    { kind: 'champion', match: 'elite', excludeTags: [], excludeElite: false }],
  milestones: [{ claimed: 1, skin: 'sea-glass' }], species: [], rarity: [],
  elites: { captain: { name: 'Captain', kind: 'gull', variant: 'crowned' } }, eliteIds: ['captain'],
  rows: [
    { id: 'crabs', kind: 'hunt', target: 'crab', need: 2, title: 'Crabs', goal: 'Find two',
      reward: { items: ['shell', 'pearl', 'kelp', 'salt'].map(id => ({ id, n: 1 })), bolts: 4 } },
    { id: 'gulls', kind: 'hunt', target: 'gull', need: 1, title: 'Gulls', goal: 'Find one', reward: { items: [], bolts: 0 } },
    { id: 'clear', kind: 'clear', target: 'invader', need: 1, title: 'Clear', goal: 'Clear one', reward: { items: [], bolts: 0 } },
    { id: 'shine', kind: 'shine', target: 'bright', need: 1, title: 'Bright', goal: 'Find one', reward: { items: [], bolts: 0 } },
    { id: 'captain', kind: 'champion', target: 'captain', need: 1, title: 'Captain', goal: 'Find one', reward: { items: [], bolts: 0 } },
  ],
});
const here = { x: 4, y: 2, z: 9 };
test('death rows classify overlapping variants and legacy labels before board exclusions', () => {
  const contracts = island(), board = newBoard(contracts);
  const armoured = contractKill(contracts, { kind: 'crab', variant: 'armoured' });
  expect(armoured.tags).toEqual(['invader']);
  expect(contractKill(contracts, { kind: 'gull', variant: 'armoured' }).tags).toEqual([]);
  expect(contractKill(contracts, { kind: 'gull', label: 'Old Invader' }).tags).toEqual(['invader']);
  expect(contractKill(contracts, { kind: 'crab', variant: 'armoured', label: 'Old Invader' }).tags).toEqual(['invader']);
  expect(contractKill(contracts, { kind: 'gull', variant: 'crowned' }).elite).toBe('captain');
  recordKill(contracts, board, armoured);
  expect(board.slots.map(row => row.have)).toEqual([0, 1]);
});
test('another shard accepts, counts, completes, rewards and tears through rows alone', () => {
  const contracts = island(), board = new ContractBoard({ contracts, prompt: here, radius: 3 });
  expect(board.snapshot().board.slots).toHaveLength(2);
  board.use(CONTRACT_ACTION.open, { ...here, x: 7 });
  expect(board.active).toBe(false); // strict prompt radius, as the page picker
  board.use(CONTRACT_ACTION.open, here); expect(board.active).toBe(true);
  expect(board.use(CONTRACT_ACTION.claim0, here)).toBeNull();
  board.killed({ kind: 'crab', elite: null, tags: ['invader'] });
  expect(board.snapshot().board.slots.map(row => row.have)).toEqual([0, 1]);
  for (let i = 0; i < 4; i++) board.killed({ kind: 'crab', elite: null, tags: [] });
  expect(board.snapshot().board.slots[0]?.have).toBe(2);
  expect(board.use(CONTRACT_ACTION.claim0, here)).toEqual({
    reward: { items: ['shell', 'pearl', 'kelp', 'salt'].map(id => ({ id, n: 1 })), bolts: 4, skin: 'sea-glass' }, streak: 1,
  });
  expect(board.snapshot().board).toMatchObject({ next: 3, claimed: 1, streak: 1, best: 1 });
  board.use(CONTRACT_ACTION.tear0, here);
  expect(board.snapshot().board).toMatchObject({ next: 4, claimed: 1, streak: 0, best: 1 });
  board.use(CONTRACT_ACTION.close, here); const closed = board.snapshot();
  board.use(CONTRACT_ACTION.tear0, here); expect(board.snapshot()).toEqual(closed);
  board.use(CONTRACT_ACTION.open, here); const before = board.snapshot();
  for (const bad of [Number.NaN, Infinity, 10.5, 19, 29, -1]) board.use(bad, here);
  expect(board.snapshot()).toEqual(before);
});

test('generic predicates overlap, exclude tags and elites, and respect authored rarity bounds', () => {
  const contracts = island();
  for (const [kind, target, kill, expected] of [
    ['hunt', 'crab', { kind: 'crab', elite: null, tags: [] }, true],
    ['hunt', 'crab', { kind: 'crab', elite: null, tags: ['invader'] }, false],
    ['shine', 'bright', { kind: 'crab', rarity: 'bright', elite: null, tags: [] }, true],
    ['shine', 'bright', { kind: 'crab', rarity: 'royal', elite: null, tags: [] }, false],
    ['shine', 'bright', { kind: 'gull', rarity: 'bright', elite: 'captain', tags: [] }, false],
    ['champion', 'captain', { kind: 'gull', elite: 'captain', tags: [] }, true],
  ] as const) {
    const row = contracts.rows.find(value => value.kind === kind && value.target === target);
    if (row === undefined) throw new Error('Missing fixture offer');
    expect(counts(contracts, { ...row, serial: 0, have: 0 }, kill)).toBe(expected);
  }
});

test('saved serials resume silently, reward content is rebuilt, and malformed restore is atomic', () => {
  const contracts = island(), board = new ContractBoard({ contracts, prompt: here, radius: 3 });
  board.use(CONTRACT_ACTION.open, here); board.killed({ kind: 'crab', elite: null, tags: [] });
  const saved = board.snapshot(), replay = new ContractBoard({ contracts, prompt: here, radius: 3 });
  replay.restore(saved); expect(replay.snapshot()).toEqual(saved);
  for (const bad of [{ ...saved, board: { ...saved.board, next: 0 } },
    { ...saved, board: { ...saved.board, slots: [] } },
    { ...saved, board: { ...saved.board, slots: saved.board.slots.map(row => ({ ...row, serial: 0 })) } },
    { ...saved, board: { ...saved.board, slots: saved.board.slots.map(row => ({ ...row, target: 'absent' })) } },
    { ...saved, board: { ...saved.board, best: 8 } },
    { ...saved, board: { ...saved.board, slots: saved.board.slots.map(row => ({ ...row, have: 100 })) } }]) {
    expect(() => { replay.restore(bad); }).toThrow(); expect(replay.snapshot()).toEqual(saved);
  }
  for (const owner of [board, replay]) {
    owner.killed({ kind: 'crab', elite: null, tags: [] });
    expect(owner.use(CONTRACT_ACTION.claim0, here)?.reward.skin).toBe('sea-glass');
  }
  expect(replay.snapshot()).toEqual(board.snapshot());
  const page = newBoard(contracts); recordKill(contracts, page, { kind: 'crab', elite: null, tags: [] });
  expect(loadBoard(contracts, saveBoard(page))).toEqual(page);
  expect(Array.from({ length: 100 }, (_, serial) => draw(contracts, serial))).toEqual(
    Array.from({ length: 100 }, (_, serial) => draw(contracts, serial)));
});

test('admission refuses dangling targets and callback-shaped policy', () => {
  const good = island();
  expect(() => parseContractCatalogue({ ...good, fallback: { kind: 'hunt', target: 'absent' } })).toThrow();
  expect(() => parseContractCatalogue({ ...good, draws: [{ ...good.draws[0], below: 0.5 }] })).toThrow();
  expect(() => parseContractCatalogue({ ...good, decide: () => 1 })).toThrow();
  expect(() => parseContractCatalogue(Object.assign(new Date(), good))).toThrow();
  expect(() => parseContractCatalogue({ ...good, tags: [{ tag: 'invader', any: [{}] }] })).toThrow();
  expect(() => parseContractCatalogue({ ...good, tags: [...good.tags ?? [], ...good.tags ?? []] })).toThrow();
});
