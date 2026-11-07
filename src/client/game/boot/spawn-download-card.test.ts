// @vitest-environment happy-dom
import {expect, test} from 'vitest';
import {paintSpawnDownload, type SpawnDownload, type SpawnDownloadSnapshot} from './spawnDownload';

test('the existing card paints one fixed list and reserves 100 for actual completion', () => {
  const root = document.createElement('div'); root.innerHTML = '<span data-el="dlFact"></span><span data-el="dlPct"></span><i data-el="dlBar"></i>';
  let row: SpawnDownloadSnapshot = {progressKnown: false, totalBytes: 7_000_000, completedBytes: 0, cachedBytes: 0, filesDone: 0, filesTotal: 2, complete: false, error: null};
  let update: (value: SpawnDownloadSnapshot) => void = () => undefined;
  const download: SpawnDownload = {ready: Promise.resolve(), snapshot: () => row, resolve: url => url, cancel: () => undefined,
    subscribe: listener => {update = listener; listener(row); return () => {update = () => undefined;};}};
  const stop = paintSpawnDownload(download, root);
  expect(root.querySelector('[data-el="dlFact"]')?.textContent).toBe('Spawn view · 0.00 MB of 7.00 MB · 0.00 MB from cache');
  expect(root.dataset['download']).toBe('');
  expect(root.querySelector('[data-el="dlPct"]')?.textContent).toBe('—');
  row = {...row, progressKnown: true, completedBytes: 7_000_000, cachedBytes: 6_900_000, filesDone: 2}; update(row);
  expect(root.dataset['download']).toBe('99');
  row = {...row, complete: true}; update(row);
  expect(root.dataset['download']).toBe('100'); expect(root.dataset['readsClosed']).toBe('true');
  expect(root.querySelector('[data-el="dlFact"]')?.textContent).toBe('Spawn view · 7.00 MB · 6.90 MB from cache');
  expect(root.querySelector<HTMLElement>('[data-el="dlBar"]')?.style.width).toBe('100%');
  stop(); update({...row, completedBytes: 1}); expect(root.dataset['readBytes']).toBe('7000000');
});

test('the early card prints wire facts without changing decoded percentage or diagnostics', () => {
  const root = document.createElement('div'); root.innerHTML = '<span data-el="dlFact"></span><span data-el="dlPct"></span><i data-el="dlBar"></i>';
  const row: SpawnDownloadSnapshot = {totalBytes: 80_000_000, completedBytes: 40_000_000, cachedBytes: 10_000_000,
    wire: {totalBytes: 18_000_000, completedBytes: 4_000_000, cachedBytes: 1_000_000}, filesTotal: 2, filesDone: 1, complete: false, error: null};
  const download: SpawnDownload = {ready: Promise.resolve(), snapshot: () => row, resolve: url => url, cancel: () => undefined,
    subscribe: listener => {listener(row); return () => undefined;}};
  const stop = paintSpawnDownload(download, root);
  expect(root.querySelector('[data-el="dlFact"]')?.textContent).toBe('Spawn view · 4.00 MB of 18.0 MB · 1.00 MB from cache');
  expect(root.dataset['download']).toBe('50'); expect(root.dataset['readBytes']).toBe('40000000');
  stop();
});
