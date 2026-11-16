import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the tracked regional hook without a browser world.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Strip the hook's types while preserving its production scheduling.
import {stripTypeScriptTypes} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Controlled region/frame ports isolate warm-up ownership.
import {runInNewContext} from 'node:vm';

function fixture(options: {region?: string; retired?: boolean; retireDuringBuild?: boolean; refuseBuild?: boolean} = {}) {
  const source = readFileSync(new URL('regionalWorld.ts', import.meta.url), 'utf8');
  const start = source.indexOf('        afterKit: async () => {');
  const end = source.indexOf('\n        checkpoint:', start);
  if (start === -1 || end === -1) throw new Error('Regional creature construction hook missing');
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(function(deps) {
    const {resident, frame, app, scene, sky, host, ports, left, RowBodies, AnimalHerdView} = deps;
    return {${source.slice(start, end)}}.afterKit;
  })`), {});
  if (typeof factory !== 'function') throw new Error('Regional creature hook missing');
  const resident = {disposed: options.retired === true}, region = options.region ?? 'destination';
  const calls: {step: string; frame: string}[] = [];
  let current = 'page';
  const frame = {run: <T>(_app: object, run: () => T): T => {
    const previous = current; current = region;
    try {return run();} finally {current = previous;}
  }};
  const pause = (): Promise<void> => Promise.resolve();
  function HerdView(): void {expect(current).toBe(region);}
  class Bodies {
    constructor() {calls.push({step: 'construct', frame: current});}
    async build(givenPause: unknown, givenFrame: unknown): Promise<this> {
      expect(givenPause).toBe(pause); expect(givenFrame).toBe(frame);
      calls.push({step: 'build', frame: current});
      await pause();
      if (options.refuseBuild) throw new Error('models refused');
      if (options.retireDuringBuild) resident.disposed = true;
      calls.push({step: 'prepared', frame: current});
      return this;
    }
    stageWarmRigs(): void {calls.push({step: 'warm', frame: current});}
  }
  const hook: unknown = Reflect.apply(factory, undefined, [{resident, frame, app: {}, scene: {}, sky: {}, host: {physics: {}},
    ports: {pause}, left: () => resident.disposed, RowBodies: Bodies, AnimalHerdView: HerdView}]);
  if (typeof hook !== 'function') throw new Error('Regional creature operation missing');
  return {calls, run: (): Promise<unknown> => Promise.resolve(Reflect.apply(hook, undefined, []))};
}

test('a prepared regional herd stages its hidden rigs under its own frame before returning', async () => {
  const f = fixture(); await f.run();
  expect(f.calls).toEqual([
    {step: 'construct', frame: 'destination'}, {step: 'build', frame: 'page'},
    {step: 'prepared', frame: 'page'}, {step: 'warm', frame: 'destination'},
  ]);
});

test('neighbouring retained herds warm their own species rather than the page or another region', async () => {
  const first = fixture({region: 'forest'}), second = fixture({region: 'sky'});
  await Promise.all([first.run(), second.run()]);
  expect(first.calls.filter(call => call.step === 'warm')).toEqual([{step: 'warm', frame: 'forest'}]);
  expect(second.calls.filter(call => call.step === 'warm')).toEqual([{step: 'warm', frame: 'sky'}]);
});

test.each([{retired: true}, {retireDuringBuild: true}, {refuseBuild: true}])('retired or failed construction never stages rigs: %j', async options => {
  const f = fixture(options);
  await expect(f.run()).rejects.toThrow(options.refuseBuild ? 'models refused' : /left/);
  expect(f.calls.some(call => call.step === 'warm')).toBe(false);
});
