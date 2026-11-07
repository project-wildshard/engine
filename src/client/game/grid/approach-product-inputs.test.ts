import { expect, test, vi } from 'vitest';
import { holdApproachInputs } from './approachProductInputs';
import { Scope } from '@wildshard/engine/app/scope';

function run(acquire: Parameters<typeof holdApproachInputs>[0], signal: AbortSignal): Promise<void> {
  const scope = new Scope('approach-input-test');
  return holdApproachInputs(acquire, signal, scope).finally(() => { scope.dispose(); });
}

test('an already redirected approach starts no input acquisition', async () => {
  const controller = new AbortController(); controller.abort();
  const acquire = vi.fn(() => Promise.reject(new Error('Must not read')));
  await run(acquire, controller.signal);
  expect(acquire).not.toHaveBeenCalled();
});

test('prepared approach inputs stay borrowed until redirect, then release in order', async () => {
  const controller = new AbortController(), events: string[] = [];
  let ready = (): void => undefined;
  const acquired = new Promise<void>(resolve => { ready = resolve; });
  const pending = run(() => {
    events.push('acquire'); ready();
    return Promise.resolve({ releaseInputs: () => { events.push('inputs'); return Promise.resolve(); }, release: () => { events.push('product'); } });
  }, controller.signal);
  await acquired; await Promise.resolve(); expect(events).toEqual(['acquire']);
  controller.abort(); await pending; controller.abort();
  expect(events).toEqual(['acquire', 'inputs', 'product']);
});

test('redirect drains an in-flight acquisition and input release before completing', async () => {
  const controller = new AbortController(), events: string[] = [];
  let arrive = (_value: { releaseInputs: () => Promise<void>; release: () => void }): void => undefined;
  const acquisition = new Promise<{ releaseInputs: () => Promise<void>; release: () => void }>(resolve => { arrive = resolve; });
  let finish = (): void => undefined;
  const released = new Promise<void>(resolve => { finish = resolve; });
  const pending = run(() => acquisition, controller.signal);
  controller.abort(); await Promise.resolve(); expect(events).toEqual([]);
  arrive({ releaseInputs: () => { events.push('inputs'); return released; }, release: () => { events.push('product'); } });
  await Promise.resolve(); expect(events).toEqual(['inputs']);
  finish(); await pending; expect(events).toEqual(['inputs', 'product']);
});

test('an acquisition refusal keeps its identity and removes the abort observer', async () => {
  const controller = new AbortController(), failure = new Error('Verified input hash differs');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  try {
    await expect(run(() => Promise.reject(failure), controller.signal)).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledOnce();
  } finally { remove.mockRestore(); }
});

test('a refused input release still releases its product owner', async () => {
  const controller = new AbortController(), failure = new Error('Durable input release refused'), release = vi.fn();
  const pending = run(() => {
    controller.abort(); return Promise.resolve({ releaseInputs: () => Promise.reject(failure), release: () => { release(); } });
  }, controller.signal);
  await expect(pending).rejects.toBe(failure); expect(release).toHaveBeenCalledOnce();
});


test('owner retirement cancels and drains its read-ahead before releasing product inputs', async () => {
  const owner = new Scope('approach-reader'), controller = new AbortController(), events: string[] = [];
  let finish = (): void => undefined, started = (): void => undefined;
  const body = new Promise<void>(resolve => { finish = resolve; }), reading = new Promise<void>(resolve => { started = resolve; });
  const pending = holdApproachInputs(async signal => {
    signal.addEventListener('abort', () => { events.push('abort'); }, { once: true });
    started(); await body;
    return { releaseInputs: () => { events.push('inputs'); return Promise.resolve(); }, release: () => { events.push('product'); } };
  }, controller.signal, owner);
  await reading; owner.dispose(); expect(events).toEqual(['abort']);
  finish(); await pending; expect(events).toEqual(['abort', 'inputs', 'product']);
});
