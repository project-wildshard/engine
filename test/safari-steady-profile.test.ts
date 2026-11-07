import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the actual serialized Inspector command without opening Safari
import {runInNewContext} from 'node:vm';
import {STEADY_SCRIPT_WINDOW, STEADY_TIMELINE_WINDOW} from '../scripts/frame-floor-script-profile.mjs';
import {validateFrameFloorArgs} from '../scripts/frame-floor-args.mjs';

function fixture() {
  let now = 100, stops = 0;
  let tick: () => void = () => {throw new Error('Frame watcher not installed');};
  const timers = new Map<number, () => void>();
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- model the original synchronous frame subscription API
  const game = {frameCount: 50, frameRafTime: 90, frameGate: () => true, watchFrames(callback: () => void) {
    expect(this).toBe(game);
    tick = callback;
    return () => {stops++;};
  }};
  const world = {game, hud: {entered: true, paused: false}};
  const context = {window: {__wildshard: {world}}, performance: {now: () => now},
    setTimeout(callback: () => void, delay: number) {expect(delay).toBe(30000); timers.set(1, callback); return 1;},
    clearTimeout(id: number) {timers.delete(id);}};
  return {world, context, timers, get stops() {return stops;},
    frame(at: number) {now = at; game.frameRafTime = at; game.frameCount++; tick();},
    start(timeline = false): Promise<unknown> {
      const result: unknown = runInNewContext(timeline ? STEADY_TIMELINE_WINDOW : STEADY_SCRIPT_WINDOW, context);
      return Promise.resolve(result);
    }};
}

test('steady sampling lasts twenty seconds on the same entered world and releases its watcher', async () => {
  const f = fixture(), result = f.start();
  f.frame(20099);
  expect(f.stops).toBe(0);
  f.frame(20100);
  await expect(result).resolves.toEqual({startMs: 100, endMs: 20100, elapsedMs: 20000, frames: 2});
  expect(f.stops).toBe(1);
  expect(f.timers.size).toBe(0);
  f.frame(21000);
  expect(f.stops).toBe(1);
});

test.each(['pause', 'replacement', 'deadline'] as const)('steady sampling refuses %s and cleans up', async kind => {
  const f = fixture(), result = f.start();
  if (kind === 'pause') f.world.hud.paused = true;
  if (kind === 'replacement') f.context.window.__wildshard = {world: {...f.world}};
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- trigger the stored deadline synchronously, without a thirty-second test sleep
  if (kind === 'deadline') for (const callback of f.timers.values()) callback();
  else f.frame(20100);
  await expect(result).rejects.toThrow(kind === 'deadline' ? 'no completion frame' : 'world or controls changed');
  expect(f.stops).toBe(1);
  expect(f.timers.size).toBe(0);
});

test('steady sampling refuses a non-entered world before subscribing', () => {
  const f = fixture();
  f.world.hud.entered = false;
  expect(() => f.start()).toThrow('entered, unpaused controls');
  expect(f.stops).toBe(0);
  expect(f.timers.size).toBe(0);
});

const args = ['--surface=sim', '--shards=grid', '--grid-scenario=runtime-travel', '--safari-profile=tmp/profile'];
test('steady selection requires one safe pose and a Simulator grid profile', () => {
  expect(() => validateFrameFloorArgs([...args, '--safari-steady=grid-nalati-interior'])).not.toThrow();
  for (const invalid of [
    [...args, '--safari-steady='], [...args, '--safari-steady=../escape'],
    [...args, '--safari-steady=one', '--safari-steady=two'],
    [...args.filter(arg => !arg.startsWith('--safari-profile=')), '--safari-steady=one'],
    [...args.filter(arg => !arg.startsWith('--surface=')), '--surface=desktop', '--safari-steady=one'],
    [...args.filter(arg => !arg.startsWith('--grid-scenario=')), '--grid-scenario=baseline', '--safari-steady=one'],
  ]) expect(() => validateFrameFloorArgs(invalid)).toThrow('requires one pose or drive');
});


test('drive selection profiles one route plus early play and excludes a second selection', () => {
  expect(() => validateFrameFloorArgs([...args, '--safari-drive=pine-interior'])).not.toThrow();
  for (const invalid of [
    [...args, '--safari-drive=../escape'], [...args, '--safari-drive='],
    [...args, '--safari-drive=pine-interior', '--safari-drive=nalati-interior'],
    [...args, '--safari-drive=pine-interior', '--safari-steady=grid-nalati-interior'],
    [...args.filter(arg => !arg.startsWith('--safari-profile=')), '--safari-drive=pine-interior'],
  ]) expect(() => validateFrameFloorArgs(invalid)).toThrow('requires one pose or drive');
});

