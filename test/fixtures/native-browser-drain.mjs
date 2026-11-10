// oxlint-disable-next-line import/no-nodejs-modules -- Drain only the isolated native-input fixture's owned browser writers.
import {spawnSync} from 'node:child_process';
import {nativeInventoryCommand} from './native-process-inventory.mjs';

/** @typedef {{pid: number, parent: number, group: number, state: string}} NativeProcess */
/** @param {{executable: string, args: string[]}} command
 * @param {number} timeout
 * @returns {Promise<NativeProcess[]>} */
const processes = (command, timeout) => new Promise((resolve, reject) => {
  const started = performance.now();
  // execFile's JS timeout can destroy unread pipes after the process already
  // exited if this worker was stalled. The native sync collector owns both the
  // same execution deadline and complete pipe reads, before returning to JS.
  const result = spawnSync(command.executable, command.args, {encoding: 'utf8', timeout});
  const output = result.stdout ?? '', stderr = result.stderr ?? '';
  if (result.error !== undefined || result.status !== 0) {
    const code = result.error !== undefined && 'code' in result.error ? String(result.error.code) : result.status;
    reject(new Error(`Native process inventory command refused: ${JSON.stringify({code,
      signal: result.signal ?? null, killed: code === 'ETIMEDOUT', elapsedMs: Math.round(performance.now() - started),
      message: (result.error?.message ?? `Inventory exit ${String(result.status)}`).slice(0, 160), stdout: output.slice(0, 160), stderr: stderr.slice(0, 160)})}`));
    return;
  }
  const rows = output.trim().split('\n').map(line => {
    const [pid, parent, group, state] = line.trim().split(/\s+/u);
    return {pid: Number(pid), parent: Number(parent), group: Number(group), state: state ?? '', inventory: line.slice(0, 160)};
  });
  const invalid = rows.find(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 || !Number.isSafeInteger(row.parent)
    || !Number.isSafeInteger(row.group) || row.state.length === 0);
  if (invalid !== undefined) {reject(new Error(`Invalid native process inventory: ${JSON.stringify(invalid)}`)); return;}
  resolve(rows);
});

/** Native parent exit does not mean its renderers have stopped writing Default.
 * Capture descendants before asking Chrome to close, then observe only those
 * PIDs and the detached group until no live writer remains. Zombies cannot
 * write and are left for their actual parent/init to reap.
 * @param {import('node:child_process').ChildProcess} child
 * @param {(() => void) | undefined} requestClose
 * @param {() => Promise<void>} dispose
 * @param {{executable: string, args: string[]} | undefined} inventory The fixture's explicit executable for real refusal controls; validation and clocks remain identical.
 * @returns {Promise<void>}
 */
export async function drainNativeBrowser(child, requestClose, dispose, inventory = undefined) {
  const pid = child.pid;
  if (pid === undefined) {await dispose(); return;}
  const started = performance.now(), owned = new Set([pid]);
  // The caller creates this exact child with detached:true. Keep its group
  // available for emergency shutdown even if the inventory command refuses.
  let groupOwned = true;
  /** @type {Error | undefined} */
  let closeError;
  /** @param {NodeJS.Signals} signal */
  const signalOwned = signal => {
    const targets = [...owned].reverse();
    if (groupOwned) targets.push(-pid);
    for (const target of targets) try {process.kill(target, signal);}
    catch (error) {if (!(error instanceof Error && 'code' in error && (error.code === 'ESRCH' || (target < 0 && error.code === 'EPERM')))) throw error;}
  };
  /** @param {NativeProcess[]} rows */
  const observe = rows => {
    const parent = rows.find(row => row.pid === pid);
    if (parent !== undefined && parent.group !== pid) throw new Error('Native Escape browser must own a detached process group');
    groupOwned = true;
    for (const row of rows) if (row.group === pid) owned.add(row.pid);
    for (let previous = -1; previous !== owned.size;) {
      previous = owned.size;
      for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
    }
    return rows.filter(row => owned.has(row.pid) && !row.state.startsWith('Z'));
  };
  try {
    const command = inventory ?? nativeInventoryCommand();
    const expired = () => new Error(`Owned Escape browser writers did not drain in 5000ms: ${[...owned].join(',')}`);
    const read = async () => {
      const remaining = 5000 - (performance.now() - started);
      if (remaining <= 0) throw expired();
      const rows = await processes(command, Math.min(500, Math.max(1, Math.floor(remaining))));
      if (performance.now() - started >= 5000) throw expired();
      return rows;
    };
    observe(await read());
    try {if (requestClose === undefined) signalOwned('SIGTERM'); else requestClose();}
    catch (error) {closeError = error instanceof Error ? error : new Error(String(error)); signalOwned('SIGTERM');}
    await new Promise((resolve, reject) => {
      let scanning = false, settled = false;
      const finish = (/** @type {Error | undefined} */ error) => {
        if (settled) return;
        settled = true; clearInterval(interval); clearTimeout(deadline);
        if (error === undefined) resolve(undefined); else reject(error);
      };
      const scan = async () => {
        if (scanning || settled) return;
        scanning = true;
        try {
          const live = observe(await read());
          if (settled) return;
          const elapsed = performance.now() - started;
          if (elapsed >= 5000) {signalOwned('SIGKILL'); finish(expired()); return;}
          if (live.length === 0 && (child.exitCode !== null || child.signalCode !== null)) {finish(undefined); return;}
          // One graceful request, then terminate only surviving owned writers.
          if (elapsed >= 4000) signalOwned('SIGKILL');
          else if (elapsed >= 1000 || child.exitCode !== null || child.signalCode !== null) signalOwned('SIGTERM');
        } catch (error) {finish(error instanceof Error ? error : new Error(String(error)));}
        finally {scanning = false;}
      };
      const interval = setInterval(() => {void scan();}, 25);
      const deadline = setTimeout(() => {
        try {
          signalOwned('SIGKILL'); finish(new Error(`Owned Escape browser writers did not drain in 5000ms: ${[...owned].join(',')}`));
        } catch (error) {finish(error instanceof Error ? error : new Error(String(error)));}
      }, Math.max(0, 5000 - (performance.now() - started)));
      void scan();
    });
  } catch (error) {
    signalOwned('SIGKILL'); throw error;
  }
  await dispose(); // Never retry/swallow an ENOTEMPTY or publish success early.
  if (closeError !== undefined) throw closeError;
}
