// Meta QA 11-25 rows 54 and 58: which lane made each commit, read the way main-push writes it (a `Lane:` paragraph
// above `Assisted-by:`, which git's %(trailers) never sees), and land's refusal of another lane's commit.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, afterEach, expect, test} from 'vitest';
import {scratchDir} from '../../scripts/scratch-dir.mjs';
import {commitLanes, foreignCommits, messageLane, messageLanes, nameCommits} from '../../scripts/lane-commits.mjs';

const task = process.env.WS_LANE_NAME ?? `test-lane-commits-${process.pid}`;
const existed = existsSync(resolve('tmp', task));
const parent = scratchDir(task, 'lane-commits fixture', {env: {...process.env, WS_LANE_NAME: task}});
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
afterAll(() => { if (!existed && readdirSync(parent).every(name => name === '.owner')) rmSync(parent, {recursive: true}); });
const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'};

test('a Lane paragraph above Assisted-by names the lane; git\'s trailer block would not', () => {
  const body = 'feat(trailer): restore capture\n\nWhy.\n\nLane: opus-trailer\n\nAssisted-by: Claude:claude-opus-5-5\n';
  expect(messageLane(body)).toBe('opus-trailer');
  expect(messageLanes('x\n\nLane: opus-a\nLane: opus-b\n')).toEqual(['opus-a', 'opus-b']);
  expect(messageLane('x\n\nNo lane here; Lane: inline is not one\n')).toBeNull();
});

test('two lanes\' commits in one range: each is named, and the pusher\'s foreign set holds only the other lane\'s', () => {
  const root = mkdtempSync(join(parent, 'repo-')); roots.push(root);
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', env}).trim();
  git('init', '-q', '-b', 'main');
  const commit = (file, ...messages) => { writeFileSync(join(root, file), `${file}\n`); git('add', file); git('commit', '-q', '--no-verify', ...messages.flatMap(message => ['-m', message])); return git('rev-parse', 'HEAD'); };
  const base = commit('base.md', 'base');
  const mine = commit('mine.md', 'docs: mine', 'Lane: opus-a', 'Assisted-by: Claude:claude-opus-5-5');
  const theirs = commit('theirs.md', 'docs: theirs', 'Why.', 'Lane: opus-b', 'Assisted-by: Claude:claude-opus-5-5');
  const loose = commit('loose.md', 'docs: unnamed');
  const rows = commitLanes(root, `${base}..HEAD`);
  expect(rows).toEqual([{sha: mine, subject: 'docs: mine', lane: 'opus-a'}, {sha: theirs, subject: 'docs: theirs', lane: 'opus-b'}, {sha: loose, subject: 'docs: unnamed', lane: null}]);
  // main-push (a shared checkout): an unnamed commit is nobody's to push. land (the lane's own worktree): it is the lane's.
  expect(foreignCommits(rows, 'opus-a').map(row => row.sha)).toEqual([theirs, loose]);
  expect(foreignCommits(rows, 'opus-a', {unnamed: 'own'}).map(row => row.sha)).toEqual([theirs]);
  expect(nameCommits(foreignCommits(rows, 'opus-a'))).toBe(`${theirs.slice(0, 10)} (opus-b) docs: theirs; ${loose.slice(0, 10)} (no Lane trailer) docs: unnamed`);
});

test('land refuses another lane\'s commit before its main push, and main-watch reads lanes from the whole body', () => {
  const land = readFileSync(resolve('scripts/land.mjs'), 'utf8');
  const refusal = land.indexOf("foreignCommits(commitLanes(this.root,`${main}..${head}`,this.env),this.lane,{unnamed:'own'})");
  expect(refusal).toBeGreaterThan(0);
  expect(land.indexOf('const args=mainPushArgs(head);', refusal)).toBeGreaterThan(refusal);
  const watch = readFileSync(resolve('scripts/main-watch.mjs'), 'utf8');
  expect(watch).toContain("'--format=%H%x00%B%x1e'");
  expect(watch).not.toContain('%(trailers:key=Lane');
});
