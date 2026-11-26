// Meta QA 11-25 row 58: a commit made under WS_LANE_NAME names its lane, in main-push's shape, through the real hook.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withLane } from './lane-trailer.mjs';
import { messageLane } from '../src/scripts/lane-commits.mjs';

const TRAILER = 'Assisted-by: Claude:claude-opus-5-5';

test('adds a Lane paragraph above Assisted-by, or at the end; leaves named, generated and laneless messages', () => {
  assert.equal(withLane(`fix(x): y\n\nWhy.\n\n${TRAILER}\n`, 'opus-a'), `fix(x): y\n\nWhy.\n\nLane: opus-a\n\n${TRAILER}\n`);
  assert.equal(withLane(`fix(x): y\n\nWhy.\n${TRAILER}\n`, 'opus-a'), `fix(x): y\n\nWhy.\n\nLane: opus-a\n\n${TRAILER}\n`);
  assert.equal(withLane('fix(x): y\n\nWhy.\n\n# Please enter the commit message\n# comment\n', 'opus-a'), 'fix(x): y\n\nWhy.\n\nLane: opus-a\n\n# Please enter the commit message\n# comment\n');
  assert.equal(withLane(`fix(x): y\n\nLane: opus-b\n\n${TRAILER}\n`, 'opus-a'), `fix(x): y\n\nLane: opus-b\n\n${TRAILER}\n`);
  for (const subject of ['Merge branch \'x\'', 'fixup! fix(x): y', 'Revert "fix(x): y"']) assert.equal(withLane(`${subject}\n`, 'opus-a'), `${subject}\n`);
  assert.equal(withLane(`fix(x): y\n\n${TRAILER}\n`, undefined), `fix(x): y\n\n${TRAILER}\n`);
  assert.equal(withLane(`fix(x): y\n\n${TRAILER}\n`, 'Not A Lane'), `fix(x): y\n\n${TRAILER}\n`);
  assert.equal(messageLane(withLane(`fix(x): y\n\nWhy.\n\n${TRAILER}\n`, 'opus-a')), 'opus-a');
});

const root = mkdtempSync(join(tmpdir(), 'lane-trailer-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('the commit-msg hook writes the lane of a commit made by hand, and the message still passes its rules', () => {
  // A lane's own SKIP_ or ALLOW_ hatch would otherwise refuse this unnamed sandbox commit (test-helpers ENV does the same).
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !/^(?:SKIP|ALLOW)_/u.test(key))), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...env, WS_LANE_NAME: 'opus-guard' } });
  git('init', '-q', '-b', 'main');
  cpSync(fileURLToPath(new URL('.', import.meta.url)), join(root, '.githooks'), { recursive: true, filter: path => !path.endsWith('.test.mjs') });
  git('config', 'core.hooksPath', '.githooks');
  writeFileSync(join(root, 'a.md'), 'a\n');
  git('add', 'a.md');
  const made = git('commit', '-q', '-m', 'docs(a): add a', '-m', 'Why it matters.', '-m', TRAILER);
  assert.equal(made.status, 0, made.stderr);
  assert.equal(git('log', '-1', '--format=%B').stdout.trim(), `docs(a): add a\n\nWhy it matters.\n\nLane: opus-guard\n\n${TRAILER}`);
});
