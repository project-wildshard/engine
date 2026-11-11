// J240 / DEV-SPEED DS6: `pins.ts install` in a plan worktree must not rewrite the canonical checkout's exclude block
// (codex-port, 2026-11-10: a `--from-format` install in a worktree broke the parent's pins). Git's exclude file is
// shared by every worktree, so only the canonical checkout writes it. Real Git, one linked worktree.
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {excludePublished, excludeText, excludedPaths, pinsOutputs} from '../../scripts/pins-exclude.mjs';
import {capturePushTree} from '../../scripts/push-proof-cache.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const ENV = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', args, {cwd, env: ENV, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
/** @param {string} root @param {string} path */
const publish = (root, path) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), 'mount\n'); };
const BEGIN = '# pins: mounts published under public/, begin', END = '# pins: mounts published under public/, end';

describe('pins exclude block', () => {
  test('pins in a worktree leave the shared exclude and the parent\'s pins intact', () => {
    const root = mkdtempSync(join(tmpdir(), 'pins-exclude-'));
    roots.push(root);
    git(root, ['init', '-q', '-b', 'main']);
    writeFileSync(join(root, 'tracked.txt'), 'x\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed']);
    git(root, ['worktree', 'add', '-q', '-b', 'plan/p', '.worktrees/p', 'main']);
    const tree = join(root, '.worktrees/p'), exclude = join(root, '.git/info/exclude');
    writeFileSync(exclude, '# a hand-written line\n/.worktrees/\n');

    const parent = ['public/assets/a.bin', 'public/assets/b.bin'];
    for (const path of parent) publish(root, path);
    expect(excludePublished(parent, root)).toEqual({written: true, uncovered: 0});
    expect(git(root, ['status', '--porcelain'])).toBe('');
    const before = readFileSync(exclude, 'utf8');

    // The same pins in the worktree are covered already; a --from-format install publishing one extra path leaves
    // that path untracked in the worktree only, and the shared file byte for byte as the parent wrote it.
    publish(tree, 'public/assets/b.bin');
    expect(excludePublished(['public/assets/b.bin'], tree)).toEqual({written: false, uncovered: 0});
    publish(tree, 'public/assets/c.bin');
    expect(excludePublished(['public/assets/b.bin', 'public/assets/c.bin'], tree)).toEqual({written: false, uncovered: 1});
    expect(readFileSync(exclude, 'utf8')).toBe(before);
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect(git(tree, ['status', '--porcelain', '--untracked-files=all'])).toBe('?? public/assets/c.bin');
    expect(git(tree, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
  });

  test('replaces only the pins block and keeps every other line, CRLF and a missing end marker included', () => {
    const legacy = `keep\n${BEGIN}\n/public/old\n${END}\ntail\n`;
    expect(excludeText(legacy, ['public/new'])).toBe(`keep\ntail\n${BEGIN}\n/public/new\n${END}\n`);
    expect(excludeText(legacy.replaceAll('\n', '\r\n'), ['public/new'])).toBe(`keep\ntail\n${BEGIN}\n/public/new\n${END}\n`);
    expect(excludeText(`keep\n${BEGIN}\n*.local\n`, ['public/new'])).toBe(`keep\n*.local\n${BEGIN}\n/public/new\n${END}\n`);
    expect(excludeText('', [])).toBe(`${BEGIN}\n${END}\n`);
    expect([...excludedPaths(legacy)]).toEqual(['public/old']);
    expect([...excludedPaths(`${BEGIN}\n/public/x\n`)]).toEqual([]);
  });

  test("the push proof ignores this tree's own untracked pins outputs, and nothing else (voice2's fresh clone)", () => {
    const root = mkdtempSync(join(tmpdir(), 'pins-proof-'));
    roots.push(root);
    git(root, ['init', '-q', '-b', 'main']);
    writeFileSync(join(root, '.gitignore'), '/out/\n');
    git(root, ['add', '.gitignore']);
    git(root, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed']);
    const head = git(root, ['rev-parse', 'HEAD']);
    // No exclude block was ever written: the published mount shows as untracked.
    publish(root, 'public/assets/a/m.bin');
    mkdirSync(join(root, 'out'), {recursive: true});
    writeFileSync(join(root, 'out/.pins.json'), JSON.stringify({revision: 'r', published: ['public/assets/a/m.bin', '../escape', 'public/../x']}));
    expect([...pinsOutputs(root)]).toEqual(['public/assets/a/m.bin']);
    const capture = () => capturePushTree('p', {WS_PUSH_REFS: `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}`}, root);
    const clean = (() => { try { capture(); return ''; } catch (error) { return error instanceof Error ? error.message : String(error); } })();
    expect(clean).not.toMatch(/clean checked tree/u);
    publish(root, 'public/assets/a/stray.bin');
    expect(capture).toThrow(/requires a clean checked tree/u);
  });
});
