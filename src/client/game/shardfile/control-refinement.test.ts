import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { reachControl } from '@wildshard/engine/boot/prefetch';
import { ControlRefinement, FENCE_LANES, prepareSpawnView } from './controlRefinement';
import { loadingWaitState } from '@wildshard/engine/boot/loadingWaits';
import { Group, PerspectiveCamera } from 'three';
import { StreamingCamera, type StreamingView } from './streamingView';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { LEVEL_DOWNLOAD_SLOT, runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';

// Retain the loose-file radius/posed-camera rulers independently of the
// shipped whole-cell packs fence, which has its own default-mode controls.
const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), previous = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(previous); });

const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.restoreAllMocks(); });
function fixture(view?: () => StreamingView | null) {
  const level = new Scope('refine-level'), owner = new Scope('refine-owner'), position = { x: 0, z: 0 }, seen: string[] = [];
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(owner, 'raf').mockImplementation(run => { frames.push(run); return frames.length; });
  owner.onDispose(() => { frames.length = 0; });
  scopes.push(level, owner);
  const queue = new ControlRefinement(owner, level, () => position, () => Promise.resolve(), view);
  const paint = () => { const frame = frames.shift(); if (frame === undefined) throw new Error('Missing first controlled paint'); frame(1); };
  return { level, owner, queue, seen, position, paint, frames };
}

test('a high eye schedules visible work before a closer job behind the camera', async () => {
  const camera = new PerspectiveCamera(50, 0.5, 0.1, 1000);
  camera.position.set(0, 160, 0); camera.lookAt(90, 40, -25);
  const view = new StreamingCamera(new Group(), () => camera), f = fixture(() => view.read());
  const behind = f.queue.add('behind', { x: -10, y: 160, z: 0 }, () => { f.seen.push('behind'); return Promise.resolve(); });
  const front = f.queue.add('front', { x: 95, y: 50, z: -30, bounds: { min: [62.5, 0, -62.5], max: [125, 100, 0] } }, () => { f.seen.push('front'); return Promise.resolve(); });
  reachControl(f.level); f.paint(); f.paint();
  expect(await Promise.all([behind, front])).toEqual([true, true]);
  expect(f.seen).toEqual(['front', 'behind']);
});

test('the unposed boot fence follows the player once, then uses the posed camera', async () => {
  const camera = new PerspectiveCamera(50, 0.5, 0.1, 1000);
  const view = new StreamingCamera(new Group(), () => camera), read = vi.fn(() => view.read()), f = fixture(read);
  f.position.x = 500;
  const player = f.queue.add('spawn', { x: 501, y: 80, z: 0, bounds: { min: [500, 70, -1], max: [502, 90, 1] } }, () => { f.seen.push('spawn'); return Promise.resolve(); });
  const origin = f.queue.add('origin', { x: 0, y: 0, z: -10, bounds: { min: [-1, -1, -11], max: [1, 1, -9] } }, () => { f.seen.push('origin'); return Promise.resolve(); });
  await prepareSpawnView(undefined, undefined, 'player');
  expect(await player).toBe(true); expect(f.seen).toEqual(['spawn']);
  expect(read).not.toHaveBeenCalled();
  camera.position.set(0, 2, 0); camera.lookAt(0, 0, -10);
  await prepareSpawnView();
  expect(await origin).toBe(true); expect(f.seen).toEqual(['spawn', 'origin']);
  expect(read).toHaveBeenCalled();
});

