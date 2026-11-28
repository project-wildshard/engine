// Meta QA 11-26 row 88: engine 85f353419 pinned shard-format 0.82.9 (SF23) and test/boot-audio-packs.test.ts, which
// feeds its fixture straight to `@wildshard/format/audio`, went red on main: the split gate's full mode ran only native
// files. A dependency bump now runs, locally, the tests that import the entry points the bump changed.
import {afterAll, expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned Git fixture and a fake pnpm store.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned Git fixture and a fake pnpm store.
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned Git fixture and a fake pnpm store.
import {dirname, join, resolve} from 'node:path';
import {changedDependencies, changedEntryPoints, changedPackageFiles, dependencyReaders, versionDir} from '../src/scripts/push-dependency-readers.mjs';

mkdirSync(resolve('tmp'), {recursive: true});
const root = mkdtempSync(resolve('tmp', 'dependency-readers-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));

const write = (path: string, text: string) => { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); };
const NAME = '@wildshard/shard-format';
const EXPORTS = {'./audio': './src/audio.ts', './rule': './src/rule.ts', './level': './src/level.ts', './far': './src/far.ts'};

/** One store copy of the fake format package: rule.ts holds the rule; audio.ts imports it; level.ts imports audio.ts. */
function storeCopy(version: string, rule: string) {
  const dir = join(root, 'store', 'links', NAME, version, 'h4sh', 'node_modules', NAME);
  write(join(dir, 'package.json'), JSON.stringify({name: NAME, version, exports: EXPORTS}));
  write(join(dir, 'src', 'rule.ts'), `export const RULE = ${JSON.stringify(rule)};\n`);
  write(join(dir, 'src', 'audio.ts'), "import { RULE } from './rule.ts';\nexport const audio = RULE;\n");
  write(join(dir, 'src', 'level.ts'), "export { audio } from './audio';\n");
  write(join(dir, 'src', 'far.ts'), 'export const far = 1;\n');
  return dir;
}

test('a format pin bump runs the readers of the entry points it changed, nearest first', () => {
  const before = storeCopy('0.82.8', 'pine and island'), after = storeCopy('0.82.9', 'title only');
  const repo = join(root, 'repo'), git = (...args: string[]) => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
  mkdirSync(repo, {recursive: true});
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'fixture');
  const pkg = (version: string) => `${JSON.stringify({dependencies: {'@wildshard/format': `npm:${NAME}@${version}`, fflate: '0.8.3'}}, null, 2)}\n`;
  write(join(repo, 'package.json'), pkg('0.82.8'));
  write(join(repo, 'test', 'boot-audio-packs.test.ts'), "import { parseAudioData } from '@wildshard/format/audio';\n");
  write(join(repo, 'test', 'level.test.ts'), "import { level } from '@wildshard/format/level';\n");
  write(join(repo, 'test', 'far.test.ts'), "import { far } from '@wildshard/format/far';\n");
  write(join(repo, 'test', 'audio-prefix.test.ts'), "import { x } from '@wildshard/format/audioProfiles';\n");
  write(join(repo, 'src', 'scripts', 'reader.mjs'), "import { audio } from '@wildshard/format/audio';\n");
  git('add', '.'); git('commit', '-q', '--no-verify', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  write(join(repo, 'package.json'), pkg('0.82.9'));
  git('commit', '-q', '--no-verify', '-am', 'pin 0.82.9');
  const head = git('rev-parse', 'HEAD');
  mkdirSync(join(repo, 'node_modules', '@wildshard'), {recursive: true});
  symlinkSync(after, join(repo, 'node_modules', '@wildshard', 'format'));

  expect(changedDependencies(git('show', `${base}:package.json`), git('show', `${head}:package.json`)))
    .toEqual([{alias: '@wildshard/format', name: NAME, from: '0.82.8', to: '0.82.9'}]);
  expect(versionDir(after, NAME, '0.82.8')).toBe(before);
  expect(changedPackageFiles(before, after)).toEqual(['src/rule.ts']);
  expect(changedEntryPoints(after, ['src/rule.ts'])).toEqual([
    {entry: './rule', distance: 0}, {entry: './audio', distance: 1}, {entry: './level', distance: 2},
  ]);
  const readers = dependencyReaders(`refs/heads/main ${head} refs/heads/main ${base}`, repo);
  // the whole specifier only: '@wildshard/format/audioProfiles' is not '@wildshard/format/audio'; a script is no test
  expect(readers.tests).toEqual(['test/boot-audio-packs.test.ts', 'test/level.test.ts']);
  expect(readers.notes).toEqual(['@wildshard/format 0.82.8 -> 0.82.9: 3 entry point(s) reach the change; 2 reader(s) of the nearest 3 import step(s)']);

  // With no old copy to diff, every direct reader of the package runs.
  rmSync(join(root, 'store', 'links', NAME, '0.82.8'), {recursive: true});
  expect(dependencyReaders(`refs/heads/main ${head} refs/heads/main ${base}`, repo).tests)
    .toEqual(['test/audio-prefix.test.ts', 'test/boot-audio-packs.test.ts', 'test/far.test.ts', 'test/level.test.ts']);
  // No package.json change, no readers.
  expect(dependencyReaders(`refs/heads/main ${head} refs/heads/main ${head}`, repo)).toEqual({tests: [], notes: []});
});
