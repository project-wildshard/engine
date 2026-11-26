// SQ19: keep the Simulator input connection private to this Safari proof.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** @param {string} udid The booted Simulator owned by the caller. */
export function ownSimulatorHid(udid) {
  /** @type {{ child: import('node:child_process').ChildProcess, closed: Promise<void>, dir: string, socket: string } | undefined} */
  let companion;

  async function close() {
    const owned = companion;
    companion = undefined;
    if (owned === undefined) return;
    const {child, closed, dir} = owned;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    try { await closed; } finally {
      clearTimeout(deadline);
      rmSync(dir, {recursive: true, force: true});
    }
  }

  async function start() {
    // Darwin Unix socket paths must stay short even if the QA artifacts are nested.
    const dir = mkdtempSync('/tmp/ws-hid-');
    const socket = join(dir, 'hid.sock');
    const child = spawn('idb_companion', ['--udid', udid, '--grpc-domain-sock', socket], {stdio: 'ignore'});
    const closed = new Promise(resolve => { child.once('close', () => { resolve(undefined); }); });
    /** @type {Error | undefined} */
    let startError;
    child.once('error', error => { startError = error; });
    const owned = {child, closed, dir, socket};
    companion = owned;
    try {
      const readyBy = Date.now() + 10_000;
      while (!existsSync(socket)) {
        if (startError !== undefined) throw startError;
        if (child.exitCode !== null || child.signalCode !== null || Date.now() >= readyBy) {
          throw new Error('The owned Simulator touch companion did not open its socket');
        }
        await delay(50);
      }
      return owned;
    } catch (error) {
      await close();
      throw error;
    }
  }

  /** @param {string[]} args */
  async function tapOrSwipe(args) {
    for (let attempt = 1; ; attempt++) {
      try {
        const owned = companion ?? await start();
        const child = spawn('idb', ['--companion', owned.socket, 'ui', ...args, '--udid', udid], {
          stdio: ['ignore', 'ignore', 'inherit'], signal: AbortSignal.timeout(30_000),
        });
        const status = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
        if (status === 0) return;
        throw new Error(`idb ui ${args[0] ?? ''} exited ${String(status)}`);
      } catch (error) {
        await close();
        if (attempt >= 3) throw error;
      }
    }
  }

  return {tapOrSwipe, close};
}
