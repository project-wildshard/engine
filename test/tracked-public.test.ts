// oxlint-disable-next-line import/no-nodejs-modules -- A fixture repo and a mirror-like tree with no .git, on disk.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture files.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixtures live in the OS temp folder.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { trackedPublic } from '../scripts/tracked-public.mjs';

// GRID-CROSSING GC36's proofs: `serve-build.sh --head` builds in a build-mirror slot, which has no .git and stops git discovery
// at the slot. pins.ts asked `git ls-files public` there, got nothing, and refused Driftwood for a tracked engine KTX2
// (`lm-ao.phone-9f6766dc.ktx2`) its table names. The slot's own index is read instead.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('a mirror tree with no .git reads the tracked public files from the index it names', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracked-public-')), repo = join(root, 'repo'), slot = join(root, 'slot'), tree = join(slot, 'tree');
  roots.push(root);
  mkdirSync(join(repo, 'public/assets'), { recursive: true }); mkdirSync(tree, { recursive: true });
  writeFileSync(join(repo, 'public/assets/lm-ao.phone.ktx2'), 'ktx2'); writeFileSync(join(tree, 'README'), 'mirror');
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }); };
  git('init', '-q'); git('add', 'public');
  copyFileSync(join(repo, '.git/index'), join(slot, 'index'));
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: slot };
  expect([...trackedPublic(env, tree)], 'no .git in the slot: git alone finds nothing').toEqual([]);
  expect([...trackedPublic({ ...env, WS_MIRROR_REPO: repo, WS_MIRROR_INDEX: join(slot, 'index') }, tree)]).toEqual(['public/assets/lm-ao.phone.ktx2']);
  expect([...trackedPublic(process.env, repo)], 'a checkout reads its own index').toEqual(['public/assets/lm-ao.phone.ktx2']);
});
