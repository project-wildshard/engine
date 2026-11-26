// Meta QA 11-25 row 136 (J505): a load harness takes cpu-load.lock (one at a time), caps burners at nproc/2 and 60 s in
// code, and refuses when load15 is already over nproc (src/scripts/cpu-load.mjs). Every window here is one burner for
// at most a second, or none.
import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {CPU_LOAD_LOCK, MAX_SECONDS, REFUSED, burnerProgram, holdCpuLoad, loadWindow, maxBurners, runLoad} from '../scripts/cpu-load.mjs';

const base = resolve('tmp/cpu-load-test');
mkdirSync(base, {recursive: true});
const root = mkdtempSync(join(base, 'run-'));
afterAll(() => { rmSync(root, {recursive: true, force: true}); });
const canLock = spawnSync('/bin/sh', ['-c', 'test -x /usr/bin/lockf || command -v flock']).status === 0;

test('burners are cut to nproc/2 and the window to 60 s, and the cut is said', () => {
  expect(maxBurners(18)).toBe(9);
  expect(maxBurners(1)).toBe(1);
  expect(loadWindow({burners: 60, seconds: 150}, {nproc: 18, load15: 2})).toEqual({burners: 9, seconds: MAX_SECONDS, kind: 'spin',
    capped: ['burners 60 cut to 9 (nproc 18 / 2)', 'seconds 150 cut to 60']});
  expect(loadWindow({}, {nproc: 18, load15: 2})).toEqual({burners: 9, seconds: 60, kind: 'spin', capped: []});
  expect(loadWindow({burners: 4, seconds: 30, kind: 'exec'}, {nproc: 18, load15: 2})).toEqual({burners: 4, seconds: 30, kind: 'exec', capped: []});
  expect(loadWindow({kind: 'perl'}, {nproc: 18, load15: 2})).toHaveProperty('refused');
});

test('a machine whose load15 is already over nproc is refused before any lock or burner', async () => {
  expect(loadWindow({burners: 1}, {nproc: 18, load15: 18})).not.toHaveProperty('refused');
  expect(loadWindow({burners: 1}, {nproc: 18, load15: 18.5})).toEqual({refused: 'load15 18.5 is already over nproc 18; the machine needs no more load'});
  const locks = join(root, 'loaded'), lines = [];
  expect(await runLoad({burners: 1, seconds: 1}, {nproc: 18, load15: 40, root: locks, scratchRoot: join(root, 'scratch'), log: line => lines.push(line)})).toBe(REFUSED);
  expect(lines).toEqual(['cpu-load REFUSED load15 40.0 is already over nproc 18; the machine needs no more load']);
  expect(() => readdirSync(locks)).toThrow();
});

test.skipIf(!canLock)('one load harness at a time: a held cpu-load.lock refuses the next at once', async () => {
  const locks = join(root, 'lock'), lines = [];
  const release = await holdCpuLoad(locks);
  expect(release).not.toBeNull();
  try {
    expect(await holdCpuLoad(locks)).toBeNull();
    const began = Date.now();
    expect(await runLoad({burners: 1, seconds: 1}, {nproc: 4, load15: 0, root: locks, scratchRoot: join(root, 'scratch'), log: line => lines.push(line)})).toBe(REFUSED);
    expect(Date.now() - began).toBeLessThan(5000);
    expect(lines).toEqual([`cpu-load REFUSED another load harness holds ${join(locks, CPU_LOAD_LOCK)}; one at a time`]);
  } finally { release?.(); }
  let again = null;
  for (let tries = 0; tries < 50 && again === null; tries++) {
    again = await holdCpuLoad(locks);
    if (again === null) await new Promise(done => { setTimeout(done, 100); });
  }
  expect(again).not.toBeNull();
  again?.();
});

test.skipIf(!canLock)('burners stop the moment the command ends, and the scratch goes with them', async () => {
  const scratchRoot = join(root, 'window'), lines = [];
  const began = Date.now();
  const code = await runLoad({burners: 1, seconds: 30, command: [process.execPath, '-e', 'process.exit(3)']},
    {nproc: 2, load15: 0, root: join(root, 'window-lock'), scratchRoot, log: line => lines.push(line)});
  expect(code).toBe(3);
  expect(Date.now() - began).toBeLessThan(10_000);
  expect(lines).toEqual(['cpu-load window 1 spin burner(s) for 30 s (nproc 2, load15 0.0)']);
  expect(readdirSync(scratchRoot)).toEqual([]);
});

test('each burner carries its own end time, so a killed harness leaves nothing past the window', async () => {
  const burner = spawn(process.execPath, ['-e', burnerProgram('spin', Date.now() + 200, root)], {stdio: 'ignore'});
  const began = Date.now();
  const [code] = await new Promise(done => { burner.once('exit', (...args) => { done(args); }); });
  expect(code).toBe(0);
  expect(Date.now() - began).toBeLessThan(10_000);
});