test('a matching drive and steady pose select two separate windows in one run', () => {
  expect(() => validateFrameFloorArgs([...args, '--safari-drive=nalati-interior', '--safari-steady=grid-nalati-interior'])).not.toThrow();
  expect(() => validateFrameFloorArgs([...args, '--safari-drive=pine-interior', '--safari-steady=grid-nalati-interior'])).toThrow('matching pair');
});


test('steady Timeline retains actual frame intervals for exactly one entered twenty-second window', async () => {
  const f = fixture(), result = f.start(true);
  f.frame(100); f.frame(133); f.frame(183); f.frame(20100);
  await expect(result).resolves.toEqual({startMs: 100, endMs: 20100, elapsedMs: 20000, frames: 4,
    intervals: [[100, 33], [133, 50], [183, 19917]], dropped: 0});
  expect(f.stops).toBe(1); expect(f.timers.size).toBe(0);
});

test('steady Timeline bounds retained intervals and explicitly reports overflow', async () => {
  const f = fixture(), result = f.start(true);
  for (let i = 0; i < 2051; i++) f.frame(100 + i);
  f.frame(20100);
  await expect(result).resolves.toMatchObject({dropped: 3});
  const value = await result;
  if (value === null || typeof value !== 'object' || !('intervals' in value) || !Array.isArray(value.intervals)) throw new Error('Missing interval bank');
  expect(value.intervals).toHaveLength(2048);
  expect(f.stops).toBe(1);
});

test('steady Timeline refuses a missing frame clock and retires its watcher', async () => {
  const f = fixture(), result = f.start(true);
  f.frame(Number.NaN);
  await expect(result).rejects.toThrow('drawn-frame clock');
  expect(f.stops).toBe(1); expect(f.timers.size).toBe(0);
});

test('steady Timeline accepts one Simulator target including official quiet without other recorders', () => {
  const command = ['--surface=sim', '--shards=grid', '--grid-scenario=all', '--webkit-timeline=tmp/timeline', '--webkit-steady=grid-nalati-interior'];
  expect(() => validateFrameFloorArgs(command)).not.toThrow();
  expect(() => validateFrameFloorArgs([...command, '--quiet'])).not.toThrow();
  expect(() => validateFrameFloorArgs([...command.slice(0, -1), '--webkit-steady=grid-template-return,grid-nalati-interior', '--native-pressure=tmp/probe', '--quiet'])).not.toThrow();
  expect(() => validateFrameFloorArgs([...command.slice(0, -1), '--webkit-steady=grid-template-return,grid-template-return'])).toThrow('distinct');
  expect(() => validateFrameFloorArgs([...command.slice(0, -1), '--webkit-steady=grid-template-return,grid-pine-interior,grid-nalati-interior'])).toThrow('Steady Timeline');
  expect(() => validateFrameFloorArgs(['--native-pressure=tmp/probe'])).toThrow('selected settled Timeline');

  for (const extra of ['--safari-profile=tmp/profile', '--wasm-constructors=tmp/native', '--gl-time', '--webkit-steady=grid-pine-interior'])
    expect(() => validateFrameFloorArgs([...command, extra])).toThrow('Steady Timeline');
  for (const replacement of ['--webkit-steady=', '--webkit-steady=../escape'])
    expect(() => validateFrameFloorArgs([...command.slice(0, -1), replacement])).toThrow('Steady Timeline');
  expect(() => validateFrameFloorArgs(command.filter(arg => !arg.startsWith('--webkit-timeline=')))).toThrow('Steady Timeline');
});


test('steady native-pressure epoch freezes on success and also retires on control refusal', async () => {
  for (const refuse of [false, true]) {
    const f = fixture(); let begins = 0, ends = 0;
    Reflect.set(f.context.window, '__frameFloorNativePressure', {begin: () => {begins++;}, take: () => {ends++; return {rows: [], dropped: 0};}});
    const result = f.start(true);
    if (refuse) f.world.hud.paused = true;
    f.frame(20100);
    await (refuse ? expect(result).rejects.toThrow('world or controls changed')
      : expect(result).resolves.toMatchObject({nativePressure: {rows: [], dropped: 0}}));
    expect(begins).toBe(1); expect(ends).toBe(1);
    expect(f.stops).toBe(1); expect(f.timers.size).toBe(0);
  }
});
