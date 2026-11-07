import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stopSpinRecording, uploadRecordedClip } from '../scripts/model-spin-recording.mjs';

const parts = [new Blob([new Uint8Array([0, 128, 255])]), new Blob([new Uint8Array([1, 2])])];
const read = vi.fn<typeof fetch>(), off = vi.fn(), frames = vi.fn(() => 37);
const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
class Recorder {
  onstop: ((event: Event) => void) | null = null;
  readonly stream = { getTracks: () => tracks };
  readonly stop = vi.fn(() => { this.onstop?.(new Event('stop')); });
}
let recorder: Recorder;
let urls: Blob[];
let restoreUrl: () => void;
const original = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  recorder = new Recorder(); urls = [];
  off.mockClear(); frames.mockReset().mockReturnValue(37); read.mockReset();
  for (const track of tracks) track.stop.mockClear();
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error('Expected recorded Blob');
    urls.push(blob); return 'blob:owned-spin';
  });
  restoreUrl = () => { createUrl.mockRestore(); };
  for (const [name, value] of Object.entries({ window: { __spin: { rec: { rec: recorder, parts, off, frames, size: [804, 1748] } } }, fetch: read })) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});
afterEach(() => {
  restoreUrl();
  for (const [name, descriptor] of original) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, descriptor);
  }
  original.clear();
});

test('stops the original recorder and exposes every exact clip byte with scalar metadata', async () => {
  await expect(stopSpinRecording()).resolves.toEqual({ url: 'blob:owned-spin', bytes: 5, size: [804, 1748], drawn: 37 });
  expect(off).toHaveBeenCalledOnce(); expect(recorder.stop).toHaveBeenCalledOnce();
  for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  expect(urls).toHaveLength(1);
  const blob = urls[0]; if (blob === undefined) throw new Error('Missing clip');
  expect(blob.type).toBe('video/webm');
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255, 1, 2]));
});
test('a stop refusal releases all original tracks without creating a clip URL', async () => {
  recorder.stop.mockImplementation(() => { throw new Error('stop refused'); });
  await expect(stopSpinRecording()).rejects.toThrow('stop refused');
  for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  expect(urls).toHaveLength(0);
});
test('a failed frame read creates no URL after releasing the tracks', async () => {
  frames.mockImplementation(() => { throw new Error('frame read refused'); });
  await expect(stopSpinRecording()).rejects.toThrow('frame read refused');
  for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  expect(urls).toHaveLength(0);
});
test('an absent Explorer recorder refuses before allocating a clip', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  await expect(stopSpinRecording()).rejects.toThrow('Missing Explorer recorder');
  expect(urls).toHaveLength(0); expect(recorder.stop).not.toHaveBeenCalled();
});
test('the handoff sends the complete native Blob once, without returning its bytes as JSON', async () => {
  const blob = new Blob(parts, { type: 'video/webm' });
  read.mockResolvedValueOnce(new Response(blob)).mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(uploadRecordedClip({ source: 'blob:owned-spin', destination: 'https://binary.invalid/clip' })).resolves.toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2); expect(read.mock.calls[0]).toEqual(['blob:owned-spin']);
  const [destination, options] = read.mock.calls[1] ?? [];
  expect(destination).toBe('https://binary.invalid/clip'); expect(options?.method).toBe('POST');
  if (!(options?.body instanceof Blob)) throw new Error('Missing native clip body');
  expect(new Uint8Array(await options.body.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255, 1, 2]));
});
test('a failed source read refuses before uploading', async () => {
  read.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(uploadRecordedClip({ source: 'blob:owned-spin', destination: 'https://binary.invalid/clip' })).rejects.toThrow('Recorded clip read refused');
  expect(read).toHaveBeenCalledTimes(1);
});
test('a failed upload refuses without reporting a successful clip', async () => {
  read.mockResolvedValueOnce(new Response(new Blob(parts))).mockResolvedValueOnce(new Response(null, { status: 400 }));
  await expect(uploadRecordedClip({ source: 'blob:owned-spin', destination: 'https://binary.invalid/clip' })).rejects.toThrow('Recorded clip handoff refused');
  expect(read).toHaveBeenCalledTimes(2);
});
