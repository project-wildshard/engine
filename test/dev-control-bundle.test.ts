// MEMORY-STRUCTURE STR4 (J414): the dev control channel is in the local dev server's bundle (`build-server.mjs --dev`) and
// absent from the box's (no `--dev`), which `build-server.mjs --tar` packs.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

const scratch = mkdtempSync(join(process.cwd(), 'tmp', 'dev-control-bundle-'));
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

/** Both entries' text, built into `scratch/<name>`. */
function built(name: string, dev: boolean): string {
  const out = join(scratch, name);
  const run = spawnSync(process.execPath, ['scripts/build-server.mjs', '--out', out, ...dev ? ['--dev'] : []], { encoding: 'utf8' });
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
  const installedFormat = realpathSync('node_modules/@wildshard/format');
  cpSync(installedFormat, join(staged, 'node_modules/@wildshard/format'), { recursive: true });
  const output = join(staged, 'dist/dev-server');
  const build = spawnSync(process.execPath, ['scripts/build-server.mjs', '--dev', '--out', output], { encoding: 'utf8' });
  expect(build.status, build.stderr).toBe(0);
  const pack = spawnSync('npm', ['pack', '--ignore-scripts', '--json'], { cwd: staged, encoding: 'utf8' });
  expect(pack.status, pack.stderr).toBe(0);
  const [archive] = JSON.parse(pack.stdout) as [{ filename: string; files: { path: string }[] }];
  const files = archive.files.map(row => row.path);
  for (const file of ['main.mjs', 'cellWorker.mjs', 'rapier.wasm', 'bundle.json', 'migrations/0001-saves.sql']) {
    expect(files).toContain(`dist/dev-server/${file}`);
  }
  const module = 'src/format/creature-skeletons.ts';
  const content = spawnSync('tar', ['-xOf', join(staged, archive.filename), `package/node_modules/@wildshard/format/${module}`]);
  expect(content.status, content.stderr.toString()).toBe(0);
  expect(content.stdout.equals(readFileSync(join(installedFormat, module)))).toBe(true);
}, 30_000);

test('a dev bundle is never packed for a box', () => {
  const run = spawnSync(process.execPath, ['scripts/build-server.mjs', '--dev', '--out', join(scratch, 'packed'), '--tar', join(scratch, 'packed.tgz')], { encoding: 'utf8' });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('never packed for a box');
});
