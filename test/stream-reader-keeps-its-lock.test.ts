// oxlint-disable-next-line import/no-nodejs-modules -- The check reads the source tree.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

/**
 * WebKit (iOS 26.5 Simulator, two freezes sampled 2026-11-06, one on a3e7ef2, one on 125c91d): `reader.releaseLock()` can run
 * a collection from inside itself (`InternalReadableStreamDefaultReader::releaseLock` → `Structure::materializePropertyTable`
 * → `Heap::collectInMutatorThread`), and marking the same reader (`JSReadableStreamDefaultReader::visitOutputConstraints`)
 * parks on a lock nobody will free. The page stops for good at 0 % CPU on its loading screen, and every worker in the process
 * stops with it. Nothing here reads a body after its reader, so a reader is cancelled or read to its end and then dropped.
 */
test('no stream reader releases its lock', () => {
  const rows = execFileSync('git', ['grep', '-n', String.raw`\.releaseLock()`, '--', 'src', ':!src/server/host/dist', ':!*.test.ts'], { encoding: 'utf8' }).split('\n').filter(row => row !== '');
  // FreeCam's is its own pointer lock; gridAssetBytes hands a custom stream's BYOB reader back so the default reader can take it.
  expect(rows.filter(row => !row.startsWith('src/client/engine/explore/FreeCam.ts:') && !row.includes('else candidate.releaseLock()'))).toEqual([]);
});
