// oxlint-disable-next-line import/no-nodejs-modules -- Fixture payloads are exact bytes.
import { Buffer } from 'node:buffer';
// oxlint-disable-next-line import/no-nodejs-modules -- Commits into owned throwaway Git repositories.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every write is confined to an owned fixture under ./tmp.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures run Git without the caller's index or hooks.
import { env as processEnv } from 'node:process';
import { afterEach, expect, it } from 'vitest';
import { createChecker, isCounted, type Checker } from '../scripts/repo-size.mjs';

interface Pin { path: string; oid: string; bytes: number; kind: string; purpose: string }
interface Fixture {
  cwd: string;
  env: NodeJS.ProcessEnv;
  git: (...args: string[]) => string;
  write: (path: string, data: string | Buffer) => void;
  stage: (path: string, data: string | Buffer) => string;
  policy: (changes?: Record<string, unknown>) => void;
  commit: (message?: string) => string;
  checker: (extra?: NodeJS.ProcessEnv) => Checker;
  push: (tip: string, base?: string, rangeOnly?: boolean) => ReturnType<Checker['checkPush']>;
}

const owned: string[] = [];
afterEach(() => { for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const defaults = { schemaVersion: 1, maxBlobBytes: 1_000_000, maxPreviewBytes: 250_000, maxBoardBytes: 500_000,
  maxPushBytes: 10_000_000, maxWeeklyBytes: 50_000_000, pins: [] as Pin[] };

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const [key, value] of Object.entries(processEnv)) if (!key.startsWith('GIT_')) env[key] = value;
  return env;
}

