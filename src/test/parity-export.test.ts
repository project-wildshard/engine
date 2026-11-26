// oxlint-disable-next-line import/no-nodejs-modules -- Make real committed source snapshots for git archive.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and clean the two cache/export fixtures under repo scratch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the products in the isolated export.
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { cachedTree, exportTree } from '../scripts/parity/serve.mjs';
import { shardFolders } from '../scripts/shard-folders.mjs';

const owned: string[] = [];
afterEach(() => { for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const scratch = resolve('tmp', process.env['WS_LANE_NAME'] ?? 'parity-export');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'archive-'));
  owned.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const put = (file: string, body: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), body);
  };
  git('init', '-q');
  put('.gitignore', '/out/\n');
  put('docs/ignored.md', 'excluded by the parity export');
  put('test/parity/fixture.json', '{}');
  put('public/engine.ktx2', 'captured engine asset');
  put('src/scripts/pins.ts', `
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    if (process.argv[2] !== 'install') throw new Error('expected pins install');
    execFileSync('git', ['ls-files', '--error-unmatch', 'public/engine.ktx2']);
    execFileSync('git', ['ls-tree', 'HEAD', 'public/engine.ktx2']);
    const { folder } = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8'));
    const out = 'out/' + folder;
    mkdirSync(out, { recursive: true });
    writeFileSync(out + '/shard.json', '{}');
  `);
  const pins = 'test/pins/shardfiles.json';
  const capture = (folder: string) => {
    put(pins, JSON.stringify({ folder }));
    const paths = ['.gitignore', 'docs/ignored.md', 'test/parity/fixture.json', 'public/engine.ktx2', 'src/scripts/pins.ts', pins];
    git('add', '--', ...paths);
    git('-c', 'user.name=Parity fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', folder, '--', ...paths);
    return git('rev-parse', 'HEAD');
  };
  return { repo, cache: join(dir, 'cache'), capture, put };
}

test('a raw parity export installs the archived pins before enumerating shards', () => {
  const { repo, capture, put } = fixture();
  const sha = capture('captured-zone');
  capture('later-zone');
  put('out/live-zone/shard.json', '{}');

  const exported = exportTree(repo, sha);
  try {
    expect(shardFolders(exported.tree)).toEqual(['captured-zone']);
    expect(shardFolders(repo)).toEqual(['live-zone']);
  } finally { exported.cleanup(); }
});

test('changing only the pins gives parity a different cached build', async () => {
  const { repo, cache, capture } = fixture();
  const a = capture('first-zone'), b = capture('second-zone');
  const build = (tree: string) => {
    mkdirSync(join(tree, 'dist'));
    writeFileSync(join(tree, 'dist', 'version.json'), '{}');
  };
  const first = await cachedTree(repo, a, cache, build);
  try {
    const second = await cachedTree(repo, b, cache, build);
    try {
      expect(second.key).not.toBe(first.key);
      expect(second.hit).toBe(false);
      expect(shardFolders(first.tree)).toEqual(['first-zone']);
      expect(shardFolders(second.tree)).toEqual(['second-zone']);
    } finally { second.cleanup(); }
  } finally { first.cleanup(); }
});
