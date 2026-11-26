// QA 11-23 row 7 (SP7b, v0.1.75 staging): the box cook worker logged "no cook revision" on every start, so a build switch
// recooked all 65 heads instead of carrying them. cook-worker.mjs names its root `fileURLToPath(new URL('../..', import.meta.url))`,
// which ends in `/`, and cookRevision's escape check refused every closure file under that root. The worker's own root form
// now gives the same revision as the plain one, so `carry` (cook-recook-rule.test.ts) applies on the box.
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {expect, it} from 'vitest';
import {cookRevision} from '../src/scripts/cook-revision';

it('the cook worker\'s root, with its trailing slash, has the checkout\'s cook revision', () => {
  const workerRoot = fileURLToPath(new URL('../..', pathToFileURL(resolve('src/scripts/cook-worker.mjs'))));
  expect(workerRoot.endsWith('/')).toBe(true);
  const plain = cookRevision(resolve('.'));
  expect(cookRevision(workerRoot).revision).toBe(plain.revision);
  expect(plain.files).toContain('src/cook/game/cookJob.ts');
}, 120_000);
