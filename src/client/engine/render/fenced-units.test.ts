// @vitest-environment happy-dom
// LS7 (J188): a first-frame unit is credited only when its fence signalled; every exit releases every native sync.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { installBrowserScopeEnvironment } from '../app/view/scopeEnvironment';
import { FenceAbortError, FencedUnits } from './fencedUnits';

const GL = { SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911a, TIMEOUT_EXPIRED: 0x911b, CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d };
function fakeGl() {
  const live = new Set<object>();
  const state = { lost: false, status: GL.ALREADY_SIGNALED, created: 0, deleted: 0 };
  const gl = { ...GL, isContextLost: () => state.lost, flush: () => undefined,
    fenceSync: () => { if (state.lost) return null; const sync = {}; live.add(sync); state.created++; return sync; },
    clientWaitSync: () => state.lost ? GL.WAIT_FAILED : state.status,
    deleteSync: (sync: object) => { if (live.delete(sync)) state.deleted++; } };
  return { gl: gl as unknown as WebGL2RenderingContext, state, live };
}
const frames = async (n: number): Promise<void> => { for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(20); };
/** a wait's outcome after three painted frames (fake timers): its value or its rejection */
const outcome = async (wait: Promise<unknown>): Promise<unknown> => {
  const result = (async (): Promise<unknown> => { try { await wait; return 'resolved'; } catch (error) { return error; } })();
  await frames(3); return result;
};

let scope: Scope;
beforeEach(() => { vi.useFakeTimers(); installBrowserScopeEnvironment(); scope = new Scope('ls7-fence-owner'); });
afterEach(() => { scope.dispose(); vi.useRealTimers(); });

it('credits a unit only once its fence has signalled', async () => {
  const { gl, state, live } = fakeGl(), units = new FencedUnits(gl, scope), credited: number[] = [];
  state.status = GL.TIMEOUT_EXPIRED;
  await units.submit(() => { credited.push(1); });
  let done = false;
  const drained = (async (): Promise<void> => { await units.drain(); done = true; })();
  await frames(3);
  expect(credited).toEqual([]); expect(done).toBe(false);
  state.status = GL.CONDITION_SATISFIED;
  await frames(1); await drained;
  expect(credited).toEqual([1]); expect(live.size).toBe(0); expect(units.census).toMatchObject({ created: 1, deleted: 1, credited: 1 });
});

it('settles a pending drain and deletes its sync when the owner is disposed', async () => {
  const { gl, state, live } = fakeGl(), units = new FencedUnits(gl, scope), credited: number[] = [];
  state.status = GL.TIMEOUT_EXPIRED;
  await units.submit(() => { credited.push(1); });
  const drained = outcome(units.drain());
  scope.dispose();
  const result = await drained;
  expect(result).toBeInstanceOf(FenceAbortError); expect((result as FenceAbortError).reason).toBe('disposed');
  expect(credited).toEqual([]); expect(state.created).toBe(1); expect(state.deleted).toBe(1); expect(live.size).toBe(0);
});

it('rejects a drain begun after the owner was disposed', async () => {
  const { gl, state, live } = fakeGl(), units = new FencedUnits(gl, scope);
  state.status = GL.TIMEOUT_EXPIRED;
  await units.submit(() => undefined);
  scope.dispose();
  expect(await outcome(units.drain())).toMatchObject({ reason: 'disposed' });
  expect(live.size).toBe(0);
});

it('gives no credit when the context is lost before a submit', async () => {
  const { gl, state } = fakeGl(), units = new FencedUnits(gl, scope), credited: number[] = [];
  state.lost = true;
  await expect(units.submit(() => { credited.push(1); })).rejects.toMatchObject({ reason: 'context-lost' });
  await frames(2);
  expect(await outcome(units.drain())).toMatchObject({ reason: 'context-lost' });
  expect(credited).toEqual([]); expect(state.created).toBe(0);
});

it('gives no credit and releases the sync when the context is lost with a fence in flight', async () => {
  const { gl, state, live } = fakeGl(), units = new FencedUnits(gl, scope), credited: number[] = [];
  state.status = GL.TIMEOUT_EXPIRED;
  await units.submit(() => { credited.push(1); });
  units.mark(() => { credited.push(2); });
  state.lost = true;
  expect(await outcome(units.drain())).toMatchObject({ reason: 'context-lost' });
  expect(credited).toEqual([]); expect(live.size).toBe(0); expect(units.census.credited).toBe(0);
});

it('treats WAIT_FAILED as failure, not completion', async () => {
  const { gl, state, live } = fakeGl(), units = new FencedUnits(gl, scope), credited: number[] = [];
  state.status = GL.WAIT_FAILED;
  await units.submit(() => { credited.push(1); });
  expect(await outcome(units.drain())).toMatchObject({ reason: 'wait-failed' });
  expect(credited).toEqual([]); expect(live.size).toBe(0);
});

it('releases every queued sync when a progress callback throws', async () => {
  const { gl, state, live } = fakeGl(), units = new FencedUnits(gl, scope, 3);
  state.status = GL.TIMEOUT_EXPIRED;
  await units.submit(() => { throw new Error('progress callback failed'); });
  await units.submit(() => undefined);
  state.status = GL.ALREADY_SIGNALED;
  try { expect(await outcome(units.drain())).toMatchObject({ message: 'progress callback failed' }); } finally { units.dispose(); }
  expect(state.created).toBe(2); expect(state.deleted).toBe(2); expect(live.size).toBe(0);
  expect(await outcome(units.drain())).toBeInstanceOf(FenceAbortError);
});
