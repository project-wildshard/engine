// BUILD-MAX EV1 / WORKTREE-LAND WL11 (J290): the push gate checks the pushed commit in a clean copy, so another
// lane's dirty or untracked file in the shared checkout neither refuses the push nor reaches the checks. Real Git:
// a canonical checkout where lane A has a type-broken tracked edit and a type-broken untracked file, and lane B
// commits one file by pathspec. The "gate" here is `node --check` over every .mjs file in the gated tree.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {GATE_DIR, copyReason, makeGateCopy, pushedCommit, sweepDeadCopies} from '../../scripts/push-gate-copy.mjs';
import {mainPull} from '../../scripts/main-pull.mjs';
import {capturePushTree} from '../../scripts/push-proof-cache.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const ENV = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], {cwd, env: ENV, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const zero = '0'.repeat(40);
/** The stand-in gate: every .mjs file of the tree must parse. @param {string} tree */
const gate = (tree) => readdirSync(tree).filter((file) => file.endsWith('.mjs')).every((file) => spawnSync(process.execPath, ['--check', join(tree, file)]).status === 0);

/** A canonical checkout with one commit, under the repo's tmp/ (AGENTS.md: never the system tmp). */
function canonical() {
  mkdirSync(resolve('tmp'), {recursive: true});
  const root = mkdtempSync(resolve('tmp/push-gate-copy-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, '.gitignore'), '/tmp/\n/node_modules/\n');
  writeFileSync(join(root, 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(root, 'shared.mjs'), 'export const shared = 1;\n');
  git(root, ['add', '.gitignore', 'a.mjs', 'shared.mjs']);
  git(root, ['commit', '-q', '-m', 'seed']);
  // Ignored build state the copy clones whole.
  mkdirSync(join(root, 'node_modules/dep'), {recursive: true});
  writeFileSync(join(root, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
  return root;
}

describe('push gate copy (EV1)', () => {
  test('lane B pushes green past lane A\'s broken edits, which stay byte-identical; a broken commit still goes red', () => {
    const root = canonical();
    // Lane A: a tracked type-broken edit and an untracked type-broken file, never committed.
    const brokenEdit = 'export const shared = ;\n', brokenNew = 'export const = 2;\n';
    writeFileSync(join(root, 'shared.mjs'), brokenEdit);
    writeFileSync(join(root, 'scratch.mjs'), brokenNew);
    // Lane B: commits one clean file by pathspec.
    writeFileSync(join(root, 'b.mjs'), 'export const b = 2;\n');
    git(root, ['add', 'b.mjs']);
    git(root, ['commit', '-q', '-m', 'lane B', '--', 'b.mjs']);
    const head = git(root, ['rev-parse', 'HEAD']), refs = `refs/heads/main ${head} refs/heads/main ${zero}`;

    // Before EV1 the gate refused here, before it ran anything.
    expect(() => capturePushTree('p', {WS_PUSH_REFS: refs}, root)).toThrow(/requires a clean checked tree/u);
    expect(gate(root)).toBe(false);

    expect(pushedCommit(root, refs)).toBe(head);
    expect(copyReason(root, head, {})).toMatch(/canonical checkout/u);
    const lines = /** @type {string[]} */ ([]);
    const copy = makeGateCopy(root, head, {say: (line) => lines.push(line)});
    expect(copy.path.startsWith(join(root, GATE_DIR))).toBe(true);
    expect(lines.join('\n')).toMatch(/push-gate copy \(EV1\)/u);
    // The copy is the commit: lane B's file, the committed shared.mjs, no scratch.mjs, and the build state.
    expect(readFileSync(join(copy.path, 'b.mjs'), 'utf8')).toBe('export const b = 2;\n');
    expect(readFileSync(join(copy.path, 'shared.mjs'), 'utf8')).toBe('export const shared = 1;\n');
    expect(existsSync(join(copy.path, 'scratch.mjs'))).toBe(false);
    expect(readFileSync(join(copy.path, 'node_modules/dep/index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(capturePushTree('p', {WS_PUSH_REFS: refs}, copy.path)?.commit).toBe(head);
    expect(gate(copy.path)).toBe(true);
    copy.remove();
    expect(existsSync(copy.path)).toBe(false);
    expect(git(root, ['worktree', 'list', '--porcelain'])).not.toContain(copy.path);
    // Lane A's files are untouched.
    expect(readFileSync(join(root, 'shared.mjs'), 'utf8')).toBe(brokenEdit);
    expect(readFileSync(join(root, 'scratch.mjs'), 'utf8')).toBe(brokenNew);
    expect(git(root, ['status', '--porcelain'])).toBe(' M shared.mjs\n?? scratch.mjs'.trim());

    // A killed gate's copy (its pid gone) is swept by the next gate; a live one stays.
    const dead = join(root, GATE_DIR, `${head.slice(0, 12)}-999999`);
    git(root, ['worktree', 'add', '-q', '--detach', dead, head]);
    const live = makeGateCopy(root, head, {say: () => {}});
    expect(existsSync(dead)).toBe(false);
    expect(sweepDeadCopies(root)).toBe(0);
    expect(existsSync(live.path)).toBe(true);
    live.remove();

    // A type-broken pushed commit is still red in its copy.
    writeFileSync(join(root, 'c.mjs'), 'export const c = ;\n');
    git(root, ['add', 'c.mjs']);
    git(root, ['commit', '-q', '-m', 'broken', '--', 'c.mjs']);
    const broken = git(root, ['rev-parse', 'HEAD']);
    const red = makeGateCopy(root, broken, {say: () => {}});
    expect(gate(red.path)).toBe(false);
    red.remove();
  });

  test('a clean plan worktree gates in place; dirt, a pushed non-HEAD tree or the switch decide', () => {
    const root = canonical();
    const base = git(root, ['rev-parse', 'HEAD']);
    git(root, ['worktree', 'add', '-q', '-b', 'plan/p', '.worktrees/p', 'main']);
    const tree = join(root, '.worktrees/p');
    expect(copyReason(tree, base, {})).toBeNull();
    expect(copyReason(tree, base, {}, false)).toBeNull();
    expect(copyReason(root, base, {}, false)).toBeNull();
    expect(copyReason(root, base, {CI: 'true'})).toBeNull();
    expect(copyReason(tree, null, {})).toBeNull();
    writeFileSync(join(tree, 'stray.txt'), 'x\n');
    expect(copyReason(tree, base, {})).toMatch(/1 uncommitted path/u);
    rmSync(join(tree, 'stray.txt'));
    writeFileSync(join(tree, 'n.mjs'), 'export {};\n');
    git(tree, ['add', 'n.mjs']);
    git(tree, ['commit', '-q', '-m', 'n', '--', 'n.mjs']);
    expect(copyReason(tree, base, {})).toMatch(/not the checked-out tree/u);
    // Refs: delete-only is no commit; two trees in one push keep the refusal.
    const next = git(tree, ['rev-parse', 'HEAD']);
    expect(pushedCommit(root, `(delete) ${zero} refs/heads/plan/p ${base}`)).toBeNull();
    expect(() => pushedCommit(root, `refs/heads/main ${base} refs/heads/main ${zero}\nrefs/heads/plan/p ${next} refs/heads/plan/p ${zero}`)).toThrow(/different trees/u);
  });

  test('WL11: lane B commits by pathspec, pulls and pushes green past lane A\'s edits, which stay byte-identical', () => {
    const work = canonical();
    const origin = join(work, 'origin.git'), root = join(work, 'canonical'), other = join(work, 'other');
    git(work, ['clone', '-q', '--bare', work, origin]);
    git(work, ['clone', '-q', origin, root]);
    git(work, ['clone', '-q', origin, other]);
    // main-pull's replay writes commits with the checkout's own identity (hosted CI has no global one).
    for (const clone of [root, other]) { git(clone, ['config', 'user.name', 'T']); git(clone, ['config', 'user.email', 't@example.com']); }
    // Another machine's lane moves origin/main meanwhile.
    writeFileSync(join(other, 'theirs.mjs'), 'export const theirs = 1;\n');
    git(other, ['add', 'theirs.mjs']);
    git(other, ['commit', '-q', '-m', 'theirs', '--', 'theirs.mjs']);
    git(other, ['push', '-q', 'origin', 'main']);
    // Lane A, in the canonical checkout: a tracked edit, an untracked file and a staged new file, none committed.
    writeFileSync(join(root, 'shared.mjs'), 'export const shared = ;\n');
    writeFileSync(join(root, 'scratch.mjs'), 'export const = 2;\n');
    writeFileSync(join(root, 'staged.mjs'), 'export const staged = 3;\n');
    git(root, ['add', 'staged.mjs']);
    const before = git(root, ['status', '--porcelain', '--untracked-files=all']);
    // Lane B: one file by pathspec, then the mode-1 pull (git pull --rebase refuses here) and the gate.
    writeFileSync(join(root, 'b.mjs'), 'export const b = 2;\n');
    git(root, ['add', 'b.mjs']);
    git(root, ['commit', '-q', '-m', 'lane B', '--', 'b.mjs']);
    expect(spawnSync('git', ['pull', '--rebase', '-q', 'origin', 'main'], {cwd: root, env: ENV, encoding: 'utf8'}).status).not.toBe(0);
    expect(mainPull(root)).toMatch(/rebased 1 local commit/u);
    const head = git(root, ['rev-parse', 'HEAD']);
    expect(git(root, ['rev-parse', 'HEAD~1'])).toBe(git(root, ['rev-parse', 'origin/main']));
    const copy = makeGateCopy(root, head, {say: () => {}});
    expect(gate(copy.path)).toBe(true);
    expect(existsSync(join(copy.path, 'theirs.mjs'))).toBe(true);
    copy.remove();
    git(root, ['push', '-q', 'origin', 'main']);
    expect(git(origin, ['rev-parse', 'main'])).toBe(head);
    // Lane A's three files, byte for byte, and its staged file still staged.
    expect(readFileSync(join(root, 'shared.mjs'), 'utf8')).toBe('export const shared = ;\n');
    expect(readFileSync(join(root, 'scratch.mjs'), 'utf8')).toBe('export const = 2;\n');
    expect(git(root, ['status', '--porcelain', '--untracked-files=all'])).toBe(before);
    expect(mainPull(root)).toMatch(/main current/u);

    // Main changes a file lane A has dirty: nothing moves, and the stop names it.
    git(other, ['pull', '-q', '--rebase', 'origin', 'main']);
    writeFileSync(join(other, 'shared.mjs'), 'export const shared = 9;\n');
    git(other, ['commit', '-q', '-m', 'shared', '--', 'shared.mjs']);
    git(other, ['push', '-q', 'origin', 'main']);
    expect(() => mainPull(root)).toThrow(/shared\.mjs/u);
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(readFileSync(join(root, 'shared.mjs'), 'utf8')).toBe('export const shared = ;\n');
  });
});
