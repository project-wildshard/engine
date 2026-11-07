import { expect, test } from 'vitest';
import { LoadingTimeline, repeatedStep } from './timeline';

test('wall boundaries retain nested duration without changing exclusive accounting', () => {
  let now = 10;
  const timeline = new LoadingTimeline({id: 'capture', steps: ['outer', 'inner'].map(key => ({key, label: key, weight: 1}))}, now, () => now);
  const outer = timeline.begin('outer'); now = 20;
  const inner = timeline.begin('inner'); now = 50; inner.end(); now = 80; outer.end();
  expect(timeline.snapshot().rows).toMatchObject([
    {key: 'outer', startedAt: 10, endedAt: 80, ms: 40},
    {key: 'inner', startedAt: 20, endedAt: 50, ms: 30},
  ]);
  outer.end(); now = 100;
  expect(timeline.snapshot().rows[0]?.endedAt).toBe(80);
});

test('the initial row accepts only a real setup fact tied to its original clock', () => {
  const path = {id: 'fixture', steps: [{key: 'modules', label: 'Modules', weight: 1}]};
  let shown = 80;
  const timeline = new LoadingTimeline(path, 100, () => 200, {readSetup: () => shown, initialSetup: {at: 100, setup: 0}});
  timeline.begin('modules').end(); shown = 99;
  expect(timeline.snapshot().rows[0]).toMatchObject({startedAt: 100, setupAtStart: 0});
  for (const initial of [undefined, {at: 99, setup: 0}, {at: 100, setup: -1}, {at: 100, setup: 101},
    {at: 100, setup: Number.NaN}, {at: 100, setup: 2.5}]) {
    expect(new LoadingTimeline(path, 100, () => 200, {readSetup: () => shown, initialSetup: initial}).snapshot().rows[0])
      .not.toHaveProperty('setupAtStart');
  }
});

test('timeline retains the displayed setup fact at first entry without reconstructing it later', () => {
  let now = 100, shown: number | undefined = 4, reads = 0, publications = 0;
  const timeline = new LoadingTimeline({id: 'fixture', steps: ['modules', 'world', 'nested', 'future']
    .map(key => ({key, label: key, weight: 1}))}, now, () => now,
  {readSetup: () => { reads++; return shown; }, beforeStart: () => { publications++; }});
  const modules = timeline.begin('modules'); modules.end();
  now = 120; const world = timeline.begin('world');
  shown = 9; now = 130; const nested = timeline.begin('nested'); nested.end(); world.end();
  shown = 99; now = 150; const again = timeline.begin('world'); again.end();
  expect(timeline.snapshot().rows.map(row => [row.key, row.startedAt, row.setupAtStart])).toEqual([
    ['modules', 100, undefined], ['world', 120, 4], ['nested', 130, 9], ['future', undefined, undefined],
  ]);
  expect(reads).toBe(2);
  expect(publications).toBe(2);
  expect(timeline.snapshot().rows[1]?.setupAtStart).toBe(4);
  expect(reads).toBe(2);
  expect(publications).toBe(2);
  shown = undefined;
  const future = timeline.begin('future'); future.end();
  expect(timeline.snapshot().rows[3]).not.toHaveProperty('setupAtStart');
  expect(publications).toBe(3);
});

test('timeline retains first start clocks through nesting, aliases and repeated passes', () => {
  let now = 150;
  const world = {key: 'world', label: 'World', weight: 1, aliases: ['render']};
  const timeline = new LoadingTimeline({id: 'fixture', steps: [
    {key: 'modules', label: 'Modules', weight: 1}, world,
    {key: 'shaders', label: 'Shaders', weight: 1}, repeatedStep(world, 2),
  ]}, 100, () => now);
  const modules = timeline.begin('modules'); now = 200; modules.end();
  now = 250; const first = timeline.begin('render');
  now = 300; const nested = timeline.begin('shaders');
  now = 350; nested.end(); now = 400; first.end();
  now = 450; const second = timeline.begin('world'); now = 470; second.end();
  now = 480; const third = timeline.begin('render'); now = 500; third.end();
  const snapshot = timeline.snapshot();
  expect(snapshot.rows.map(row => [row.key, row.startedAt])).toEqual([
    ['modules', 100], ['world', 250], ['shaders', 300], ['world#2', 450],
  ]);
  expect(snapshot.rows.reduce((sum, row) => sum + row.ms, 0)
    + snapshot.gaps.reduce((sum, gap) => sum + gap.ms, 0)).toBe(400);
});

test('zero-duration steps retain actual equal clocks while future steps stay unknown', () => {
  let now = 10;
  const timeline = new LoadingTimeline({id: 'fixture', steps: ['modules', 'first', 'second', 'future']
    .map(key => ({key, label: key, weight: 1}))}, now, () => now);
  const modules = timeline.begin('modules'); modules.end();
  now = 20;
  const first = timeline.begin('first'); first.end();
  const second = timeline.begin('second'); second.end();
  const rows = timeline.snapshot().rows;
  expect(rows.slice(1, 3).map(row => [row.startedAt, row.ms])).toEqual([[20, 0], [20, 0]]);
  expect(rows[3]).not.toHaveProperty('startedAt');
  const row = rows[1]; if (row === undefined) throw new Error('Missing started row');
  row.startedAt = 999;
  expect(timeline.snapshot().rows[1]?.startedAt).toBe(20);
});

test('DL21: a sub-stage begun under its step\'s alias names itself on the step', () => {
  const timeline = new LoadingTimeline({id: 'fixture', steps: [{key: 'modules', label: 'Modules', weight: 1},
    {key: 'loadout', label: 'Equipment and HUD', weight: 1, aliases: ['level.kit', 'fieldModels', 'sword']}]}, 0, () => 0);
  const detail = (): string | undefined => timeline.snapshot().rows.find(row => row.key === 'loadout')?.detail;
  const kit = timeline.begin('level.kit'); expect(detail()).toBe('level kit'); kit.end();
  const models = timeline.begin('fieldModels'); expect(detail()).toBe('field models'); models.end();
  timeline.begin('sword', 'Blade of the shore'); expect(detail()).toBe('Blade of the shore');
});
