import { expect, it } from 'vitest';
import { installLoadingTimeline, LoadingTimeline } from '@wildshard/engine/boot/timeline';
import { loadingStage } from '@wildshard/engine/boot/waits';
import { crossingLoadingRows, loadingPath } from './loadingPaths';

it('partitions nested stages and gaps into the exact loading wall time', () => {
  let clock = 10;
  const timeline = new LoadingTimeline({ id: 'test', steps: [
    { key: 'modules', label: 'Modules', weight: 1 }, { key: 'world', label: 'World', weight: 1 },
    { key: 'shaders', label: 'Shaders', weight: 1 },
  ] }, 0, () => clock);
  const modules = timeline.begin('modules');
  clock = 20; const world = timeline.begin('world');
  clock = 30; const shaders = timeline.begin('shaders');
  clock = 50; shaders.end();
  clock = 70; world.end();
  clock = 80; modules.end();
  clock = 100;
  const snapshot = timeline.snapshot();
  expect(snapshot.rows.map(row => [row.label, row.ms])).toEqual([['Modules', 30], ['World', 30], ['Shaders', 20]]);
  expect(snapshot.gaps.reduce((sum, row) => sum + row.ms, 0)).toBe(20);
  expect(snapshot.rows.reduce((sum, row) => sum + row.ms, 0) + snapshot.gaps.reduce((sum, row) => sum + row.ms, 0)).toBe(clock);
});

it('uses actual path rows and keeps unnamed work visible', () => {
  const path = loadingPath('grid');
  expect(path.steps.map(row => row.key)).toContain('home');
  expect(path.steps.find(row => row.key === 'road')?.label).toBe('Road system');
  expect(path.steps.map(row => row.key)).not.toEqual(expect.arrayContaining(['terrain', 'forest', 'physics']));
  let clock = 0;
  const timeline = new LoadingTimeline(path, 0, () => clock);
  const world = timeline.begin('level.world');
  const ignored = timeline.begin('forest');
  clock = 100; ignored.end(); world.end();
  const unknown = timeline.begin('Unexpected preparation');
  clock = 300; unknown.end();
  expect(timeline.snapshot().rows.find(row => row.key === 'world')).toMatchObject({ ms: 300, detail: 'Unexpected preparation' });
  expect(timeline.snapshot().rows).toHaveLength(path.steps.length);
  expect(loadingPath('legacy').steps.map(row => row.key)).toContain('terrain');
  expect(loadingPath('shardfile', undefined, true).id).toBe('shardfile');
  expect(loadingPath('shardfile', undefined, true).steps.map(row => row.key)).toContain('props');
  expect(loadingPath('crossing').steps.map(row => row.key)).toContain('checkpoint');
});

it.each(['legacy', 'shardfile', 'grid'] as const)('attributes the real level.play bridge to gameplay on %s', async path => {
  let clock = 0;
  const timeline = new LoadingTimeline(loadingPath(path), 0, () => clock);
  const release = installLoadingTimeline(timeline);
  try {
    await loadingStage('level.kit', () => { clock += 20; });
    await loadingStage('level.play', async () => {
      expect(timeline.snapshot()).toMatchObject({ current: 'gameplay', display: 'gameplay' });
      clock += 100;
      await loadingStage('menu', () => { clock += 5; });
      expect(timeline.snapshot().display).toBe('gameplay');
      clock += 10;
    });
    const rows = timeline.snapshot().rows;
    expect(rows.find(row => row.key === 'loadout')).toMatchObject({ state: 'ok', ms: 20 });
    expect(rows.find(row => row.key === 'gameplay')).toMatchObject({ state: 'ok', ms: 110 });
    expect(rows.find(row => row.key === 'menu')).toMatchObject({ state: 'ok', ms: 5 });
    expect(rows.reduce((sum, row) => sum + row.ms, 0)).toBe(clock);
  } finally { release(); }
});

it.each(['legacy', 'shardfile', 'grid'] as const)('names actual final frame/map and program-link awaits on %s', async path => {
  let clock = 0;
  const timeline = new LoadingTimeline(loadingPath(path), 0, () => clock), release = installLoadingTimeline(timeline);
  try {
    await loadingStage('finish', async () => {
      clock += 20;
      await loadingStage('readyFrame', () => {
        expect(timeline.snapshot().current).toBe('readyFrame'); clock += 1200;
      });
      await loadingStage('spawnPrograms', () => {
        expect(timeline.snapshot().current).toBe('spawnPrograms'); clock += 12000;
      });
    });
    const rows = timeline.snapshot().rows;
    expect(rows.find(row => row.key === 'readyFrame')).toMatchObject({label: 'First drawn frames and minimap', ms: 1200});
    expect(rows.find(row => row.key === 'spawnPrograms')).toMatchObject({label: 'Spawn program links', ms: 12000});
    expect(rows.find(row => row.key === 'finish')?.ms).toBe(20);
    expect(rows.reduce((sum, row) => sum + row.ms, 0)).toBe(clock);
  } finally {release();}
});

it('accounts for destination preparation, boundary wait, save, commit and activation separately', () => {
  const rows = crossingLoadingRows({ from: null, to: 'home', requestedAt: 10, readyAt: 30,
    start: 40, checkpointEnd: 42, commitEnd: 44, end: 50 });
  expect(rows.map(row => row.ms)).toEqual([20, 10, 2, 2, 6]);
  expect(rows.reduce((sum, row) => sum + row.ms, 0)).toBe(40);
});

