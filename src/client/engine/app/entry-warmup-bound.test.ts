import { afterEach, describe, expect, it } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment, type ScopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { boundEntryWarmup } from '../render/entryWarmupBound';
import { waitForDrawnFrame } from '../render/precompile';

/** A hand-driven rAF: `frame(ms)` advances the clock and runs every queued callback once. */
function manualFrames(): { frame: (ms: number) => void } {
  let now = 0, next = 1;
  const queued = new Map<number, (time: number) => void>();
  installScopeEnvironment({ ...scopeEnvironment(), frame: render => { const id = next++; queued.set(id, render); return id; },
    cancelFrame: id => { queued.delete(id); } });
  return { frame: ms => { now += ms; const due = [...queued.values()]; queued.clear(); for (const render of due) render(now); } };
}

/** A stage that never settles (a link that never reports complete). */
const never = (): Promise<void> => new Promise<void>(() => { /* never settles */ });

const original: ScopeEnvironment = scopeEnvironment();
afterEach(() => { installScopeEnvironment(original); });

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let finish = (): void => { throw new Error('Missing work'); };
  let fail = (_error: Error): void => { throw new Error('Missing work'); };
  const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: finish, reject: fail };
}

describe('entered-frame preparation lifetime', () => {
  it.each([0, 3])('waits for actual work with no drawn-frame progress (drawn=%s)', async drawn => {
    const frames = manualFrames(), owner = new Scope(`owner-${String(drawn)}`), work = deferred();
    let finished = false;
    const run = boundEntryWarmup(owner, () => work.promise).then(() => { finished = true; return 'done'; });
    for (let i = 0; i < 2000; i++) frames.frame(100);
    await Promise.resolve(); expect(finished).toBe(false);
    expect(owner.census.timers).toBe(0); expect(owner.census.rafs).toBe(0);
    work.resolve(); expect(await run).toBe('done'); owner.dispose();
  });

  it('long hidden gaps cannot finish or reject valid preparation', async () => {
    const frames = manualFrames(), owner = new Scope('hidden'), work = deferred();
    const run = boundEntryWarmup(owner, () => work.promise);
    for (let i = 0; i < 3; i++) frames.frame(600_000);
    work.resolve(); await expect(run).resolves.toBeUndefined(); owner.dispose();
  });

  it('owner retirement rejects immediately, fences work and observes its later refusal', async () => {
    manualFrames(); const owner = new Scope('owner'), work = deferred();
    let fence = (): boolean => true;
    const run = boundEntryWarmup(owner, current => { fence = current; return work.promise; });
    const refusal = expect(run).rejects.toThrow('owner left');
    owner.dispose(); expect(fence()).toBe(false); await refusal;
    work.reject(new Error('Late original failure')); await Promise.resolve();
    expect(owner.census.disposers).toBe(0);
  });

  it('keeps synchronous and delayed original work errors', async () => {
    const owner = new Scope('owner'), first = new Error('bad material'), second = new Error('content failed');
    await expect(boundEntryWarmup(owner, () => { throw first; })).rejects.toBe(first);
    const work = deferred(), run = boundEntryWarmup(owner, () => work.promise);
    const refusal = expect(run).rejects.toBe(second); work.reject(second); await refusal;
    owner.dispose();
  });

  it('does not start work for a disposed or disposing owner', async () => {
    const owner = new Scope('left'); let started = false;
    let disposing: Promise<unknown> = Promise.resolve();
    owner.onDispose(() => {
      disposing = expect(boundEntryWarmup(owner, () => { started = true; return never(); })).rejects.toThrow('owner left');
    });
    owner.dispose(); await disposing;
    await expect(boundEntryWarmup(owner, () => { started = true; return never(); })).rejects.toThrow('owner left');
    expect(started).toBe(false);
  });

  it('completed preparation retains the live owner fence without retaining its wait scope', async () => {
    const owner = new Scope('owner'); let fence = (): boolean => false;
    await boundEntryWarmup(owner, current => { fence = current; return Promise.resolve(); });
    expect(fence()).toBe(true); expect(owner.census.disposers).toBe(0);
    owner.dispose(); expect(fence()).toBe(false);
  });

  it('a streamed draw barrier waits for an actual draw and retires pending work with its owner', async () => {
    const frames = manualFrames(), owner = new Scope('far-view');
    let completed = false;
    const run = waitForDrawnFrame(owner, () => 22, () => true).then(() => { completed = true; return undefined; });
    const refusal = expect(run).rejects.toThrow('owner left');
    for (let i = 0; i < 400; i++) frames.frame(100);
    await Promise.resolve(); expect(completed).toBe(false);
    owner.dispose(); await refusal;
    expect(owner.census.timers).toBe(0); expect(owner.census.rafs).toBe(0);
  });
});
