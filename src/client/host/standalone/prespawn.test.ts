// MEMORY-GATES MG10 (J410): the server's worker starts early to load and warm physics; the server's boot adopts it once
import { afterEach, expect, test, vi } from 'vitest';
import { adoptSpare, prespawnStandalone } from './shell';

class FakeWorker extends EventTarget {
  static made: FakeWorker[] = [];
  readonly posted: { data: unknown; ports: readonly MessagePort[] }[] = [];
  terminated = false;
  constructor() { super(); FakeWorker.made.push(this); }
  postMessage(data: unknown, ports: readonly MessagePort[] = []): void { this.posted.push({ data, ports }); }
  terminate(): void { this.terminated = true; }
}
const realWorker: unknown = Reflect.get(globalThis, 'Worker');
const useFakeWorker = (): void => { Reflect.set(globalThis, 'Worker', FakeWorker); };
afterEach(() => { FakeWorker.made = []; Reflect.set(globalThis, 'Worker', realWorker); });

test('an early worker gets the prewarm message and a held-read port, and is adopted once', async () => {
  useFakeWorker();
  const held = vi.fn((url: string) => Promise.resolve(url.endsWith('rapier.wasm') ? new ArrayBuffer(4) : null));
  prespawnStandalone(held); prespawnStandalone(held);
  expect(FakeWorker.made).toHaveLength(1);
  const [early] = FakeWorker.made, message = early?.posted[0];
  expect(message?.data).toEqual({ prewarm: true }); expect(message?.ports).toHaveLength(1);
  const port = message?.ports[0];
  if (port === undefined) throw new Error('Expected the held-read port');
  const answer = new Promise<unknown>(resolve => { port.onmessage = event => { resolve(event.data); }; });
  port.postMessage({ id: 1, url: '/assets/physics/rapier.wasm' });
  expect(await answer).toMatchObject({ id: 1 }); expect(held).toHaveBeenCalledOnce();
  port.close();
  expect(adoptSpare()).toBe(early);
  const later = adoptSpare();
  expect(later).not.toBe(early); expect(FakeWorker.made).toHaveLength(2);
});

test('an early worker that failed to load is dropped for a new one', () => {
  useFakeWorker();
  prespawnStandalone();
  const [early] = FakeWorker.made;
  early?.dispatchEvent(new Event('error'));
  const adopted = adoptSpare();
  expect(early?.terminated).toBe(true); expect(adopted).not.toBe(early); expect(FakeWorker.made).toHaveLength(2);
});
