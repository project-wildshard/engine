import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the actual caller wiring without constructing a renderer
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- execute the actual JavaScript pause declaration with controlled game frames
import { runInNewContext } from 'node:vm';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { waitForDrawnFrame } from '../render/precompile';

const original = scopeEnvironment();
afterEach(() => { installScopeEnvironment(original); vi.useRealTimers(); });

function caller(game: { frameCount: number }, owner: Scope, isolateImageUploads: boolean): unknown {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const method = source.indexOf('private async prepareEnteredPrograms(');
  const start = source.indexOf('const pause = ', method), end = source.indexOf('const uploadBudget', start);
  if (method === -1 || start === -1 || end <= start) throw new Error('Entered shader pause wiring missing');
  return runInNewContext(`(function () { ${source.slice(start, end)} return pause; }).call(game)`,
    { game, owner, isolateImageUploads, waitForDrawnFrame, live: () => !owner.disposed });
}

function frames(): () => void {
  let time = 0, id = 0;
  const queue = new Map<number, (at: number) => void>();
  installScopeEnvironment({ ...original, frame: render => { const next = ++id; queue.set(next, render); return next; },
    cancelFrame: key => { queue.delete(key); } });
  return () => { time += 16; const due = [...queue.values()]; queue.clear(); for (const render of due) render(time); };
}

for (const isolated of [false, true]) {
  test(`live shader caller waits past skipped rAFs (isolated uploads ${isolated})`, async () => {
    vi.useFakeTimers(); const frame = frames(), owner = new Scope('shader-caller'), game = { frameCount: 1 };
    try {
      const pause = caller(game, owner, isolated);
      if (typeof pause !== 'function') throw new Error('Live caller omitted its completed-draw barrier');
      const waiting: unknown = Reflect.apply(pause, undefined, []);
      let finished = false;
      const done = Promise.resolve(waiting).then(() => { finished = true; return undefined; });
      frame(); await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false);
      frame(); await vi.advanceTimersByTimeAsync(0); expect(finished).toBe(false);
      game.frameCount++; frame(); await vi.advanceTimersByTimeAsync(0);
      await done; expect(finished).toBe(true);
    } finally { owner.dispose(); }
  });

  test(`boot shader caller retains its ordinary yield (isolated uploads ${isolated})`, () => {
    const owner = new Scope('boot-caller');
    try { expect(caller({ frameCount: 0 }, owner, isolated)).toBeUndefined(); }
    finally { owner.dispose(); }
  });
}
