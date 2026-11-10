import { expect, test, vi } from 'vitest';
import { isDev, setDev } from '@wildshard/engine/core/devMode';
import { installLoadingTimeline, LoadingTimeline } from '@wildshard/engine/boot/timeline';
import { clientPreparationBatch, preparationCardLabel, timeClientPreparation } from './preparationTiming';
import { worldStep } from './client';

test('ordered marks partition the complete wall interval without counting overlapping children twice', () => {
  const previous = isDev(), prefix = 'wildshard.prepare:fixture:ordered.';
  const clock = vi.spyOn(performance, 'now'); let now = 100;
  clock.mockImplementation(() => now);
  try {
    setDev(true);
    const batch = clientPreparationBatch('fixture', 'ordered', ['read', 'join', 'publish']);
    if (batch === undefined) throw new Error('Missing Developer sequence');
    now = 137; batch.mark('read'); now = 225; batch.mark('join'); now = 252; batch.mark('publish'); batch.finish();
    const spans = ['read', 'join', 'publish'].map(phase => performance.getEntriesByName(`${prefix}${phase}`)[0]);
    expect(spans.map(span => span?.startTime)).toEqual([100, 137, 225]);
    expect(spans.map(span => span?.duration)).toEqual([37, 88, 27]);
    expect(spans.reduce((sum, span) => sum + (span?.duration ?? 0), 0)).toBe(152);
    expect(() => batch.mark('read')).toThrow('Client preparation batch is finished');
  } finally {
    setDev(previous); clock.mockRestore();
    for (const phase of ['read', 'join', 'publish']) performance.clearMeasures(`${prefix}${phase}`);
  }
});

test('preparation spans replace reentry, preserve failures and skip public work', async () => {
  const dev = isDev(), name = 'wildshard.prepare:fixture:world.data';
  try {
    setDev(true);
    expect(await timeClientPreparation('fixture', 'world.data', () => 7)).toBe(7);
    await timeClientPreparation('fixture', 'world.data', () => Promise.resolve(undefined));
    expect(performance.getEntriesByName(name)).toHaveLength(1);
    const error = new Error('preparation failed');
    await expect(timeClientPreparation('fixture', 'world.data', () => { throw error; })).rejects.toBe(error);
    const entries = performance.getEntriesByName(name);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.duration).toBeGreaterThanOrEqual(0);
    performance.clearMeasures(name);
    setDev(false);
    expect(await timeClientPreparation('fixture', 'world.data', () => 9)).toBe(9);
    expect(performance.getEntriesByName(name)).toHaveLength(0);
  } finally { setDev(dev); performance.clearMeasures(name); }
});

test('batched preparation keeps actual envelopes and elapsed totals with original results and failures', async () => {
  const previous = isDev(), prefix = 'wildshard.prepare:fixture:whole-test.';
  const clock = vi.spyOn(performance, 'now'); let now = 100;
  clock.mockImplementation(() => now);
  try {
    setDev(true);
    const batch = clientPreparationBatch('fixture', 'whole-test', ['assemble', 'decode']);
    if (batch === undefined) throw new Error('Missing Developer batch');
    expect(batch.sync('assemble', () => { now += 7; return 19; })).toBe(19);
    now = 200;
    expect(await batch.run('decode', () => { now += 13; return Promise.resolve(23); })).toBe(23);
    const failure = new Error('decode refused');
    now = 300;
    await expect(batch.run('decode', () => { now += 5; return Promise.reject(failure); })).rejects.toBe(failure);
    now = 400;
    expect(() => batch.sync('assemble', () => { now += 3; throw failure; })).toThrow(failure);
    expect(performance.getEntriesByName(`${prefix}assemble`)).toHaveLength(0);
    batch.finish(); batch.finish();
    for (const [phase, duration, total, longest] of [['assemble', 303, 10, 7], ['decode', 105, 18, 13]] as const) {
      const entries = performance.getEntriesByName(`${prefix}${phase}`), entry = entries[0];
      expect(entries).toHaveLength(1);
      if (entry === undefined) throw new Error('Missing phase envelope');
      expect(entry.duration).toBe(duration);
      const detail: unknown = Reflect.get(entry, 'detail');
      expect(detail).toEqual({ calls: 2, failures: 1, elapsedMs: total, longestMs: longest });
    }
  } finally { setDev(previous); clock.mockRestore(); for (const phase of ['assemble', 'decode']) performance.clearMeasures(`${prefix}${phase}`); }
});

test('batched preparation stays absent in public mode and replaces a completed re-entry', () => {
  const previous = isDev(), name = 'wildshard.prepare:fixture:whole-reentry.assemble';
  try {
    setDev(false); expect(clientPreparationBatch('fixture', 'whole-reentry', ['assemble'])).toBeUndefined();
    setDev(true);
    for (let entry = 0; entry < 2; entry++) {
      const batch = clientPreparationBatch('fixture', 'whole-reentry', ['assemble']);
      if (batch === undefined) throw new Error('Missing Developer batch');
      batch.sync('assemble', () => entry); batch.finish();
      const spans = performance.getEntriesByName(name);
      expect(spans).toHaveLength(1);
      if (spans[0] === undefined) throw new Error('Missing repeated phase');
      const detail: unknown = Reflect.get(spans[0], 'detail');
      expect(detail).toEqual(expect.objectContaining({ calls: 1, failures: 0 }));
    }
  } finally { setDev(previous); performance.clearMeasures(name); }
});


