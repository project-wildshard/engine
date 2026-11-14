import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Test the actual boot prefix without a GPU renderer.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase only repository source types in the scheduling harness.
import {stripTypeScriptTypes} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real prefix with explicit controlled preparation ports.
import {runInNewContext} from 'node:vm';

// ROAD-PRELOAD RP3 (meta docs/plans/ROAD-PRELOAD-PLAN.md, J320: "I just want to be able to instantaneously go onto the
// road"): the grid page gains control only once the road around the cell is live. Today that holds by order: the session
// installs every inner-ring strip collider before it publishes (`GridSession.create`), and LOAD's `road` step waits for the
// inner road look (`finish.ts`, `grid.roadLanded()`). These pin both, so a change that moves either after control fails here.

function finishPrefix(roadLanded: () => Promise<void>) {
  const source = readFileSync(new URL('finish.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function finishStage('), end = source.indexOf('  const programs =', start);
  if (start === -1 || end < start) throw new Error('Boot finish prefix missing');
  const calls: string[] = [];
  const method: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end).replace('export ', '')}}; finishStage`), {
    initialHomeMetadataRequired: () => true,
    loadingStage: async (name: string, run: () => Promise<void>) => {calls.push(name); await run();},
    registerBeforeReload: () => {calls.push('reload');},
    macrotask: () => Promise.resolve(),
    enterSkyClock: () => {calls.push('sky-clock');}, app: {},
  });
  if (typeof method !== 'function') throw new Error('Boot finish prefix is not callable');
  const ctx = {
    session: {ownedGridHome: true},
    gridLive: {enterInitialHome: () => Promise.resolve()},
    grid: {waitInitialHomeMetadata: () => Promise.resolve(), roadLanded, prepareFrame: () => {calls.push('frame');}},
    game: {levelScope: {}, prepareComposer: () => Promise.resolve(), buildComposer: () => {calls.push("build");}, sky: {prepareLayers: () => {calls.push('layers');}}},
    animals: {stageWarmRigs: () => {calls.push('warm-rigs');}},
  };
  return {calls, run: (): Promise<void> => Reflect.apply(method, undefined, [ctx]) as Promise<void>};
}

test('the grid page reaches the frame steps only after the inner road look has landed', async () => {
  let land = (): void => undefined;
  const landed = new Promise<void>(resolve => {land = resolve;});
  const f = finishPrefix(() => landed);
  let finished = false;
  const run = f.run().then(() => {finished = true; return finished;});
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  expect(f.calls).toContain('road');
  expect(f.calls).not.toContain('warm-rigs');
  expect(f.calls).not.toContain('frame');
  expect(finished).toBe(false);
  land(); await run;
  expect(f.calls.slice(f.calls.indexOf('road'))).toEqual(['road', 'warm-rigs', 'frame', 'layers']);
});

test('a road that never lands never reaches control', async () => {
  const f = finishPrefix(() => Promise.reject(new Error('road refused')));
  await expect(f.run()).rejects.toThrow('road refused');
  expect(f.calls).not.toContain('warm-rigs');
});

test('the grid session installs every inner-ring strip collider before it publishes', () => {
  const source = readFileSync(new URL('../grid/session.ts', import.meta.url), 'utf8');
  const create = source.slice(source.indexOf('  static async create('), source.indexOf('\n  constructor(host: GridSessionHost'));
  const loop = create.indexOf('for (const { mesh } of strips) {'), install = create.indexOf('installStripCollider(host.physics, mesh, host.scope);', loop);
  const publish = create.indexOf('new GridSession(host, edges, allocator, strips,');
  expect(loop).toBeGreaterThan(-1);
  expect(install).toBeGreaterThan(loop);
  expect(publish).toBeGreaterThan(install);
  // the session it publishes says so, and a session built without them installs them in its constructor
  expect(create.slice(publish, create.indexOf('\n', publish))).toContain('collidersInstalled: true');
  expect(source).toContain("if (preparedRoad?.collidersInstalled !== true) for (const { mesh } of this.strips) installStripCollider(host.physics, mesh, host.scope);");
});
