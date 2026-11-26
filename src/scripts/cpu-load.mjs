#!/usr/bin/env node
// The one way to load the shared Mac on purpose (meta QA 11-25 row 136, J505). Reproducing a load flake (row 134) once
// meant hand-rolled burners: 60 perl and 250 Python busy loops drove the MacBook's load average to 285 and starved the
// release train and every lane's push gate for ten minutes. This harness is the guard, in code rather than by note:
//
//   1. one load harness at a time on the machine: it holds cpu-load.lock (beside desktop-gpu.lock, locks.mjs's root)
//      and refuses at once when another harness holds it;
//   2. at most nproc/2 burners for at most 60 s; a bigger ask is cut to the cap and says so;
//   3. it refuses when the machine's 15-minute load average is already over nproc.
//
// Each burner carries its own end time, so a harness killed with SIGKILL still leaves nothing running past the window.
// With a command after `--`, the burners start, the command runs under them, and the burners stop the moment it ends.
//
//   node src/scripts/cpu-load.mjs [--burners N] [--seconds S] [--kind spin|exec] [-- command args...]
//
// Kinds: `spin` is a busy loop per burner (scheduler load). `exec` compiles a tiny C program to a fresh path and runs
// it, over and over: every new binary's first run waits on macOS's code-signing check, which is what a loaded push
// gate queues behind (row 134: a fresh binary's first exec went from 0.16 s to 1.5 s at load 40).
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {availableParallelism, loadavg} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {lockRoot} from './memory/iphone/locks.mjs';

export const CPU_LOAD_LOCK = 'cpu-load.lock';
export const MAX_SECONDS = 60;
export const KINDS = ['spin', 'exec'];
/** Exit code of a refusal (EX_TEMPFAIL): another harness holds the lock, or the machine is already loaded. */
export const REFUSED = 75;
/** Every burner and command this process started and has not reaped, for the signal handlers. */
const live = new Set();

/** At most half the cores. @param {number} nproc */
export const maxBurners = nproc => Math.max(1, Math.floor(nproc / 2));

/**
 * The window a request gets: burners and seconds cut to the caps, or a refusal when load15 is already over nproc.
 * @param {{burners?: number, seconds?: number, kind?: string}} ask
 * @param {{nproc: number, load15: number}} machine
 * @returns {{refused: string} | {burners: number, seconds: number, kind: string, capped: string[]}}
 */
export function loadWindow(ask, {nproc, load15}) {
  if (load15 > nproc) return {refused: `load15 ${load15.toFixed(1)} is already over nproc ${nproc}; the machine needs no more load`};
  const kind = ask.kind ?? 'spin';
  if (!KINDS.includes(kind)) return {refused: `unknown kind ${kind} (${KINDS.join(' or ')})`};
  const capped = [];
  let burners = ask.burners ?? maxBurners(nproc), seconds = ask.seconds ?? MAX_SECONDS;
  if (!(burners >= 1)) burners = 1;
  if (!(seconds > 0)) seconds = 1;
  burners = Math.floor(burners);
  if (burners > maxBurners(nproc)) { capped.push(`burners ${burners} cut to ${maxBurners(nproc)} (nproc ${nproc} / 2)`); burners = maxBurners(nproc); }
  if (seconds > MAX_SECONDS) { capped.push(`seconds ${seconds} cut to ${MAX_SECONDS}`); seconds = MAX_SECONDS; }
  return {burners, seconds, kind, capped};
}

/**
 * Hold cpu-load.lock without waiting. Resolves to a release function, or null when another harness holds it.
 * A `lockf -t 0` (macOS) or `flock -n` (Linux) child holds the lock while its stdin stays open, so the kernel drops it
 * the moment this process dies, however it dies.
 * @param {string} [root] @returns {Promise<(() => void) | null>}
 */
export async function holdCpuLoad(root = lockRoot()) {
  mkdirSync(root, {recursive: true});
  const file = join(root, CPU_LOAD_LOCK), holder = ['/bin/sh', '-c', 'echo held; exec cat >/dev/null'];
  const command = existsSync('/usr/bin/lockf') ? ['/usr/bin/lockf', '-t', '0', '-k', file, ...holder]
    : ['flock', '-n', file, ...holder];
  const child = spawn(command[0], command.slice(1), {stdio: ['pipe', 'pipe', 'ignore']});
  const held = await new Promise(done => {
    child.once('error', () => { done(false); });
    child.once('exit', () => { done(false); });
    child.stdout.on('data', chunk => { if (String(chunk).includes('held')) done(true); });
  });
  if (!held) return null;
  return () => { child.stdin.end(); };
}

