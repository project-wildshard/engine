// MEMORY-STRUCTURE STR4 (J414): the dev control channel is in the local dev server's bundle (`build-server.mjs --dev`) and
// absent from the box's (no `--dev`), which `build-server.mjs --tar` packs.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { BOOT_STAMPS, ensureBootStamps } from '../src/scripts/boot-stamps.mjs';

const scratch = mkdtempSync(join(process.cwd(), 'tmp', 'dev-control-bundle-'));
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

/** Both entries' text, built into `scratch/<name>`. */
function built(name: string, dev: boolean): string {
  const out = join(scratch, name);
  const run = spawnSync(process.execPath, ['src/scripts/build-server.mjs', '--out', out, ...dev ? ['--dev'] : []], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return readFileSync(join(out, 'main.mjs'), 'utf8') + readFileSync(join(out, 'cellWorker.mjs'), 'utf8');
}

test('the box bundle has no dev control channel; the dev bundle has it', () => {
  const box = built('box', false), dev = built('dev', true);
  for (const marker of ['/__dev/control', 'that device has no seat on this worker', 'not a dev control', 'WILDSHARD_DEV_PRODUCT']) {
    expect(box.includes(marker), marker).toBe(false);
    expect(dev.includes(marker), marker).toBe(true);
  }
}, 120_000);

test('the npm artifact carries the native dev server and frozen format', () => {
  const staged = join(scratch, 'package');
  mkdirSync(staged, { recursive: true });
  cpSync('package.json', join(staged, 'package.json'));
  // LS1: the ignored boot stamps ride the archive; npm-artifact refuses one without them.
  ensureBootStamps();
  for (const stamp of BOOT_STAMPS) { mkdirSync(dirname(join(staged, stamp)), { recursive: true }); cpSync(stamp, join(staged, stamp)); }
  if (existsSync('patches')) cpSync('patches', join(staged, 'patches'), { recursive: true });
  const installedFormat = realpathSync('node_modules/@wildshard/format');
  // npm-artifact bundles the format with its own dependencies, read from its manifest (0.71.0 adds @valibot/to-json-schema).
  const formatDependencies: Record<string, string> = JSON.parse(readFileSync(join(installedFormat, 'package.json'), 'utf8')).dependencies ?? {};
  for (const name of ['@wildshard/format', ...Object.keys(formatDependencies)]) {
    const link = join(staged, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(realpathSync(join('node_modules', name)), link, 'dir');
  }
  const output = join(staged, 'dist/dev-server');
  const build = spawnSync(process.execPath, ['src/scripts/build-server.mjs', '--dev', '--out', output], { encoding: 'utf8' });
  expect(build.status, build.stderr).toBe(0);
  const pack = spawnSync(process.execPath, [resolve('src/scripts/npm-artifact.mjs'), join(scratch, 'archives')], { cwd: staged, encoding: 'utf8' });
  expect(pack.status, pack.stderr).toBe(0);
  const archive = JSON.parse(pack.stdout) as { filename: string; files: { path: string }[] };
  const files = archive.files.map(row => row.path);
  for (const stamp of BOOT_STAMPS) expect(files).toContain(stamp);
  for (const file of ['main.mjs', 'cellWorker.mjs', 'rapier.wasm', 'bundle.json', 'migrations/0001-saves.sql']) {
    expect(files).toContain(`dist/dev-server/${file}`);
  }
  const module = 'src/format/creature-skeletons.ts';
  const extracted = join(scratch, 'extracted');
  mkdirSync(extracted);
  const unpack = spawnSync('tar', ['-xzf', archive.filename, '-C', extracted], { encoding: 'utf8' });
  expect(unpack.status, unpack.stderr).toBe(0);
  const content = readFileSync(join(extracted, 'package/node_modules/@wildshard/format', module));
  expect(content.equals(readFileSync(join(installedFormat, module)))).toBe(true);
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version: string; pnpm: { patchedDependencies?: Record<string, string> };
  };
  for (const patch of Object.values(manifest.pnpm.patchedDependencies ?? {})) {
    expect(readFileSync(join(extracted, 'package', patch)).equals(readFileSync(patch))).toBe(true);
  }
  const nextBuild = '0123456789abcdef0123456789abcdef01234567';
  const next = spawnSync(process.execPath, [resolve('src/scripts/npm-artifact.mjs'), join(scratch, 'next'), nextBuild],
    { cwd: staged, encoding: 'utf8' });
  expect(next.status, next.stderr).toBe(0);
  const nextArchive = JSON.parse(next.stdout) as { filename: string };
  const nextManifest = spawnSync('tar', ['-xOzf', nextArchive.filename, 'package/package.json'], { encoding: 'utf8' });
  expect(nextManifest.status, nextManifest.stderr).toBe(0);
  expect(JSON.parse(nextManifest.stdout)).toMatchObject({
    version: `${manifest.version}-next.0123456789a`, gitHead: nextBuild,
  });
  expect(readFileSync(join(staged, 'package.json'), 'utf8')).toBe(readFileSync('package.json', 'utf8'));
}, 30_000);

test('a dev bundle is never packed for a box', () => {
  const run = spawnSync(process.execPath, ['src/scripts/build-server.mjs', '--dev', '--out', join(scratch, 'packed'), '--tar', join(scratch, 'packed.tgz')], { encoding: 'utf8' });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('never packed for a box');
});
