import {expect, test} from 'vitest';
import {LoadWindow, PHONE_LOAD_WINDOW_BYTES} from '@wildshard/engine/boot/loadWindow';
import {PreparationReads} from './preparationReads';

// EM23: the phone tier's window, as the page sizes it there
const phone = (): LoadWindow => new LoadWindow(() => PHONE_LOAD_WINDOW_BYTES);

const MB = 1024 * 1024;
const turn = (): Promise<void> => new Promise(resolve => {setTimeout(resolve, 0);});

test('fake parts through the preparation reads never hold more than the phone window', async () => {
  const loadWindow = phone();
  // 48 parts of 5 MB that read at once (a warm cache) behind a decoder slower than transport
  const parts = Array.from({length: 48}, (_, index) => index);
  let loads = 0;
  const reads = new PreparationReads(parts, async () => {loads++; await turn(); return new Uint8Array(5 * MB);}, () => true, undefined, loadWindow);
  let over = 0;
  for (const index of parts) {
    const bytes = await reads.take(index, true);
    expect(bytes.byteLength).toBe(5 * MB);
    for (let slow = 0; slow < 4; slow++) await turn(); // decode and upload
    if (loadWindow.stats().bytes > PHONE_LOAD_WINDOW_BYTES) over++;
    reads.done(index);
  }
  await reads.close();
  expect(loads).toBe(48);
  expect(over).toBe(0);
  expect(loadWindow.stats().peak).toBeLessThanOrEqual(PHONE_LOAD_WINDOW_BYTES);
  expect(loadWindow.stats().bytes).toBe(0);
});

test('two phases whose consumers wait on each other cannot deadlock on a full window', async () => {
  const loadWindow = phone();
  const big = (): Promise<Uint8Array> => Promise.resolve(new Uint8Array(40 * MB));
  const first = new PreparationReads([0, 1, 2], big, () => true, undefined, loadWindow);
  const second = new PreparationReads([0, 1, 2], big, () => true, undefined, loadWindow);
  // the first phase's consumer needs the second phase's first part before taking its own
  const firstBytes = await second.take(0);
  for (const index of [0, 1, 2]) expect((await first.take(index)).byteLength).toBe(40 * MB);
  for (const index of [1, 2]) expect((await second.take(index)).byteLength).toBe(40 * MB);
  expect(firstBytes.byteLength).toBe(40 * MB);
  await Promise.all([first.close(), second.close()]);
  expect(loadWindow.stats().bytes).toBe(0);
});
