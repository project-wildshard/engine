// MEMORY-STRUCTURE STR4 (J414): the dev control channel is in the local dev server's bundle (`build-server.mjs --dev`) and
// absent from the box's (no `--dev`), which `build-server.mjs --tar` packs.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  for (const marker of ['/__dev/control', 'that device has no seat on this worker', 'not a dev control']) {
    expect(box.includes(marker), marker).toBe(false);
    expect(dev.includes(marker), marker).toBe(true);
  }
}, 120_000);

test('a dev bundle is never packed for a box', () => {
  const run = spawnSync(process.execPath, ['scripts/build-server.mjs', '--dev', '--out', join(scratch, 'packed'), '--tar', join(scratch, 'packed.tgz')], { encoding: 'utf8' });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('never packed for a box');
});
