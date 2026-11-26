import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createTempRepo } from '../src/test/helpers/git.ts';
import { engineRelease } from '../src/scripts/changelog.mjs';
import { versionJson } from '../src/scripts/app-build/versionFiles';

// STAGING-BUGBASH SB7: staging v0.1.31's pill read v0.1.31 (__ENGINE_RELEASE__, releaseDescribe) while its /version.json said
// "v0.1.29-153-g5e0fb5efb": version.json took the raw `git describe`, and the release's tag did not exist when it built.
// version.json names a build with the pill's words.
test('version.json names an untagged release build by its release, as the pill does', () => {
  const repo = createTempRepo();
  try {
    const epoch = readFileSync('save-epoch.json', 'utf8');
    repo.commit({ 'package.json': JSON.stringify({ version: '0.1.29' }), 'save-epoch.json': epoch }, 'chore(release): v0.1.29');
    repo.git(['tag', 'v0.1.29']);
    repo.commit({ 'a.txt': 'a' }, 'fix(sim): a fix');
    repo.commit({ 'package.json': JSON.stringify({ version: '0.1.31' }) }, 'chore(release): v0.1.31');
    const version = versionJson('5e0fb5ef', repo.dir);
    expect(version.describe).toBe('v0.1.31');
    expect(version.describe).toBe(engineRelease(repo.dir).describe);
    expect(version.clientVersion).toBe('0.1.31');
    repo.commit({ 'b.txt': 'b' }, 'fix(boot): a release-branch fix');
    expect(versionJson('abc', repo.dir).describe).toMatch(/^v0\.1\.31-1-g[0-9a-f]+$/u);
  } finally { repo.cleanup(); }
});

test('version.json is written from the build root', () => {
  expect(versionJson('x', process.cwd()).clientVersion).toBe((JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version);
});

// WR8b and J492 each raise the floor from their own release onward.
test.each([['0.1.29', '0.1.29'], ['0.1.35', '0.1.35'], ['0.1.36', '0.1.36'], ['0.1.72', '0.1.36'], ['0.1.73', '0.1.73'], ['0.1.74', '0.1.73'], ['0.2.0', '0.1.73']])('version.json for %s emits a floor it can boot under', (version, floor) => {
  const repo = createTempRepo();
  try {
    repo.commit({ 'package.json': JSON.stringify({ version }), 'save-epoch.json': readFileSync('save-epoch.json', 'utf8') }, `chore(release): v${version}`);
    expect(versionJson('main-build', repo.dir)).toMatchObject({ clientVersion: version, minClient: floor });
  } finally { repo.cleanup(); }
});
