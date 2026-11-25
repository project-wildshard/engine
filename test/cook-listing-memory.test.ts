// oxlint-disable-next-line import/no-nodejs-modules -- A child Node with --expose-gc measures the heap a listing keeps.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

// 11-25: the box cook was OOM-killed three times at its 4G MemoryMax (11:00, 11:27, 12:07 UTC), mid-Nalati, once a full
// bucket listing (about 1M objects on staging) overlapped a cook. Each regex-captured key kept its whole listing page
// alive: a 1M-object listing held 370 MiB of heap, 173 MiB with fresh keys. This lists 200k objects through the real
// r2Store over a fake fetch and caps what each kept row costs.
const ROWS_PER_PAGE = 1000, PAGES = 200, CAP_BYTES_PER_ROW = 260;
const script = `
const {r2Store} = await import(${JSON.stringify(resolve('src/cook/game/packStore.ts'))});
let page = 0;
const body = p => { let s = '<?xml version="1.0"?><ListBucketResult>';
  for (let i = 0; i < ${ROWS_PER_PAGE}; i++) s += '<Contents><Key>packs/' + p.toString(16).padStart(6, '0') + '/' + 'a'.repeat(40) + i.toString(16).padStart(8, '0')
    + '.bin</Key><LastModified>2026-11-25T10:00:00.000Z</LastModified><ETag>&quot;' + 'f'.repeat(32) + '&quot;</ETag><Size>12345</Size><StorageClass>STANDARD</StorageClass></Contents>';
  return s + (p + 1 < ${PAGES} ? '<IsTruncated>true</IsTruncated><NextContinuationToken>t' + (p + 1) + '</NextContinuationToken>' : '<IsTruncated>false</IsTruncated>') + '</ListBucketResult>'; };
const store = r2Store({endpoint: 'https://r2.invalid', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', fetch: async () => new Response(body(page++))});
global.gc(); const before = process.memoryUsage().heapUsed;
const rows = await store.list('');
global.gc(); const after = process.memoryUsage().heapUsed;
console.log(JSON.stringify({rows: rows.length, perRow: (after - before) / rows.length}));
`;

test('a bucket listing keeps no page text: each row costs under 260 bytes of heap', () => {
  const run = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {encoding: 'utf8', timeout: 120_000});
  expect(run.status, run.stderr).toBe(0);
  const {rows, perRow} = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '{}') as {rows: number; perRow: number};
  expect(rows).toBe(ROWS_PER_PAGE * PAGES);
  expect(perRow).toBeLessThan(CAP_BYTES_PER_ROW);
});
