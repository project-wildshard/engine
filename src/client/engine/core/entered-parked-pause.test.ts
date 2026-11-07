import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real caller without a GPU renderer.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Strip only the actual caller's type annotations.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute repository scheduling with controlled frame ports.
import { runInNewContext } from 'node:vm';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { waitForDrawnFrame } from '../render/precompile';
import { HELD_PARKED_BUDGET, HELD_WEBKIT_PARKED_BUDGET, LIVE_PARKED_BUDGET } from '../render/parkedDraws';

const original = scopeEnvironment();
afterEach(() => { installScopeEnvironment(original); vi.useRealTimers(); });

async function fixture(isolated: boolean, held = true, frameCount = 1) {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const method = source.indexOf('private async warmEnteredStages(');
  const budgetStart = source.indexOf('const drawBudget = ', method);
  const pauseStart = source.indexOf('const drawnPause = ', method);
  const pauseEnd = source.indexOf('// Camera models live outside', pauseStart);
  const root = source.indexOf("enter('parked-draws')", pauseEnd);
  const call = source.indexOf('const drawn = await warmParkedDraws(', root);
  const after = source.indexOf("onStage('parked-draws'", call);
  const extra = source.indexOf('if (paced) await drawnPause();', call);
  const end = extra !== -1 && extra < after ? extra : after;
  const pacedStart = source.indexOf('const paced = ', root);
  const paced = pacedStart !== -1 && pacedStart < call ? source.slice(pacedStart, call) : '';
  if ([method, budgetStart, pauseStart, pauseEnd, root, call, after].some(at => at < 0)) throw new Error('Parked caller wiring missing');
  const owner = new Scope('parked-caller'), game = { frameCount, renderer: {}, rootScene: {}, camera: {} };
  const buildYield = vi.fn(() => Promise.resolve());
  let captured: unknown, options: unknown;
  const run: unknown = runInNewContext(stripTypeScriptTypes(`(async function () {
    ${source.slice(budgetStart, pauseEnd)}
    ${paced}
    ${source.slice(call, end)}
  }).call(game)`), { game, owner, current: () => !owner.disposed, waitForDrawnFrame, buildYield, buildHeld: () => held, HELD_PARKED_BUDGET, HELD_WEBKIT_PARKED_BUDGET, LIVE_PARKED_BUDGET,
    isolateImageUploads: isolated, composer: { inputBuffer: {} }, futureRoot: {}, keep: undefined,
    futureEnvironment: null, progress: () => undefined,
    warmParkedDraws: (...args: unknown[]) => { captured = args[6]; options = args[7]; return Promise.resolve(0); } });
  await run;
  if (typeof captured !== 'function') throw new Error('Missing parked batch pause');
  const pause = captured;
  const invoke = (): Promise<unknown> => Promise.resolve(Reflect.apply(pause, undefined, []));
  return { owner, game, buildYield, invoke, options };
}

function frames(): () => void {
  let time = 0, id = 0;
  const queued = new Map<number, (at: number) => void>();
  installScopeEnvironment({ ...original, frame: render => { const next = ++id; queued.set(next, render); return next; },
    cancelFrame: key => { queued.delete(key); } });
  return () => { time += 16; const due = [...queued.values()]; queued.clear(); for (const render of due) render(time); };
}

test.each([true, false])('a parked batch waits past skipped rAFs (WebKit isolation %s)', async isolated => {
  vi.useFakeTimers(); const frame = frames(), f = await fixture(isolated);
  try {
    let complete = false;
    const pending = f.invoke().then(() => { complete = true; return null; });
    frame(); await vi.advanceTimersByTimeAsync(0); expect(complete).toBe(false);
    frame(); await vi.advanceTimersByTimeAsync(0); expect(complete).toBe(false);
    f.game.frameCount++; frame(); await vi.advanceTimersByTimeAsync(0);
    await pending; expect(complete).toBe(true); expect(f.buildYield).not.toHaveBeenCalled();
  } finally { f.owner.dispose(); }
});

test('retirement rejects a pending parked batch instead of admitting more native work', async () => {
  vi.useFakeTimers(); frames(); const f = await fixture(true);
  try {
    const observed = (async () => { try { await f.invoke(); return null; } catch (error: unknown) { return error; } })();
    f.owner.dispose(); expect(String(await observed)).toContain('Shader warm-up owner left');
    expect(f.buildYield).not.toHaveBeenCalled();
  } finally { f.owner.dispose(); }
});


// G808: held at the wall a WebKit slice uploads up to 2 MiB; driving keeps 512 KiB. The pipeline fences are the same.
test.each([[true, 2 * 1024 * 1024], [false, 512 * 1024]])('live WebKit limits cold bindings and fresh buffers (held %s)', async (held, bytes) => {
  const f = await fixture(true, held);
  try { expect(f.options).toMatchObject({ budget: { drawables: 8, newMaterials: 2, newBindings: 2, bufferBytes: bytes } }); }
  finally { f.owner.dispose(); }
});

test('desktop and initial boot retain their original held draw allowance', async () => {
  for (const [isolated, frameCount] of [[false, 1], [true, 0]] as const) {
    const f = await fixture(isolated, true, frameCount);
    try { expect(f.options).toMatchObject({ budget: HELD_PARKED_BUDGET }); }
    finally { f.owner.dispose(); }
  }
  const moving = await fixture(false, false);
  try { expect(moving.options).not.toHaveProperty('budget'); }
  finally { moving.owner.dispose(); }
});
