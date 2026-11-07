// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual serialized diagnostic without booting a browser.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The browser callback is isolated with deterministic frame and clock ports.
import {runInNewContext} from 'node:vm';
import {expect, test} from 'vitest';

function poseSource(): string {
  const text = readFileSync(new URL('../scripts/physics-baseline.mjs', import.meta.url), 'utf8');
  const section = text.indexOf('// ── poses ──');
  const marker = 'const r = await page.evaluate(';
  const start = text.indexOf(marker, section) + marker.length;
  const end = text.indexOf('}, FRAMES);', start);
  if (section === -1 || start < marker.length || end < start) throw new Error('Missing production pose callback');
  return text.slice(start, end + 1);
}

interface System {id: string; run: (dt: number, time: number) => void}
function fixture() {
  let clock = 0;
  const calls: {id: string; dt: number; time: number}[] = [];
  const player = {position: {x: 1, y: 2, z: 3},
    update() {expect(this).toBe(player); clock += 2;},
    step() {expect(this).toBe(player); clock += 1;}};
  const animals = {animals: [{motor: {}}, {motor: null}, {motor: {}}],
    update() {expect(this).toBe(animals); clock += 3;}};
  const composer = {render() {expect(this).toBe(composer); clock += 7;}};
  const row = (id: string, cost: number, extra?: () => void): System => ({id,
    run(dt, time) {expect(this.id).toBe(id); calls.push({id, dt, time}); extra?.(); clock += cost;}});
  const phases: Record<string, System[]> = {
    input: [row('input', 0, () => {player.step();})],
    'fixed.pre': [row('pre', 2)], 'fixed.step': [row('physics', 3)], 'fixed.post': [row('post', 4)],
    update: [row('update', 0, () => {player.update(); animals.update();})], late: [row('late', 9)], render: [],
  };
  // Current Game has phase names here, not callback arrays, and no updaters/inputs fields.
  const game = {app: {systemsByPhase: () => phases}, fixed: {pre: 'fixed.pre', step: 'fixed.step', post: 'fixed.post'},
    composer, fixedSteps: 2, lastFrame: {calls: 11, triangles: 1234}};
  const original = Object.values(phases).flat().map(system => ({system, run: system.run}));
  const method = (object: object, name: string): unknown => Reflect.get(object, name);
  const methods = {playerUpdate: method(player, 'update'), playerStep: method(player, 'step'), animals: method(animals, 'update'), render: method(composer, 'render')};
  const frame = (onFrame: FrameRequestCallback): number => {
    const run = (phase: string): void => {for (const system of phases[phase] ?? []) system.run(0.1, 7);};
    run('input');
    for (let step = 0; step < 2; step++) {run('fixed.pre'); run('fixed.step'); run('fixed.post');}
    run('update'); run('late'); composer.render(); onFrame(clock); return 1;
  };
  const restored = (): void => {
    for (const {system, run} of original) expect(system.run).toBe(run);
    expect(method(player, 'update')).toBe(methods.playerUpdate); expect(method(player, 'step')).toBe(methods.playerStep);
    expect(method(animals, 'update')).toBe(methods.animals); expect(method(composer, 'render')).toBe(methods.render);
  };
  return {phases, calls, restored, measure: async (frames: number, raf = frame): Promise<unknown> => {
    const sample: unknown = runInNewContext(`(${poseSource()})`, {
      window: {__wildshard: {world: {player, animals, game}}}, performance: {now: () => clock}, requestAnimationFrame: raf,
    });
    if (typeof sample !== 'function') throw new Error('Pose callback is not callable');
    const result: unknown = Reflect.apply(sample, undefined, [frames]);
    return await result;
  }};
}

test('poses sample the live app phases without retired Game callback arrays or changing their execution', async () => {
  const f = fixture();
  const row = {update: 5, fixed: 19, world: 6, player: 3, animals: 3, render: 7,
    js: 24, steps: 2, perStep: 9.5, frame: 40, calls: 11, tris: 1234};
  expect(await f.measure(2)).toEqual({rows: [row, row], animals: 3, motors: 2, pos: {x: 1, y: 2, z: 3}});
  const order = ['input', 'pre', 'physics', 'post', 'pre', 'physics', 'post', 'update', 'late'];
  expect(f.calls.map(call => call.id)).toEqual([...order, ...order]);
  expect(f.calls.every(call => call.dt === 0.1 && call.time === 7)).toBe(true);
  f.restored();
});

test('missing live phases refuse instead of silently producing a zero-cost pose', async () => {
  const f = fixture(); Reflect.deleteProperty(f.phases, 'update');
  await expect(f.measure(1)).rejects.toThrow('Physics pose requires live system phase update');
  expect(f.calls).toEqual([]); f.restored();
});

test('a failed sample restores every borrowed system and player/composer callback', async () => {
  const f = fixture(), failure = new Error('frame observation failed');
  await expect(f.measure(1, () => {throw failure;})).rejects.toBe(failure);
  expect(f.calls).toEqual([]); f.restored();
});
