import { expect, test } from 'vitest';
import { PHONE_PLAYING_BYTES } from './config';
import { memorySubsystem, memorySubsystems, PHONE_MEMORY_BUDGETS, ResidentByteCache } from './memoryBudget';

test('phone subsystem budgets allocate the full playing envelope', () => {
  expect(Object.values(PHONE_MEMORY_BUDGETS).reduce((bytes, budget) => bytes + budget, 0)).toBe(PHONE_PLAYING_BYTES);
});

test('each measured kind contributes its bytes to one subsystem', () => {
  const ledger = { gpu: { 'drawing-buffer': 1, renderbuffer: 2, buffer: 3, texture: 4 },
    ram: { 'geometry-cpu': 5, physics: 6, wasm: 7, 'audio-buffer': 8, 'audio-sprite-pcm': 9, 'audio-data': 17,
      'array-buffer': 10, wire: 11, canvas: 12, image: 13, 'image-bitmap': 14, decode: 18, scratch: 19 },
    workers: { 'basis/isolate': 0, 'basis/wasm': 15, 'standalone-server/wire': 16 } };
  expect(memorySubsystems(ledger)).toEqual({
    browser: { gpu: 1, ram: 0 }, engine: { gpu: 2, ram: 0 }, workers: { gpu: 0, ram: 38 },
    geometry: { gpu: 3, ram: 0 }, textures: { gpu: 4, ram: 0 }, scene: { gpu: 0, ram: 11 },
    audio: { gpu: 0, ram: 34 }, loading: { gpu: 0, ram: 97 }, margin: { gpu: 0, ram: 0 },
  });
  expect(() => memorySubsystem('gpu', 'program')).toThrow('Unbudgeted');
  expect(() => memorySubsystem('ram', 'constructor')).toThrow('Unbudgeted');
  expect(() => memorySubsystem('workers', 'wasm')).toThrow('Unbudgeted');
});

test('cache refreshes access order, evicts by bytes and keeps live loans', () => {
  const cache = new ResidentByteCache<string, Uint8Array>({ owner: 'fixture', bytes: 8 });
  const live = Uint8Array.of(1, 2, 3);
  expect(cache.set('live', live, live.byteLength)).toBe(true);
  expect(cache.set('unused', new Uint8Array(3), 3)).toBe(true);
  expect(cache.get('live')).toBe(live);
  expect(cache.set('fresh', new Uint8Array(4), 4)).toBe(true);
  expect(cache.get('unused')).toBeUndefined();
  expect(cache.set('too-large', new Uint8Array(9), 9)).toBe(false);
  expect(cache.get('live')).toEqual(Uint8Array.of(1, 2, 3));
  expect(cache.bytes).toBe(7);
});
