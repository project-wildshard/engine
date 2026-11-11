// opus-pinignore (2026-11-11): `pins.ts install` publishes every pinned shardfile's mounts under public/, and only the
// canonical checkout's info/exclude lists them (scripts/pins-exclude.mjs). A worktree made after a re-pin held Nalati's
// new astc6/ variants untracked, and `worktree.mjs reap` kept it, since `git worktree remove` refuses untracked files.
// So .gitignore itself names the pin-only folders. Only .gitignore is read here: a scratch repo holds a copy of it, so
// neither this checkout's info/exclude nor a global excludes file can make the test pass.
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const ENV = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};

/** One published path per pin-output folder, as `pins.ts install` wrote them on 2026-11-11. */
const PUBLISHED = [
  // The paths that kept go7-one-way-in, mmo-keep and ms7-rooms from the reaper.
  'public/assets/nalati/astc6/nalati/cards.phone-b3a5391d.ktx2',
  'public/assets/nalati/astc6/nalati/models/coats/wolf.wolf.alpha.coat.phone-9269659a.ktx2',
  'public/assets/pine-hollow/astc6/models/hatchet/hatchet.phone-ed7f8d2f.gltf',
  // A shard pinned later gets its astc6/ variants under its own folder.
  'public/assets/a-new-shard/astc6/a-new-shard/tex/grass.phone-00000000.ktx2',
  'public/programs/nalati-grasslands.json',
  'public/assets/far-reach/baked/crown.glb',
  'public/assets/horizon/pine-hollow-day.webp',
  'public/assets/lut/far-reach.bin',
  'public/assets/nine-dragon/paint/concrete.jpg',
  'public/assets/baked/pine-hollow/tex/clouds.jpg',
  'public/assets/gpu/horizon/driftwood-isle-day-2ca8c3a2.ktx2',
  'public/assets/gpu/tex/bark_willow_02/arm-4ed13222.ktx2',
  'public/assets/gpu/models/hatchet/hatchet.desktop-5b7c5ee5.gltf',
  'public/assets/models/pine-hollow-hero/beaver-dam-lod1/beaver-dam-lod1.glb',
  'public/assets/music/nalati/music.json',
  'public/assets/sfx/nalati-grasslands/arrowImpact-flesh-2-bb61e810.m4a',
];

let scratch = '';
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pins-ignore-'));
  const init = spawnSync('git', ['init', '-q'], {cwd: scratch, env: ENV, encoding: 'utf8'});
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
  copyFileSync(join(ROOT, '.gitignore'), join(scratch, '.gitignore'));
});
afterAll(() => { if (scratch !== '') rmSync(scratch, {recursive: true, force: true}); });

/** The paths engine's .gitignore alone ignores. @param {readonly string[]} paths @returns {string[]} */
function ignored(paths) {
  const result = spawnSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--stdin', '-z'], {cwd: scratch, env: ENV, input: paths.join('\0'), encoding: 'utf8', maxBuffer: 64 << 20});
  // 0: some matched, 1: none matched, anything else is an error.
  if (result.status !== 0 && result.status !== 1) throw new Error(`git check-ignore: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

describe('pins outputs and .gitignore', () => {
  test('every pin-output folder is ignored by .gitignore, without the canonical info/exclude', () => {
    expect(PUBLISHED.filter(path => !ignored([path]).includes(path))).toEqual([]);
  });

  test('no tracked public/ file matches .gitignore, so the folders hold pin output only', () => {
    const listed = spawnSync('git', ['ls-files', '-z', 'public'], {cwd: ROOT, env: ENV, encoding: 'utf8', maxBuffer: 64 << 20});
    expect(listed.status).toBe(0);
    const tracked = listed.stdout.split('\0').filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);
    expect(ignored(tracked)).toEqual([]);
  });
});
