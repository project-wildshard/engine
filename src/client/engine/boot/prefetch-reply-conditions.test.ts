import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual legacy request bridge without installing its catalogue.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Only erase the defining request's types.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the request's native event/message ports isolated.
import { runInNewContext } from 'node:vm';
import { Scope } from '../../../shared/engine/app/scope';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); });
function fixture() {
  const owner = new Scope('prefetch-test'); owners.push(owner);
  const source = readFileSync(new URL('shardPrefetch.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function viaWorker('), end = source.indexOf('\n// the shell', start);
  if (start === -1 || end < start) throw new Error('Missing worker request');
  const ports: unknown[] = [];
  const worker = Object.assign(new EventTarget(), { state: 'activated', postMessage: (_message: unknown, transfer: unknown[]) => { ports.push(...transfer); } });
  const read: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end)}\nviaWorker`), {
    pageScope: owner, MessageChannel, navigator: {serviceWorker: {controller: worker}},
  });
  if (typeof read !== 'function') throw new Error('Missing request function');
  const startRead = async (signal: AbortSignal): Promise<unknown> => { const result: unknown = Reflect.apply(read, undefined, ['/file', signal]); return await result; };
  return { owner, worker, ports, startRead };
}
test('legacy requests follow native replies or cancellation rather than elapsed time', async () => {
  vi.useFakeTimers(); const f = fixture(), controller = new AbortController();
  let complete = false;
  const result = f.startRead(controller.signal).then(value => { complete = true; return value; });
  await vi.advanceTimersByTimeAsync(180_000); expect(complete).toBe(false); expect(f.owner.census.timers).toBe(0);
  const port = f.ports[0]; if (!(port instanceof MessagePort)) throw new Error('Missing native reply port');
  port.postMessage({type: 'PREFETCHED', status: 'stored', bytes: 6});
  expect(await result).toEqual({status: 'stored', bytes: 6}); expect(f.owner.census.listeners).toBe(0);
  const cancelled = f.startRead(controller.signal); controller.abort(); expect(await cancelled).toBeNull();
  const retired = f.startRead(new AbortController().signal);
  f.worker.state = 'redundant'; f.worker.dispatchEvent(new Event('statechange')); expect(await retired).toBeNull();
  expect(f.owner.census.listeners).toBe(0); expect(f.owner.census.disposers).toBe(0);
});
