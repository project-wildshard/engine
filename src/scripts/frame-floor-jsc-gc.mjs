// Native diagnostic only. Settings are temporary in this Simulator's launchd;
// Collector policy changes only with the explicit diagnostic RAM override.
import {spawn, spawnSync} from 'node:child_process';
import {openSync, closeSync, writeSync, existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

export const JSC_GC_SETTINGS = Object.freeze({
  __XPC_JSC_logGC: '2', __XPC_JSC_useOSLog: '1', __XPC_JSC_dumpOptions: '1',
});

/** @param {number} ramSizeBytes */
function gcSettings(ramSizeBytes) {
  if (!Number.isSafeInteger(ramSizeBytes) || ramSizeBytes < 0) throw new Error('Invalid diagnostic JSC RAM size');
  return ramSizeBytes === 0 ? JSC_GC_SETTINGS : {...JSC_GC_SETTINGS, __XPC_JSC_forceRAMSize: String(ramSizeBytes)};
}

/** Refuse foreign settings; clean every successful set on partial setup/failure.
 * @param {import('./frame-floor-jsc-gc.mjs').EnvironmentPort} port
 * @param {number} [ramSizeBytes]
 */
export async function prepareJscGcEnvironment(port, ramSizeBytes = 0) {
  const settings = gcSettings(ramSizeBytes);
  const names = Object.keys(settings), changed = [];
  for (const name of names) if (await port.get(name) !== '') throw new Error(`Refusing existing Simulator setting: ${name}`);
  const cleanup = async () => {
    const failures = [];
    for (const name of changed.toReversed()) {
      try { await port.unset(name); if (await port.get(name) !== '') throw new Error('setting remains'); }
      catch (error) { failures.push(`${name}: ${String(error)}`); }
    }
    if (failures.length > 0) throw new Error(`Simulator GC settings cleanup failed: ${failures.join('; ')}`);
  };
  try { for (const name of names) {
    changed.push(name); const value = Reflect.get(settings, name);
    await port.set(name, value);
    if (await port.get(name) !== value) throw new Error(`Simulator setting not retained: ${name}`);
  } }
  catch (error) { await cleanup(); throw error; }
  return cleanup;
}

/** Start before Safari, stop after the one selected window. Raw native logs
 * remain bounded and separate from Inspector events and frame-floor grading.
 * @param {string} directory
 * @param {string} device
 * @param {number} [ramSizeBytes]
 */
export async function startJscGcLog(directory, device, ramSizeBytes = 0) {
  const settings = gcSettings(ramSizeBytes);
  const command = args => {
    const value = spawnSync('xcrun', ['simctl', 'spawn', device, 'launchctl', ...args], {encoding: 'utf8'});
    if (value.status !== 0 && !(args[0] === 'getenv' && value.status === 1)) throw new Error(`Simulator launchctl ${args[0]} failed: ${value.stderr}`);
    return value.stdout.trim();
  };
  const file = join(directory, 'native.ndjson'), errorsFile = join(directory, 'log-stream.stderr');
  if ([file, errorsFile, join(directory, 'config.json')].some(path => existsSync(path))) throw new Error('Native GC output already exists');
  const output = openSync(file, 'wx');
  let errors;
  try { errors = openSync(errorsFile, 'wx'); } catch (error) { closeSync(output); throw error; }
  let restore;
  try { restore = await prepareJscGcEnvironment({
    get: name => Promise.resolve(command(['getenv', name])),
    set: (name, value) => { command(['setenv', name, value]); return Promise.resolve(); },
    unset: name => { command(['unsetenv', name]); return Promise.resolve(); },
  }, ramSizeBytes); } catch (error) { closeSync(output); closeSync(errors); throw error; }
  let bytes = 0, dropped = 0, streamError;
  const predicate = 'subsystem == "com.apple.JavaScriptCore" OR process CONTAINS[c] "WebContent"';
  const child = spawn('/usr/bin/log', ['stream', '--style', 'ndjson', '--level', 'debug', '--timeout', '590', '--predicate', predicate], {stdio: ['ignore','pipe','pipe']});
  const closed = new Promise(resolve => {
    child.once('error', error => { streamError = String(error); resolve(null); });
    child.once('close', code => resolve(code));
  });
  child.stdout.on('data', value => {
    bytes += value.length;
    if (bytes <= 64 * 1024 * 1024) { try { writeSync(output, value); } catch (error) { streamError = String(error); child.kill('SIGTERM'); } }
    else { dropped += value.length; child.kill('SIGTERM'); }
  });
  child.stderr.on('data', value => { try { writeSync(errors, value); } catch (error) { streamError = String(error); child.kill('SIGTERM'); } });
  const metadata = {diagnostic: true, device, settings, launchdReadbackVerified: true, predicate, file, startedAt: Date.now()};
  try { writeFileSync(join(directory, 'config.json'), JSON.stringify(metadata)); }
  catch (error) { child.kill('SIGTERM'); await closed; closeSync(output); closeSync(errors); await restore(); throw error; }
  await sleep(300);
  let stopped;
  return () => {
    stopped ??= (async () => {
      child.kill('SIGTERM');
      const exitCode = await closed;
      closeSync(output); closeSync(errors);
      let cleanupError;
      try {
        // Kill only the Safari owned by this Simulator visit, so no already
        // launched WebContent retains the diagnostic settings after unset.
        spawnSync('xcrun', ['simctl','terminate',device,'com.apple.mobilesafari'], {stdio: 'ignore'});
        await restore();
      } catch (error) { cleanupError = String(error); }
      const result = {...metadata, endedAt: Date.now(), bytes, dropped, exitCode, streamError, cleanupError,
        settingsUnset: cleanupError === undefined};
      writeFileSync(join(directory, 'config.json'), JSON.stringify(result));
      if (cleanupError !== undefined) throw new Error(cleanupError);
      return result;
    })();
    return stopped;
  };
}

/** Actual Simulator WebContent descendants, not every browser on this Mac.
 * @param {string} device
 */
export function jscGcProcessIds(device) {
  const code = String.raw`import json,runpy,sys
m=runpy.run_path(sys.argv[2])
manager=int(m['command'](['xcrun','simctl','spawn',sys.argv[1],'launchctl','managerpid']))
print(json.dumps(sorted(m['simulator_processes'](manager,'com.apple.WebKit.WebContent'))))`;
  const watchdog = fileURLToPath(new URL('ios-memory-watchdog.py', import.meta.url));
  const result = spawnSync('python3', ['-c', code, device, watchdog], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`Simulator WebContent identities failed: ${result.stderr}`);
  const pids = JSON.parse(result.stdout);
  if (!Array.isArray(pids) || pids.length === 0 || pids.some(pid => !Number.isSafeInteger(pid) || pid < 1)) throw new Error('No readable Simulator WebContent identity');
  return pids;
}