it('carries real unit progress through aliases without granting stage completion', () => {
  const timeline = new LoadingTimeline(loadingPath('grid'), 0, () => 100);
  const stage = timeline.begin('level.world');
  timeline.report('level.world', 'Models 2 / 4', 2, 4);
  expect(timeline.snapshot().rows.find(row => row.key === 'world')).toMatchObject({ fraction: 0.4, state: 'on' });
  timeline.report('level.world', 'Models 1 / 4', 1, 4);
  expect(timeline.snapshot().rows.find(row => row.key === 'world')?.fraction).toBe(0.4);
  stage.end();
  expect(timeline.snapshot().rows.find(row => row.key === 'world')?.state).toBe('ok');
});

it('keeps parallel work counts visible without charging its time twice', () => {
  let clock = 0;
  const timeline = new LoadingTimeline(loadingPath('grid'), clock, () => clock);
  const modules = timeline.begin('runtimeModules'), assembly = timeline.begin('assembly');
  clock = 200;
  timeline.report('runtimeModules', 'Runtime modules 1 / 4', 1, 4);
  const snapshot = timeline.snapshot();
  expect(snapshot.current).toBe('assembly');
  expect(snapshot.display).toBe('runtimeModules');
  expect(snapshot.rows.find(row => row.key === 'runtimeModules')).toMatchObject({ detail: 'Runtime modules 1 / 4', fraction: 0.2, ms: 0, state: 'on' });
  expect(snapshot.rows.find(row => row.key === 'assembly')?.ms).toBe(200);
  modules.end(); assembly.end();
  expect(timeline.snapshot().rows.reduce((sum, row) => sum + row.ms, 0)).toBe(200);
});

it('keeps declared numbers while an outer home step contains re-entered world construction', () => {
  let clock = 0;
  const timeline = new LoadingTimeline(loadingPath('grid'), 0, () => clock);
  const world = timeline.begin('world'); clock = 10; world.end();
  const home = timeline.begin('home'); clock = 20;
  const resumed = timeline.begin('world'); clock = 30;
  timeline.report('world', 'Neighbour rows 2 / 4', 2, 4);
  const current = timeline.snapshot();
  expect(current.rows.filter(row => row.state !== 'todo').map(row => [row.number, row.key])).toEqual([
    [1, 'modules'], [5, 'world'], [13, 'home'], [14, 'world#2'],
  ]);
  expect(current.current).toBe('world#2');
  expect(current.display).toBe('home');
  expect(current.rows.find(row => row.key === current.current)).toMatchObject({ label: 'Region world · pass 2', detail: 'Neighbour rows 2 / 4', ms: 10 });
  expect(current.rows.find(row => row.key === 'world')).toMatchObject({ state: 'ok', ms: 10 });
  const parallel = timeline.begin('render'); clock = 40; parallel.end();
  expect(timeline.snapshot().current).toBe('world#2');
  resumed.end(); clock = 50; home.end();
  expect(timeline.snapshot().rows.reduce((sum, row) => sum + row.ms, 0)).toBe(50);
});

it('declares the grid home cell\'s second passes up front, so the step total never grows mid-load', () => {
  let clock = 0;
  const path = loadingPath('grid'), timeline = new LoadingTimeline(path, 0, () => clock), total = timeline.snapshot().rows.length;
  expect(path.steps.filter(row => row.key.endsWith('#2')).map(row => row.label)).toEqual(['Region world · pass 2', 'Equipment and HUD · pass 2']);
  for (const name of ['level.world', 'level.kit', 'home', 'render', 'roster']) { const stage = timeline.begin(name); clock += 10; stage.end(); }
  const rows = timeline.snapshot().rows;
  expect(rows).toHaveLength(total);
  expect(rows.filter(row => row.key.endsWith('#2')).map(row => [row.key, row.state, row.ms])).toEqual([['world#2', 'ok', 10], ['loadout#2', 'ok', 10]]);
  // A further undeclared pass reuses the declared repeated row.
  const third = timeline.begin('world'); clock += 10; third.end();
  expect(timeline.snapshot().rows).toHaveLength(total);
  expect(timeline.snapshot().rows.find(row => row.key === 'world#2')).toMatchObject({ label: 'Region world · pass 2', state: 'ok', ms: 20 });
});

it('keeps one fixed ordered list and monotone display through module passes, nested renderer and final shaders', () => {
  let clock = 0;
  const path = loadingPath('shardfile'), timeline = new LoadingTimeline(path, 0, () => clock);
  const samples: number[] = [];
  const sample = (): void => {
    const view = timeline.snapshot();
    expect(view.rows.map(row => row.key)).toEqual(path.steps.map(row => row.key));
    const shown = view.rows.find(row => row.key === view.display);
    if (shown !== undefined) samples.push(shown.number);
  };
  const run = (key: string): void => { const active = timeline.begin(key); clock += 10; sample(); active.end(); sample(); };
  run('modules'); run('product'); run('manifest.load'); run('level.data');
  const files = timeline.begin('audioFiles'); sample();
  const world = timeline.begin('level.world'); sample();
  run('renderer'); files.end(); sample(); world.end();
  run('level.kit'); run('level.play');
  const finish = timeline.begin('finish'); sample(); run('shaders'); run('firstFrame'); run('audio'); finish.end();
  expect(samples).toEqual([...samples].sort((a, b) => a - b));
  expect(timeline.snapshot().rows.filter(row => row.key.startsWith('modules'))).toHaveLength(1);
});
