import { afterEach, describe, expect, it, vi } from 'vitest';
import { installScopeEnvironment, scopeEnvironment, type ScopeEnvironment } from '../app/scopeEnvironment';
import { noteFrameDrawn } from './framePacing';
import { pacedResolve } from './workSlice';

const original: ScopeEnvironment = scopeEnvironment();
afterEach(() => { installScopeEnvironment(original); noteFrameDrawn(Number.NEGATIVE_INFINITY); Reflect.deleteProperty(globalThis, 'requestAnimationFrame'); });

/** Settle every queued microtask (and nothing scheduled as a task or frame). */
const microtasks = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('pacedResolve: a held value handed back between frames', () => {
  it('is Promise.resolve when the page is not presenting (loading and Node)', async () => {
    let got: number | null = null;
    void pacedResolve(7).then(value => { got = value; return value; });
    await microtasks();
    expect(got).toBe(7);
  });

  it('waits for the next drawn frame once a presenting frame has spent its build budget', async () => {
    const queued: ((time: number) => void)[] = [];
    Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
    installScopeEnvironment({ ...original, frame: render => { queued.push(render); return queued.length; }, cancelFrame: () => undefined });

    noteFrameDrawn(performance.now() - 12); // drawn 12 ms ago: presenting, and past the 8 ms shared budget
    let got: string | null = null;
    void pacedResolve('bytes').then(value => { got = value; return value; });
    await microtasks();
    expect(got).toBeNull();
    noteFrameDrawn(performance.now()); // the loop draws its frame
    for (const render of queued.splice(0)) render(performance.now());
    await vi.waitFor(() => { expect(got).toBe('bytes'); });
  });

  it('resolves at once while the frame still has budget', async () => {

    noteFrameDrawn(performance.now() + 1000); // a frame drawn "now" for the whole test: budget unspent
    let got: number | null = null;
    void pacedResolve(3).then(value => { got = value; return value; });
    await microtasks();
    expect(got).toBe(3);
  });
});
