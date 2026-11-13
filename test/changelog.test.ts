// oxlint-disable-next-line import/no-nodejs-modules -- It reads the real CHANGELOG.md and package.json.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { engineRelease, noteProblem, parseChangelog, pushProblems, releaseProblems } from '../scripts/changelog.mjs';
import { buildLabel, shortBuild } from '../src/client/engine/ui/buildCheck';
import { changelogDate, shortBuild as menuShortBuild, versionLabel } from '../src/client/game/whatsNewBanner';

// Jake, 2026-11-10: every engine version tag, patches included, carries a changelog of plain-language bullets, and the title
// names the engine version and the short commit.
const SECTION = (version: string, notes: readonly string[]): string => `## v${version} (2026-11-10)\n\n${notes.map(note => `- ${note}\n`).join('')}\n`;
const NOTE = 'Hover boost keeps going for as long as you hold it';

test('the real changelog has a valid section for package.json\'s version', () => {
  const text = readFileSync('CHANGELOG.md', 'utf8'), release = engineRelease(process.cwd());
  expect(releaseProblems(text, release.version)).toEqual([]);
  expect(release.notes.length).toBeGreaterThanOrEqual(1);
  expect(release.notes.length).toBeLessThanOrEqual(5);
  expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
});

test('a build names itself by git describe against the version tags (WL19c)', () => {
  // '' only where the checkout has no version tag (a shallow clone); preview.yml fetches the whole history
  const { describe } = engineRelease(process.cwd());
  expect(describe).toMatch(/^(?:v\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]{7,40})?)?$/u);
});

test('a section has one to five bullets, newest first, each version once', () => {
  expect(parseChangelog(SECTION('0.1.6', [NOTE]) + SECTION('0.1.5', [NOTE])).problems).toEqual([]);
  expect(parseChangelog(SECTION('0.1.6', [])).problems.join()).toMatch(/0 bullets/u);
  expect(parseChangelog(SECTION('0.1.6', Array.from({ length: 6 }, () => NOTE))).problems.join()).toMatch(/6 bullets/u);
  expect(parseChangelog(SECTION('0.1.5', [NOTE]) + SECTION('0.1.6', [NOTE])).problems.join()).toMatch(/newest first/u);
  expect(parseChangelog('## 0.1.6\n\n- ' + NOTE + '\n').problems.join()).toMatch(/not "## vX\.Y\.Z/u);
  expect(parseChangelog(SECTION('0.1.6', [NOTE]) + 'a stray line\n').problems.join()).toMatch(/not a "- " bullet/u);
});

test('bullets are for players and Jake, not commit subjects, hashes or files', () => {
  expect(noteProblem(NOTE)).toBeNull();
  expect(noteProblem('fix(render): pace only software rasterizers')).toMatch(/commit subject/u);
  expect(noteProblem('Fixed the stall from a8144a50e79a when leaving')).toMatch(/hash/u);
  expect(noteProblem('Changed src/client/game/mainMenu.css spacing')).toMatch(/code or a file/u);
  expect(noteProblem('Faster')).toMatch(/too short/u);
});

test('a version ships only with its own section; the next version\'s may sit above it', () => {
  const both = SECTION('0.1.6', [NOTE]) + SECTION('0.1.5', [NOTE]);
  expect(releaseProblems(both, '0.1.5')).toEqual([]);
  expect(releaseProblems(both, '0.1.6')).toEqual([]);
  expect(releaseProblems(both, '0.1.7').join()).toMatch(/no section for v0\.1\.7/u);
  expect(releaseProblems(SECTION('0.1.7', [NOTE]) + both, '0.1.5').join()).toMatch(/2 sections above/u);
});

test('the push check reads main and version tags only, at the pushed commit', () => {
  const head = 'HEAD';
  // this checkout's HEAD may predate CHANGELOG.md; either way the check reads that commit, never the working tree
  const lines = (remote: string, local = head): string => `refs/x ${local} ${remote} 0000000000000000000000000000000000000000\n`;
  expect(pushProblems(lines('refs/tags/server-staging-abc'))).toEqual([]);
  expect(pushProblems(lines('refs/tags/v0.1.5', '0000000000000000000000000000000000000000'))).toEqual([]);
  expect(pushProblems(lines('refs/tags/v9.9.9')).join()).toMatch(/v9\.9\.9: /u);
});

test('the title names a build by the engine version and the 7-character commit', () => {
  expect(shortBuild('a8144a50e79afe7e66a8ecdce9406e152518c916')).toBe('a8144a5');
  expect(shortBuild('a8144a5-mwavaean')).toBe('a8144a5');
  expect(shortBuild('b-mwavaean')).toBe('mwavaean');
  expect(menuShortBuild('a8144a50e79afe7e66a8ecdce9406e152518c916')).toBe('a8144a5');
  expect(buildLabel('a8144a50e79afe7e66a8ecdce9406e152518c916', '0.1.5')).toBe('v0.1.5 · a8144a5');
  expect(buildLabel('a8144a5-mwavaean', '')).toBe('a8144a5');
  expect(versionLabel('0.1.5', 'a8144a5')).toBe('v0.1.5 · a8144a5');
  // WL19c: a build that knows its git describe is named by it alone (Jake, 2026-11-12)
  expect(buildLabel('5a43d1c473aa', '0.1.13', 'v0.1.13-100-g5a43d1c4')).toBe('v0.1.13-100-g5a43d1c4');
  expect(versionLabel('0.1.13', '5a43d1c', 'v0.1.13-100-g5a43d1c4')).toBe('v0.1.13-100-g5a43d1c4');
  expect(versionLabel('0.1.14', '5a43d1c', '')).toBe('v0.1.14 · 5a43d1c');
  expect(changelogDate('2026-11-10')).toBe('10 NOV 2026');
  expect(changelogDate('')).toBe('');
});