test('the spawn fence takes every job within its radius, seen first, and leaves the rest to control (DL17)', async () => {
  const camera = new PerspectiveCamera(50, 0.5, 0.1, 1000);
  camera.position.set(0, 160, 0); camera.lookAt(90, 40, -25);
  const view = new StreamingCamera(new Group(), () => camera), f = fixture(() => view.read());
  const behind = f.queue.add('behind', { x: -30, y: 160, z: 30, bounds: { min: [-40, 150, 20], max: [-20, 170, 40] } }, () => { f.seen.push('behind'); return Promise.resolve(); });
  const front = f.queue.add('front', { x: 95, y: 50, z: -30, bounds: { min: [62.5, 0, -62.5], max: [125, 100, 0] } }, () => { f.seen.push('front'); return Promise.resolve(); });
  const recipe = f.queue.add('recipe', { x: 0, y: 160, z: 0 }, () => { f.seen.push('recipe'); return Promise.resolve(); });
  const high = f.queue.add('high', { x: 0, y: 500, z: 0 }, () => { f.seen.push('high'); return Promise.resolve(); });
  await prepareSpawnView();
  // the level is complete at control: a job behind the camera inside the fence runs before it too, after the seen one
  expect(f.seen).toEqual(['front', 'recipe', 'behind']);
  expect(await Promise.all([front, recipe, behind])).toEqual([true, true, true]);
  reachControl(f.level); f.paint(); f.paint();
  expect(await high).toBe(true);
  expect(f.seen).toEqual(['front', 'recipe', 'behind', 'high']);
});

test('refinement starts after controlled paint and reorders the remaining queue by the viewer', async () => {
  const f = fixture();
  const run = (id: string, x: number) => f.queue.add(id, { x, z: 0 }, () => { f.seen.push(id); if (id === 'near') f.position.x = 100; return Promise.resolve(); });
  const complete = Promise.all([run('middle', 20), run('far', 100), run('near', 1)]);
  await Promise.resolve(); expect(f.seen).toEqual([]);
  reachControl(f.level); expect(f.seen).toEqual([]); f.paint(); await Promise.resolve(); expect(f.seen).toEqual([]); f.paint();
  expect(await complete).toEqual([true, true, true]); expect(f.seen).toEqual(['near', 'far', 'middle']);
});

test('retirement before control cancels every queued read without publication', async () => {
  const f = fixture(), read = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const queued = f.queue.add('tile', { x: 0, z: 0 }, read); f.owner.dispose(); reachControl(f.level);
  expect(await queued).toBe(false); expect(read).not.toHaveBeenCalled(); expect(f.frames).toEqual([]);
});

test('retirement drains the started read and never starts the next one', async () => {
  const f = fixture(); let release = (): void => { throw new Error('Missing held refinement'); };
  const first = f.queue.add('first', { x: 0, z: 0 }, async () => {
    f.seen.push('start'); await new Promise<void>(resolve => { release = resolve; }); f.seen.push('drained');
  });
  const second = f.queue.add('second', { x: 1, z: 0 }, () => { f.seen.push('forbidden'); return Promise.resolve(); });
  reachControl(f.level); f.paint(); f.paint(); await Promise.resolve(); f.owner.dispose();
  expect(await second).toBe(false); expect(f.seen).toEqual(['start']); release();
  expect(await first).toBe(false); expect(f.seen).toEqual(['start', 'drained']);
});

test('a real source refusal is preserved and blocks later publication', async () => {
  const f = fixture(), refusal = new Error('invalid fine tile'), later = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const complete = Promise.allSettled([f.queue.add('bad', { x: 0, z: 0 }, () => { throw refusal; }), f.queue.add('later', { x: 1, z: 0 }, later)]);
  reachControl(f.level); f.paint(); f.paint();
  const results = await complete;
  for (const result of results) { if (result.status !== 'rejected') throw new Error('A refused refinement published'); const reason: unknown = result.reason; expect(reason).toBe(refusal); }
  expect(later).not.toHaveBeenCalled();
});


test('settled tile identities can return without retaining a permanent job history', async () => {
  const f = fixture(), run = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const first = f.queue.add('tile', { x: 0, z: 0 }, run);
  await expect(f.queue.add('tile', { x: 1, z: 0 }, run)).rejects.toThrow('duplicate');
  reachControl(f.level); f.paint(); f.paint(); expect(await first).toBe(true);
  expect(await f.queue.add('tile', { x: 1, z: 0 }, run)).toBe(true);
  expect(run).toHaveBeenCalledTimes(2);
});

test('MF5: the loader fence runs only spawn-view jobs before control, and the rest after it, nearest first', async () => {
  const f = fixture();
  const run = (id: string, x: number) => f.queue.add(id, { x, z: 0 }, () => { f.seen.push(id); return Promise.resolve(); });
  const far = run('far', 500), near = run('near', 10), edge = run('edge', 150);
  await Promise.resolve(); expect(f.seen).toEqual([]); // no fence, no control: nothing runs
  await prepareSpawnView(160);
  expect(f.seen).toEqual(['near', 'edge']); expect(await near).toBe(true); expect(await edge).toBe(true);
  reachControl(f.level); f.paint(); f.paint();
  expect(await far).toBe(true); expect(f.seen).toEqual(['near', 'edge', 'far']);
});

