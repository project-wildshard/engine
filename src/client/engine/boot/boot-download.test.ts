import { expect, it } from 'vitest';
import { readDownloadFiles, readModuleFiles } from './download';
import { beginLoadingWait, reportLoadingWait, finishLoadingWait, loadingWaitState } from '../../../shared/engine/boot/loadingWaits';

it('reads exact compiler module bodies and rejects every invalid suffix', () => {
  for (const invalid of [null, [['/assets/first.js', 4], ['https://foreign.test/late.js', 2]],
    [['/assets/first.js', 4], ['/assets/late.js', -1]], [['/assets/first.js', 4], ['/assets/late.js', 1.5]],
    [['/assets/first.js', 4], ['/assets/../late.js', 1]], [['/assets/first.js', 4, 'extra']]]) {
    expect(() => readModuleFiles(invalid)).toThrow('Invalid boot module');
  }
  expect(readModuleFiles([['/assets/shared.js', 10], ['/assets/first.js', 4], ['/assets/page.css', 3]]))
    .toEqual([['/assets/shared.js', 10], ['/assets/first.js', 4], ['/assets/page.css', 3]]);
});

it('detaches caller module rows and revalidates their later mutations', () => {
  const input: [string, number][] = [['/assets/parser.js', 8]];
  const first = readModuleFiles(input), row = input[0];
  if (row === undefined) throw new Error('Missing original module');
  row[1] = 12;
  expect(first).toEqual([['/assets/parser.js', 8]]);
  expect(readModuleFiles(input)).toEqual([['/assets/parser.js', 12]]);
  input.push(['/assets/next.js', 4], ['https://foreign.test/bad.js', 1]);
  expect(() => readModuleFiles(input)).toThrow('Invalid boot module file');
  expect(first).toEqual([['/assets/parser.js', 8]]);
});

it('keeps the original module-bank bound and integer byte contract', () => {
  const rows = Array.from({ length: 4096 }, (_, index) => [`/assets/part-${index}.js`, index]);
  expect(readModuleFiles(rows)).toHaveLength(4096);
  expect(() => readModuleFiles([...rows, ['/assets/extra.js', 1]])).toThrow('Invalid boot module bank');
  for (const bytes of [Number.NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => readModuleFiles([['/assets/part.js', bytes]])).toThrow('Invalid boot module file');
});

it('reads exact spawn-manifest asset rows without accepting traversal, origins or malformed sizes', () => {
  const rows = [['/assets/baked/header.json', 17], ['/assets/baked/data.bin', 29], ['/assets/code/entry.pack', 41]];
  expect(readDownloadFiles(rows)).toEqual(rows);
  for (const invalid of [null, [['/assets/good.bin', 4], ['/assets/../bad.bin', 2]],
    [['/assets/good.bin', 4], ['https://foreign.test/bad.bin', 2]], [['/assets/good.bin', 4], ['/assets/bad.bin', -1]],
    [['/assets/good.bin', 4], ['/assets/bad.bin', 1.5]], [['/assets/good.bin', 4, 'extra']]])
    expect(() => readDownloadFiles(invalid)).toThrow('Invalid download file');
});

it('shared wait metadata renews only for byte growth or real semantic progress', () => {
  const state = loadingWaitState(), id = beginLoadingWait('Held body', { loadedBytes: 0, totalBytes: 4096, progressAt: 100, retry: null });
  try {
    const row = state.pending.get(id); if (row === undefined) throw new Error('Missing shared wait');
    reportLoadingWait(id, { loadedBytes: 1024 }, 200);
    expect(row.progressAt).toBe(200); expect(row.loadedBytes).toBe(1024);
    reportLoadingWait(id, { loadedBytes: 1024, label: 'A more precise held body' }, 1000);
    expect(row.progressAt).toBe(200);
    reportLoadingWait(id, { progress: 'source' }, 1200); expect(row.progressAt).toBe(200);
    reportLoadingWait(id, { progress: 'decode' }, 1400); expect(row.progressAt).toBe(1400);
    expect(row).toMatchObject({ totalBytes: 4096, retry: null });
  } finally { finishLoadingWait(id); }
  expect(state.pending.has(id)).toBe(false);
});
