import {expect, it} from 'vitest';
import {loadingDownloadText, loadingDownloadFraction, loadingPrefetchFraction, loadingPrefetchText, type LoadingPrefetchSnapshot} from './loadingDownloadText';

const manifest = {totalBytes: 52_000_000, completedBytes: 39_000_000, cachedBytes: 38_000_000,
  filesTotal: 4, filesDone: 3, complete: false, error: null};
it('counts only completed manifest content and its exact cache subset', () => {
  expect(loadingDownloadFraction(manifest)).toBe(0.75);
  expect(loadingDownloadText(manifest)).toBe('Spawn view · 39.0 MB of 52.0 MB · 38.0 MB from cache');
  const unrelated = {...manifest, networkBytes: 90_000_000, restoredBytes: 40_000_000};
  expect(loadingDownloadFraction(unrelated)).toBe(0.75);
  expect(loadingDownloadText(unrelated)).toBe(loadingDownloadText(manifest));
});
it('DL21: wire bytes still arriving count in the MB as they stream, before their file lands', () => {
  const wire = {totalBytes: 31_500_000, completedBytes: 0, cachedBytes: 0};
  expect(loadingDownloadText({...manifest, wire})).toBe('Spawn view · 0.00 MB of 31.5 MB · 0.00 MB from cache');
  expect(loadingDownloadText({...manifest, wire: {...wire, arrivingBytes: 2_400_000}})).toBe('Spawn view · 2.40 MB of 31.5 MB · 0.00 MB from cache');
});
it('reserves completion for the complete file operation, including genuinely empty lists', () => {
  const allBytes = {...manifest, completedBytes: 52_000_000, filesDone: 4};
  expect(loadingDownloadFraction(allBytes)).toBe(0.999);
  expect(loadingDownloadFraction({...allBytes, complete: true})).toBe(1);
  const empty = {...manifest, totalBytes: 0, completedBytes: 0, cachedBytes: 0, filesTotal: 0, filesDone: 0};
  expect(loadingDownloadFraction(empty)).toBe(0);
  expect(loadingDownloadFraction({...empty, complete: true})).toBe(1);
  expect(loadingDownloadText({...allBytes, cachedBytes: 51_600_000, complete: true})).toBe('Spawn view · 52.0 MB · 51.6 MB from cache');
});
const prefetch: LoadingPrefetchSnapshot = { phase: 'running', reason: null, products: 25, productsRead: 3,
  knownFiles: 10, knownBytes: 20_000_000, presentFiles: 2, presentBytes: 4_000_000, storedFiles: 3, storedBytes: 6_000_000 };

it('the grid prefetch row reports disk progress against the set known so far, and stops honestly', () => {
  expect(loadingPrefetchFraction(prefetch)).toBe(0.5);
  expect(loadingPrefetchText(prefetch)).toBe('Streams in play · On disk: 10.0 MB of 20.0 MB known so far · 5 / 10 files · 3 / 25 products checked · prefetching');
  expect(loadingPrefetchText({ ...prefetch, phase: 'quota', reason: 'storage quota' })).toContain('prefetch stopped (storage quota)');
  const cached = { ...prefetch, productsRead: 25, presentFiles: 7, presentBytes: 14_000_000 };
  expect(loadingPrefetchFraction(cached)).toBeLessThan(1);
  expect(loadingPrefetchFraction({ ...cached, phase: 'done' })).toBe(1);
});

it('prints encoded sizes while decoded progress keeps its own denominator', () => {
  const row = {...manifest, wire: {totalBytes: 18_000_000, completedBytes: 9_000_000, cachedBytes: 2_000_000}};
  expect(loadingDownloadText(row)).toBe('Spawn view · 9.00 MB of 18.0 MB · 2.00 MB from cache');
  expect(loadingDownloadFraction(row)).toBe(0.75);
  expect(loadingDownloadText({...row, complete: true, wire: {...row.wire, completedBytes: 18_000_000}})).toBe('Spawn view · 18.0 MB · 2.00 MB from cache');
});