test('optional completion totals keep synchronous progress and actual waited failures', async () => {
  const previous = isDev(), name = 'wildshard.prepare:fixture:whole-check.yield';
  const clock = vi.spyOn(performance, 'now'); let now = 100;
  clock.mockImplementation(() => now);
  try {
    setDev(true);
    const batch = clientPreparationBatch('fixture', 'whole-check', ['yield']);
    if (batch === undefined) throw new Error('Missing Developer batch');
    expect(batch.checkpoint('yield', () => { now += 2; return undefined; })).toBeUndefined();
    now = 200;
    let finish = (): void => undefined;
    const pause = new Promise<void>(resolve => { finish = resolve; });
    const waited = batch.checkpoint('yield', () => { now += 3; return pause; });
    expect(waited).toBeInstanceOf(Promise);
    now = 250; finish(); await waited;
    const failure = new Error('original completion refusal');
    now = 300;
    expect(() => batch.checkpoint('yield', () => { now += 7; throw failure; })).toThrow(failure);
    now = 400;
    await expect(batch.checkpoint('yield', () => { now += 5; return Promise.reject(failure); })).rejects.toBe(failure);
    batch.finish();
    const spans = performance.getEntriesByName(name), entry = spans[0];
    expect(spans).toHaveLength(1);
    if (entry === undefined) throw new Error('Missing completion total');
    expect(entry.duration).toBe(305);
    const detail: unknown = Reflect.get(entry, 'detail');
    expect(detail).toEqual({ calls: 4, failures: 2, elapsedMs: 64, longestMs: 50 });
    expect(() => batch.checkpoint('yield', () => undefined)).toThrow('Client preparation batch is finished');
  } finally { setDev(previous); clock.mockRestore(); performance.clearMeasures(name); }
});

test('DL21: a running span names itself on its loading step and gives the step its detail back', async () => {
  expect(preparationCardLabel('world.world.dressing')).toBe('world dressing');
  expect(preparationCardLabel('assembly:painted')).toBe('assembly painted');
  expect(preparationCardLabel('native.presentation.props-library')).toBe('native presentation props library');
  const timeline = new LoadingTimeline({ id: 'fixture', steps: [{ key: 'modules', label: 'Modules', weight: 1 }, { key: 'region', label: 'Region world', weight: 1 }] }, 0);
  const uninstall = installLoadingTimeline(timeline);
  const detail = (): string | undefined => timeline.snapshot().rows.find(row => row.key === 'region')?.detail;
  try {
    const region = timeline.begin('region', 'Home scenes 0 / 0');
    let seen: string | undefined;
    await timeClientPreparation('fixture', 'world.world.dressing', () => { seen = detail(); });
    expect(seen).toBe('world dressing');
    expect(detail()).toBe('Home scenes 0 / 0');
    // a later report during the span is kept, not overwritten by the restore
    await timeClientPreparation('fixture', 'world.world.assembly', () => { timeline.report('region', 'Home models 3 / 9'); });
    expect(detail()).toBe('Home models 3 / 9');
    // overlapping spans (sp-x1: A starts, B starts, A ends, B ends): B shows while it runs, then the step's own detail
    let releaseA = (): void => undefined, releaseB = (): void => undefined;
    const heldA = new Promise<void>(resolve => { releaseA = resolve; }), heldB = new Promise<void>(resolve => { releaseB = resolve; });
    const a = timeClientPreparation('fixture', 'native.presentation-inputs', () => heldA);
    const b = timeClientPreparation('fixture', 'native.inputs', () => heldB);
    releaseA(); await a;
    const atAEnd = detail();
    releaseB(); await b;
    expect(atAEnd).toBe('native inputs');
    expect(detail()).toBe('Home models 3 / 9');
    // the step's own report during a span is what the step comes back to, even after a later span (sp-x1)
    let releaseC = (): void => undefined;
    const heldC = new Promise<void>(resolve => { releaseC = resolve; });
    const c = timeClientPreparation('fixture', 'native.terrain', () => heldC);
    timeline.report('region', 'Home models 4 / 9');
    await timeClientPreparation('fixture', 'native.tree-factory', () => undefined);
    releaseC(); await c;
    expect(detail()).toBe('Home models 4 / 9');
    region.end();
  } finally { uninstall(); }
  // outside a loading step the span changes nothing
  expect(await timeClientPreparation('fixture', 'world.data', () => 5)).toBe(5);
});

test('DL21: a staged world names each world part under the world data span, and the span keeps the last part', async () => {
  const timeline = new LoadingTimeline({ id: 'fixture', steps: [{ key: 'region', label: 'Region world', weight: 1 }] }, 0);
  const uninstall = installLoadingTimeline(timeline);
  const detail = (): string | undefined => timeline.snapshot().rows.find(row => row.key === 'region')?.detail;
  // the staged world's no-op progress (session.ts): before DL21 nothing but the span's own name reached the card
  const ctx = { progress: { set: vi.fn(), detail: () => undefined } }, seen: (string | undefined)[] = [];
  try {
    const region = timeline.begin('region', 'product read');
    await timeClientPreparation('fixture', 'world.data', () => {
      seen.push(detail());
      for (const part of ['library', 'materials', 'looks']) { worldStep(ctx, part); seen.push(detail()); }
    });
    expect(seen).toEqual(['world data', 'World data 1 / 10 · library', 'World data 2 / 10 · materials', 'World data 3 / 10 · looks']);
    expect(ctx.progress.set).toHaveBeenLastCalledWith(3, 10, 'looks');
    expect(detail()).toBe('World data 3 / 10 · looks');
    region.end();
  } finally { uninstall(); }
  // outside a loading step only the world's own progress hears it
  worldStep(ctx, 'skins');
  expect(ctx.progress.set).toHaveBeenLastCalledWith(4, 10, 'skins');
});