function fixture(dir?: string): Fixture {
  const scratch = resolve('tmp');
  mkdirSync(scratch, { recursive: true });
  const cwd = dir ?? mkdtempSync(join(scratch, 'repo-size-test-'));
  if (dir === undefined) owned.push(cwd);
  const env = cleanEnv();
  const git = (...args: string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (path: string, data: string | Buffer): void => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), data);
  };
  const stage = (path: string, data: string | Buffer): string => {
    write(path, data);
    git('add', '-f', path);
    return git('rev-parse', `:${path}`);
  };
  let config: Record<string, unknown> = structuredClone(defaults);
  const policy = (changes: Record<string, unknown> = {}): void => {
    config = { ...config, ...changes };
    stage('scripts/storage-policy.json', JSON.stringify(config));
  };
  if (dir === undefined) {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Storage test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'core.hooksPath', '/dev/null');
    git('config', 'commit.gpgsign', 'false');
    policy();
  }
  const commit = (message = 'fixture'): string => { git('commit', '-q', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD'); };
  const checker = (extra: NodeJS.ProcessEnv = {}): Checker => createChecker({ cwd, env: { ...env, ...extra } });
  const push = (tip: string, base = '0'.repeat(40), rangeOnly = false): ReturnType<Checker['checkPush']> =>
    checker().checkPush(`refs/heads/main ${tip} refs/heads/main ${base}\n`, { rangeOnly });
  return { cwd, env, git, write, stage, policy, commit, checker, push };
}

const binary = (bytes: number, seed = 1): Buffer => Buffer.alloc(bytes, seed);

it('checks the private index, not the shared one or the working tree', () => {
  const f = fixture();
  f.commit();
  const index = join(f.cwd, '.git', 'private-index');
  const own = { ...f.env, GIT_INDEX_FILE: index };
  execFileSync('git', ['read-tree', 'HEAD'], { cwd: f.cwd, env: own });
  f.write('art/raw.bin', binary(1_000_001));
  execFileSync('git', ['add', 'art/raw.bin'], { cwd: f.cwd, env: own });
  f.write('art/raw.bin', 'small unstaged repair');
  expect(() => f.checker({ GIT_INDEX_FILE: index }).checkIndex()).toThrow(/art\/raw\.bin: 1\.00 MB is over the 1\.00 MB blob cap/u);
  expect(f.checker().checkIndex().changed).toBe(0);
});

it('JSON gets its own blob cap; other files keep the plain one', () => {
  const f = fixture();
  f.policy({ maxJsonBlobBytes: 5_000_000 });
  f.commit();
  f.stage('src/shards/pine-hollow/data/rows.json', `[${'0,'.repeat(1_000_000)}0]`);
  expect(f.checker().checkIndex().changed).toBeGreaterThan(0);
  f.stage('art/raw.bin', binary(1_000_001));
  expect(() => f.checker().checkIndex()).toThrow(/art\/raw\.bin: 1\.00 MB is over the 1\.00 MB blob cap/u);
});

it('refuses generated paths, media outside public/, the removed progress guards and disguised binaries', () => {
  const f = fixture();
  f.commit();
  const cases: [string, string | Buffer, RegExp][] = [
    ['dist/app.js', 'x', /generated/u], ['scripts/dist-native/a.js', 'x', /generated/u], ['tmp/run/log.txt', 'x', /generated/u],
    ['node_modules/pkg/index.js', 'x', /generated/u], ['.claude/worktrees/lane/a.ts', 'x', /generated/u],
    ['media-cache/art/a.jpg', 'x', /generated/u], ['progress/run/boot-smoke-results/a.json', '{}', /generated/u],
    ['art/clip.mp4', 'x', /forbidden outside public/u], ['docs/guide.pdf', 'x', /PDFs stay out/u],
    ['sources/model.blend', 'x', /\.blend is never committed/u], ['progress/soak/raw.jsonl', '{}', /raw soak/u],
    ['progress/soak/raw.json.gz', 'x', /raw soak/u], ['progress/soak/raw.br', 'x', /raw soak/u],
    ['progress/heap/x.heap.json', '{}', /raw soak/u],
    ['progress/shot.png', binary(500_001), /500 KB is over the 250 KB preview image cap/u],
    ['docs/data.json', Buffer.from('7b0000', 'hex'), /binary content behind a text name/u],
    ['scripts/archive.bin', Buffer.from('504b030400000000', 'hex'), /archive/u],
    ['art/clip.jpg', Buffer.from('000000186674797069736f6d', 'hex'), /media signature/u],
  ];
  for (const [path, data, reason] of cases) {
    f.stage(path, data);
    expect(() => f.checker().checkIndex(), path).toThrow(reason);
    f.git('rm', '-q', '--cached', '-f', path);
  }
  for (const path of ['public/audio/theme.ogg', 'public/video/intro.mp4', 'src/shards/demo/assets/abc']) f.stage(path, 'OggS runtime');
  f.stage('art/round-1/pick-board.jpg', binary(400_000));
  f.stage('art/hero.avif', Buffer.from('0000001c6674797061766966', 'hex'));
  expect(f.checker().checkIndex().changed).toBe(5);
});

it('a large runtime file needs an exact pin, and a changed blob needs its pin reviewed', () => {
  const f = fixture();
  f.commit();
  const oid = f.stage('public/assets/terrain.ktx2', binary(1_200_000));
  expect(() => f.checker().checkIndex()).toThrow(/needs an exact pin.*"kind": "runtime"/u);
  f.policy({ pins: [{ path: 'public/assets/terrain.ktx2', oid, bytes: 1_200_000, kind: 'runtime', purpose: 'Shipped terrain' }] });
  expect(f.checker().checkIndex().commitBytes).toBe(0);
  f.commit();
  f.stage('public/assets/terrain.ktx2', binary(900_000, 2));
  expect(() => f.checker().checkIndex()).toThrow(/its pin names blob/u);
  f.policy({ pins: [{ path: 'art/a.png', oid, bytes: 1, kind: 'runtime', purpose: 'Not shipped' }] });
  expect(() => f.checker().checkIndex()).toThrow(/runtime pin must be under/u);
});

it('counts binary bytes outside the runtime roots once per blob; text and shipped files are not counted', () => {
  expect([isCounted('art/a.jpg'), isCounted('src/a.ts'), isCounted('public/a.png'), isCounted('.githooks/pre-push')]).toEqual([true, false, false, false]);
  const f = fixture();
  f.policy({ maxPushBytes: 1500 });
  f.commit();
  f.stage('art/one.bin', binary(800));
  f.stage('art/copy.bin', binary(800));
  f.stage('src/big.ts', 'x'.repeat(5000));
  f.stage('public/big.bin', binary(5000));
  expect(f.checker().checkIndex().commitBytes).toBe(800);
  f.commit();
  f.stage('art/two.bin', binary(800, 3));
  expect(() => f.checker().checkIndex()).toThrow(/waiting to push would be 0\.00 MB.*per-push budget/su);
});

it('pre-push checks every outgoing commit, including a payload added and then deleted', () => {
  const f = fixture();
  const base = f.commit();
  f.stage('art/hidden.mp4', 'video');
  f.commit();
  f.git('rm', '-q', 'art/hidden.mp4');
  const tip = f.commit();
  expect(() => f.checker().checkTree(tip)).not.toThrow();
  expect(() => f.push(tip, base)).toThrow(/art\/hidden\.mp4: forbidden/u);
});

it('pre-push sums distinct additions across commits; the rolling week only warns', () => {
  const f = fixture();
  f.policy({ maxPushBytes: 1500, maxWeeklyBytes: 2000 });
  const root = f.commit();
  f.stage('art/one.bin', binary(900));
  const one = f.commit();
  f.stage('art/two.bin', binary(900, 2));
  const two = f.commit();
  expect(() => f.push(two, root)).toThrow(/outgoing binary bytes .* per-push budget/u);
  expect(f.push(two, one).pushBytes).toBe(900);
  f.stage('art/three.bin', binary(900, 3));
  const three = f.commit();
  expect(f.push(three, two)).toMatchObject({ weekOver: true });
  expect(f.push(three, two, true).weekBytes).toBeNull();
  const later = createChecker({ cwd: f.cwd, env: f.env, now: () => Date.now() + 8 * 24 * 3_600_000 });
  expect(later.checkPush(`refs/heads/main ${three} refs/heads/main ${two}\n`).weekBytes).toBe(0);
});

it('legacy debt stays only unchanged; strict mode and a re-add after deletion are refused', () => {
  const f = fixture();
  f.stage('progress/old.mp4', 'old media');
  f.stage('progress/big.png', binary(600_000));
  const debt = f.commit();
  f.policy({ migrationBase: debt });
  f.commit();
  expect(f.checker().checkTree('HEAD')).toMatchObject({ legacyFiles: 2, migrationBase: debt });
  expect(() => f.checker().checkTree('HEAD', { strict: true })).toThrow(/big\.png: 600 KB[\s\S]*old\.mp4: forbidden/u);
  f.stage('progress/notes.md', 'small change');
  expect(f.checker().checkIndex().changed).toBe(1);
  f.git('rm', '-q', 'progress/old.mp4');
  const deleted = f.commit();
  f.stage('progress/old.mp4', 'old media');
  expect(() => f.checker().checkIndex()).toThrow(/old\.mp4: forbidden/u);
  const back = f.commit();
  expect(() => f.push(back, deleted)).toThrow(/old\.mp4: forbidden/u);
  expect(f.push(deleted, debt).commits).toBe(2);
});

it('symlinks may not leave the tree or point into generated storage', () => {
  const f = fixture();
  f.commit();
  for (const target of ['../../secret', '/etc/passwd', 'tmp/run', 'node_modules/pkg']) {
    symlinkSync(target, join(f.cwd, 'shortcut'));
    f.git('add', 'shortcut');
    expect(() => f.checker().checkIndex(), target).toThrow(/symlink to/u);
    f.git('rm', '-q', '--cached', 'shortcut');
    rmSync(join(f.cwd, 'shortcut'));
  }
});

it('a blobless clone (CI) checks the pushed range with one batched blob fetch', () => {
  const f = fixture();
  f.git('config', 'uploadpack.allowFilter', 'true');
  f.git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  const base = f.commit();
  f.stage('art/ok.bin', binary(2000));
  f.stage('art/bad.zip', 'x');
  const bad = f.commit();
  f.git('rm', '-q', 'art/bad.zip');
  const good = f.commit();
  const clone = join(dirname(f.cwd), `${f.cwd.split('/').at(-1) ?? 'x'}-clone`);
  owned.push(clone);
  execFileSync('git', ['clone', '-q', '--no-local', '--filter=blob:none', '--no-checkout', `file://${f.cwd}`, clone], { env: f.env, stdio: 'ignore' });
  const ci = createChecker({ cwd: clone, env: f.env });
  const record = (tip: string, from: string): string => `refs/heads/main ${tip} refs/heads/main ${from}\n`;
  expect(ci.checkPush(record(base, base), { rangeOnly: true }).commits).toBe(0);
  expect(() => ci.checkPush(record(good, base), { rangeOnly: true })).toThrow(new RegExp(`${bad.slice(0, 10)} art/bad\\.zip`, 'u'));
});
