import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Test the actual boot prefix without a GPU renderer.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase only repository source types in the scheduling harness.
import {stripTypeScriptTypes} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real prefix with explicit controlled preparation ports.
import {runInNewContext} from 'node:vm';

function fixture(options: {owned?: boolean; live?: boolean; standalone?: boolean; refuseComposer?: boolean} = {}) {
  const source = readFileSync(new URL('finish.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function finishStage('), end = source.indexOf('  const programs =', start);
  if (start === -1 || end < start) throw new Error('Boot composer prefix missing');
  const calls: string[] = [];
  const prefix = `${source.slice(start, end).replace('export ', '')}}; finishStage`;
  const method: unknown = runInNewContext(stripTypeScriptTypes(prefix), {
    initialHomeMetadataRequired: () => true,
    loadingStage: async (name: string, run: () => Promise<void>) => {calls.push(name); await run();},
    registerBeforeReload: () => {calls.push('reload');},
    macrotask: () => {calls.push('turn'); return Promise.resolve();},
    enterSkyClock: () => {calls.push('sky-clock');}, app: {},
  });
  if (typeof method !== 'function') throw new Error('Boot composer prefix is not callable');
  const ctx = {
    session: {ownedGridHome: options.owned !== false},
    gridLive: options.live === false ? null : {
      enterInitialHome: () => {calls.push('enter'); return Promise.resolve();},
    },
    grid: options.standalone === true ? null : {
      waitInitialHomeMetadata: () => {calls.push('metadata'); return Promise.resolve();},
      roadLanded: () => {calls.push('road-ready'); return Promise.resolve();},
      prepareFrame: () => {calls.push('frame');},
    },
    game: {
      levelScope: {},
      prepareComposer: () => {calls.push('prepare'); return options.refuseComposer === true ? Promise.reject(new Error('composer refused')) : Promise.resolve();},
      buildComposer: () => {calls.push('build');},
      sky: {prepareLayers: () => {calls.push('layers');}},
    },
  };
  return {calls, run: async (): Promise<void> => {await Reflect.apply(method, undefined, [ctx]);}};
}

test('initial owned home prepares one composer before world construction', async () => {
  const f = fixture(); await f.run();
  expect(f.calls).toEqual(['prepare', 'build', 'home', 'metadata', 'enter', 'reload', 'road', 'turn', 'road-ready', 'frame', 'layers']);
});

test('legacy grid entry retains late composer preparation', async () => {
  const f = fixture({owned: false}); await f.run();
  expect(f.calls).toEqual(['home', 'reload', 'road', 'turn', 'road-ready', 'prepare', 'build', 'frame', 'layers']);
});

test('standalone retains its sky clock before composer allocation', async () => {
  const f = fixture({owned: false, live: false, standalone: true}); await f.run();
  expect(f.calls).toEqual(['turn', 'sky-clock', 'prepare', 'build', 'layers']);
});

test('composer preparation refusal does not start a partial home', async () => {
  const f = fixture({refuseComposer: true});
  await expect(f.run()).rejects.toThrow('composer refused');
  expect(f.calls).toEqual(['prepare']);
});