/** One burner's program: a busy loop, or compile-and-run fresh binaries, until its own end time.
 * @param {string} kind @param {number} endsAt epoch ms @param {string} scratch */
export function burnerProgram(kind, endsAt, scratch) {
  if (kind === 'spin') return `const end=${endsAt};while(Date.now()<end){}`;
  return `const {spawnSync}=require('node:child_process'),{rmSync}=require('node:fs'),end=${endsAt},dir=${JSON.stringify(scratch)};
for(let n=0;Date.now()<end;n++){const out=dir+'/bin-'+process.pid+'-'+n;
if(spawnSync('cc',['-O0',dir+'/tiny.c','-o',out],{stdio:'ignore',timeout:Math.max(1,end-Date.now())}).status===0)
spawnSync(out,[],{stdio:'ignore',timeout:Math.max(1,end-Date.now())});rmSync(out,{force:true});}`;
}

/**
 * Run one load window, optionally around a command. Resolves to the command's exit code (0 with no command), or
 * REFUSED. Everything it starts is stopped before it resolves.
 * @param {{burners?: number, seconds?: number, kind?: string, command?: string[]}} ask
 * @param {{nproc?: number, load15?: number, root?: string, scratchRoot?: string, log?: (line: string) => void}} [deps]
 */
export async function runLoad(ask, deps = {}) {
  const log = deps.log ?? (line => { console.error(line); });
  const nproc = deps.nproc ?? availableParallelism(), load15 = deps.load15 ?? loadavg()[2];
  const window = loadWindow(ask, {nproc, load15});
  if ('refused' in window) { log(`cpu-load REFUSED ${window.refused}`); return REFUSED; }
  const release = await holdCpuLoad(deps.root);
  if (release === null) { log(`cpu-load REFUSED another load harness holds ${join(deps.root ?? lockRoot(), CPU_LOAD_LOCK)}; one at a time`); return REFUSED; }
  const scratchRoot = deps.scratchRoot ?? resolve('tmp/cpu-load');
  mkdirSync(scratchRoot, {recursive: true});
  const scratch = mkdtempSync(join(scratchRoot, 'run-'));
  /** @type {import('node:child_process').ChildProcess[]} */const burners = [];
  try {
    for (const line of window.capped) log(`cpu-load capped ${line}`);
    if (window.kind === 'exec') writeFileSync(join(scratch, 'tiny.c'), 'int main(void){return 0;}\n');
    const endsAt = Date.now() + window.seconds * 1000;
    for (let i = 0; i < window.burners; i++)
      burners.push(track(spawn(process.execPath, ['-e', burnerProgram(window.kind, endsAt, scratch)], {stdio: 'ignore'})));
    log(`cpu-load window ${window.burners} ${window.kind} burner(s) for ${window.seconds} s (nproc ${nproc}, load15 ${load15.toFixed(1)})`);
    const ended = Promise.all(burners.map(child => new Promise(done => { if (child.exitCode !== null) done(undefined); else child.once('exit', done); })));
    if (!ask.command?.length) { await ended; return 0; }
    const run = track(spawn(ask.command[0], ask.command.slice(1), {stdio: 'inherit'}));
    const code = await new Promise(done => {
      run.once('error', error => { log(`cpu-load command failed to start: ${error.message}`); done(127); });
      run.once('exit', (exitCode, signal) => { done(exitCode ?? (signal === 'SIGINT' ? 130 : 1)); });
    });
    if (Date.now() >= endsAt) log('cpu-load note: the window ended before the command did; its tail ran unloaded');
    return code;
  } finally {
    for (const child of burners) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(scratch, {recursive: true, force: true});
    release();
  }
}

/** @param {import('node:child_process').ChildProcess} child */
function track(child) {
  live.add(child);
  child.once('exit', () => { live.delete(child); });
  return child;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const split = argv.indexOf('--'), flags = split === -1 ? argv : argv.slice(0, split);
  /** @type {{burners?: number, seconds?: number, kind?: string, command?: string[]}} */const ask = {};
  if (split !== -1) ask.command = argv.slice(split + 1);
  for (let i = 0; i < flags.length; i++) {
    const value = flags[i + 1];
    if (flags[i] === '--burners') { ask.burners = Number(value); i++; }
    else if (flags[i] === '--seconds') { ask.seconds = Number(value); i++; }
    else if (flags[i] === '--kind') { ask.kind = value; i++; }
    else throw new Error(`cpu-load: unknown argument ${flags[i]}`);
  }
  return ask;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // A signal stops every burner and the command at once; the lock's holder dies with this process.
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(signal, () => {
      for (const child of live) child.kill('SIGKILL');
      process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
    });
  }
  process.exitCode = await runLoad(parseArgs(process.argv.slice(2)));
}
