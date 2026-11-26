// DF7 (mini-nightkill, 2026-11-23): a night that died past its SIGTERM handler left its detached world (dev.mjs PID 61306)
// running on tmp/df7/world for four hours, beside the next night's world on the same directory. The next night stops the
// group the dead one recorded, and only when that group still names the night's world.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { stopStaleWorld } from '../scripts/fps/nightly-mini.mjs';

const dir = resolve(import.meta.dirname, '../../tmp', `fps-nightly-mini-${String(process.pid)}`);
mkdirSync(dir, { recursive: true });
const started = /** @type {number[]} */ ([]);
afterAll(() => {
  for (const pid of started) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  rmSync(dir, { recursive: true, force: true });
});

/** A detached stand-in world: a group whose leader names `arg` on its command line. @param {string} arg */
function group(arg) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'src/scripts/dev.mjs', '--work', arg], { detached: true, stdio: 'ignore' });
  child.unref();
  if (child.pid === undefined) throw new Error('no pid');
  started.push(child.pid);
  return child.pid;
}
const alive = (/** @type {number} */ pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a dead night\'s world group is stopped before the next night wipes its directory', async () => {
  const world = join(dir, 'df7/world'), file = join(dir, 'df7-world.pgid');
  const pid = group(world);
  writeFileSync(file, String(pid));
  expect(await stopStaleWorld(file, world)).toBe(true);
  expect(alive(pid)).toBe(false);
  expect(existsSync(file)).toBe(false);
});

test('a recorded pid now reused by something else is left alone', async () => {
  const file = join(dir, 'reused.pgid');
  const pid = group(join(dir, 'another-lane/world'));
  writeFileSync(file, String(pid));
  expect(await stopStaleWorld(file, join(dir, 'df7/world'))).toBe(false);
  expect(alive(pid)).toBe(true);
  expect(await stopStaleWorld(join(dir, 'none.pgid'), join(dir, 'df7/world'))).toBe(false);
});
