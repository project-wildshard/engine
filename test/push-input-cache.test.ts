// oxlint-disable-next-line import/no-nodejs-modules -- Verify provenance with real owned Git fixtures.
import { execFileSync } from 'node:child_process';
import { test } from 'vitest';

test('generation caches verify source, post tables, blobs and safe paths', () => {
  execFileSync('python3', ['test/test_push_input_cache.py'], { encoding: 'utf8', timeout: 10_000 });
});
