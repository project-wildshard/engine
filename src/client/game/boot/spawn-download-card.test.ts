// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';
import {paintSpawnDownload, type SpawnDownload, type SpawnDownloadSnapshot} from './spawnDownload';
import {Loading} from '@wildshard/engine/ui/Loading';
import {loadShellTemplate} from '@wildshard/engine/boot/shell';

test('the existing card paints one fixed list and reserves 100 for actual completion', () => {
  const root = document.createElement('div'); root.innerHTML = '<span data-el="dlFact"></span><span data-el="dlPct"></span><i data-el="dlBar"></i>';
  let row: SpawnDownloadSnapshot = {progressKnown: false, totalBytes: 7_000_000, completedBytes: 0, cachedBytes: 0, filesDone: 0, filesTotal: 2, complete: false, error: null};
  let update: (value: SpawnDownloadSnapshot) => void = () => undefined;
  const download: SpawnDownload = {ready: Promise.resolve(), snapshot: () => row, resolve: url => url, cancel: () => undefined,
    subscribe: listener => {update = listener; listener(row); return () => {update = () => undefined;};}};
  const stop = paintSpawnDownload(download, root);
  expect(root.querySelector('[data-el="dlFact"]')?.textContent).toBe('0.0 of 7.0 MB');
  expect(root.dataset['download']).toBe('');
  expect(root.querySelector('[data-el="dlPct"]')?.textContent).toBe('—');
  row = {...row, progressKnown: true, completedBytes: 7_000_000, cachedBytes: 6_900_000, filesDone: 2}; update(row);
  expect(root.dataset['download']).toBe('99');
  row = {...row, complete: true}; update(row);
  expect(root.dataset['download']).toBe('100'); expect(root.dataset['readsClosed']).toBe('true');
  expect(root.querySelector('[data-el="dlFact"]')?.textContent).toBe('0.1 MB downloaded, 6.9 MB from cache');
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
  expect(root.querySelector('[data-el="dlFact"]')?.textContent).toBe('4.0 of 18.0 MB');
  expect(root.dataset['download']).toBe('50'); expect(root.dataset['readBytes']).toBe('40000000');
  stop();
});

test('Loading takes the shell card\'s download bar from the early painter at once, in tenths (LS3: one painter)', () => {
  vi.stubGlobal('PerformanceObserver', class {observe(): void { /* not under test */ } disconnect(): void { /* not under test */ } takeRecords(): PerformanceEntry[] {return [];}});
  const card = document.createElement('div'); card.className = 'ws-load'; card.dataset['shell'] = ''; card.innerHTML = loadShellTemplate();
  document.body.append(card);
  let row: SpawnDownloadSnapshot = {totalBytes: 1000, completedBytes: 500, cachedBytes: 0, filesTotal: 2, filesDone: 1, complete: false, error: null};
  const listeners = new Set<(value: SpawnDownloadSnapshot) => void>();
  const download: SpawnDownload = {ready: new Promise<void>(() => { /* stays open: the takeover happens mid-download */ }), snapshot: () => row, resolve: url => url, cancel: () => undefined,
    subscribe: listener => {listeners.add(listener); listener(row); return () => {listeners.delete(listener);};}};
  // the early painter hears each update after Loading (the order that put a whole 95 back over 95.4)
  const update = (next: SpawnDownloadSnapshot): void => { row = next; for (const listener of [...listeners].reverse()) listener(next); };
  paintSpawnDownload(download, card); // entry.ts, from the tap
  const bar = card.querySelector<HTMLElement>('[data-el="dlBar"]');
  expect(bar?.style.width).toBe('50%');
  const loading = new Loading({id: 'driftwood-isle', name: 'Driftwood Isle'});
  try {
    expect(loading.root).toBe(card);
    void loading.setDownloadSource(download);
    expect(card.dataset['downloadPainter']).toBe('loading');
    expect(bar?.style.width).toBe('50.0%'); // Loading painted at once, in tenths
    update({...row, completedBytes: 954});
    expect(bar?.style.width).toBe('95.4%'); // never the early painter's whole 95 after it
    update({...row, completedBytes: 977});
    expect(bar?.style.width).toBe('97.7%');
    expect(card.dataset['readBytes']).toBe('977'); // the card's data still follows the download
  } finally { loading.scope.dispose(); vi.unstubAllGlobals(); card.remove(); }
});