test('a refinement that fails inside the spawn fence rejects the fence instead of marking it done (DL17)', async () => {
  const f = fixture(), refusal = new Error('slab library refused');
  const job = f.queue.add('bad', { x: 0, z: 0 }, () => { throw refusal; });
  void job.catch(() => undefined);
  await expect(prepareSpawnView()).rejects.toBe(refusal);
  // the fence closed: a later fence for the same failed queue refuses too
  await expect(prepareSpawnView()).rejects.toBe(refusal);
});

test('DL21: before control the fence runs up to FENCE_LANES jobs at once and names its counted wait; after control, one', async () => {
  const f = fixture();
  let inFlight = 0, most = 0;
  const gates: (() => void)[] = [];
  const job = (id: string) => f.queue.add(id, { x: 0, y: 0, z: 0 }, async () => {
    inFlight++; most = Math.max(most, inFlight);
    await new Promise<void>(resolve => { gates.push(resolve); });
    inFlight--; f.seen.push(id);
  });
  const jobs = Array.from({ length: 6 }, (_, at) => job(`fence-${at}`));
  const fence = prepareSpawnView();
  await vi.waitFor(() => { expect(gates).toHaveLength(FENCE_LANES); });
  // The card names the wait and counts it: none done of six known.
  const wait = [...loadingWaitState().pending.values()].find(row => row.label.startsWith('Spawn view'));
  await vi.waitFor(() => { expect(wait?.progress).toMatch(/^0 of 6 · /u); });
  for (const open of gates.splice(0)) open();
  await vi.waitFor(() => { expect(gates).toHaveLength(2); });
  for (const open of gates.splice(0)) open();
  await fence;
  expect(await Promise.all(jobs)).toEqual(Array.from({ length: 6 }, () => true));
  expect(most).toBe(FENCE_LANES);
  expect([...loadingWaitState().pending.values()].some(row => row.label.startsWith('Spawn view'))).toBe(false);
  // After control the queue paces one job at a time.
  reachControl(f.level); f.paint(); f.paint();
  most = 0;
  const after = [job('play-0'), job('play-1')];
  await vi.waitFor(() => { expect(gates).toHaveLength(1); });
  gates.shift()?.(); await vi.waitFor(() => { expect(gates).toHaveLength(1); }); gates.shift()?.();
  expect(await Promise.all(after)).toEqual([true, true]);
  expect(most).toBe(1);
});

test('DL21: the fence count never goes back while a batch finishes job by job (sp-x2\'s review)', async () => {
  const f = fixture(), gates: (() => void)[] = [];
  const jobs = Array.from({ length: 6 }, (_, at) => f.queue.add(`partial-${at}`, { x: 0, y: 0, z: 0 },
    () => new Promise<void>(resolve => { gates.push(resolve); })));
  const fence = prepareSpawnView(), seen: string[] = [];
  const label = (): string => [...loadingWaitState().pending.values()].find(row => row.label.startsWith('Spawn view'))?.progress ?? '';
  await vi.waitFor(() => { expect(gates).toHaveLength(FENCE_LANES); expect(label()).toMatch(/^0 of 6 /u); });
  // Release the batch one job at a time: n rises, m stays 6.
  for (let done = 1; done <= 5; done++) {
    gates.shift()?.();
    await vi.waitFor(() => { expect(label()).toMatch(new RegExp(`^${done} of 6 `, 'u')); });
    seen.push(label().split(' · ')[0] ?? '');
    if (gates.length === 0) await vi.waitFor(() => { expect(gates.length).toBeGreaterThan(0); });
  }
  gates.shift()?.(); await fence; // the last job closes the fence and its wait
  expect(await Promise.all(jobs)).toEqual(Array.from({ length: 6 }, () => true));
  expect(seen).toEqual(['1 of 6', '2 of 6', '3 of 6', '4 of 6', '5 of 6']); expect(label()).toBe('');
});
