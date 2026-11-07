// oxlint-disable-next-line import/no-nodejs-modules -- Launch and reap the owned native browser for the original trusted-input control.
import {spawn} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve the original complete strict event assertion.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Find an installed browser without installing a dependency in CI.
import {openSync, readSync, closeSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove this fixture's exact browser profile.
import {mkdtemp, rm} from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the browser profile under the repository scratch root.
import {resolve} from 'node:path';
import {pressEscape} from '../../scripts/parity/browser-escape.mjs';
import {nativeChromeExecutable} from '../../scripts/warm-native-chrome.mjs';
import {nativeSocketTemporary} from './native-socket-temp.mjs';
import {drainNativeBrowser} from './native-browser-drain.mjs';

const executable = nativeChromeExecutable();
const directory = await mkdtemp(resolve('tmp/escape-control-'));
const socketTemp = await nativeSocketTemporary(directory).catch(async (error: unknown) => {
  await rm(directory, {recursive: true, force: true}); throw error;
});
// Observe only owned native files/kernel counters, never the inherited
// environment or command lines. In particular, DBus warnings are not a cause.
const boundedRead = (file: string, bytes: number): string => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, 'r');
    const buffer = Buffer.alloc(bytes);
    return buffer.subarray(0, readSync(descriptor, buffer, 0, bytes, 0)).toString();
  } catch (error) {return `unavailable:${error instanceof Error && 'code' in error ? String(error.code) : 'unknown'}`;}
  finally {if (descriptor !== undefined) closeSync(descriptor);}
};
const cpuPressure = (): string | null => process.platform === 'linux' ? boundedRead('/proc/pressure/cpu', 140) : null;
const cgroupCpu = (): string | null => process.platform === 'linux' ? boundedRead('/sys/fs/cgroup/cpu.stat', 200) : null;
const startedAt = performance.now();
const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  ...(process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--no-sandbox']), 'data:text/html,bootstrap'],
{detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: {...process.env, TMPDIR: socketTemp.path}});
const initialPressure = cpuPressure(), initialCpu = cgroupCpu();
let spawnedAt: number | null = null, firstStderrAt: number | null = null, lastStderrAt: number | null = null;
let endpointAtMs: number | null = null;
child.once('spawn', () => {spawnedAt = performance.now() - startedAt;});
const nativeState = (): object => {
  const pid = child.pid;
  const linux = process.platform === 'linux' && pid !== undefined ? {
    status: boundedRead(`/proc/${pid}/status`, 4096).split('\n')
      .filter(line => /^(?:State|Threads|VmRSS|VmSwap):/u.test(line)).join(';'),
    scheduler: boundedRead(`/proc/${pid}/schedstat`, 100), waitChannel: boundedRead(`/proc/${pid}/wchan`, 80),
    children: boundedRead(`/proc/${pid}/task/${pid}/children`, 120),
    cpuPressure: cpuPressure(), cgroupCpu: cgroupCpu(),
  } : null;
  return {deadlineMs: 10_000, elapsedMs: performance.now() - startedAt, spawnedAt, firstStderrAt, lastStderrAt,
    endpointFile: boundedRead(resolve(directory, 'DevToolsActivePort'), 256), initialPressure, initialCpu, linux};
};
let socket: WebSocket | undefined;
let requestClose: (() => void) | undefined;
let closing: Promise<void> | undefined;
const close = (): Promise<void> => (closing ??= (async () => {
  try {await drainNativeBrowser(child, requestClose, async () => {
    try {await socketTemp.dispose();} finally {await rm(directory, {recursive: true, force: true});}
  });} finally {socket?.close();}
})());
const terminate = (): void => {void close().catch(error => {console.error(error);}).finally(() => {process.exitCode = 143;});};
process.once('SIGTERM', terminate);
try {
  const endpoint = await new Promise<string>((done, refuse) => {
    let output = '';
    const failed = (reason: string, code: number | null, signal: string | null): Error => new Error(
      `Native Escape startup ${reason}; executable=${JSON.stringify(executable)}; profile=${JSON.stringify(directory)}; socketTemp=${JSON.stringify(socketTemp.path)}; code=${code}; signal=${signal}\nNative startup state: ${JSON.stringify(nativeState())}\nNative stderr (last 16384 characters):\n${output}`);
    const timer = setTimeout(() => {refuse(failed('endpoint deadline', child.exitCode, child.signalCode));},
      Math.max(0, 10_000 - (performance.now() - startedAt)));
    child.once('error', error => {clearTimeout(timer); refuse(failed(error.message, child.exitCode, child.signalCode));});
    // close follows stderr delivery; exit alone can lose the final native cause.
    child.once('close', (code, signal) => {clearTimeout(timer); refuse(failed('closed before endpoint', code, signal));});
    child.stderr.on('data', (chunk: Buffer) => {
      lastStderrAt = performance.now() - startedAt; firstStderrAt ??= lastStderrAt;
      const incoming = output + chunk.toString();
      output = incoming.slice(-16_384);
      const address = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(incoming)?.[1];
      if (address !== undefined && lastStderrAt < 10_000) {endpointAtMs = lastStderrAt; clearTimeout(timer); done(address);}
    });
  });
  const ws = new WebSocket(endpoint); socket = ws;
  await new Promise<void>((done, refuse) => {
    const timer = setTimeout(() => {refuse(new Error('Native Escape socket deadline'));}, 5000);
    ws.addEventListener('open', () => {clearTimeout(timer); done();}, {once: true});
    ws.addEventListener('error', () => {clearTimeout(timer); refuse(new Error('Native Escape socket refused'));}, {once: true});
  });
  let serial = 0;
  requestClose = () => {ws.send(JSON.stringify({id: ++serial, method: 'Browser.close'}));};
  const pending = new Map<number, {done: (result: unknown) => void; refuse: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  ws.addEventListener('message', event => {
    const value: unknown = JSON.parse(String(event.data));
    if (typeof value !== 'object' || value === null) return;
    const id: unknown = Reflect.get(value, 'id');
    if (typeof id !== 'number') return;
    const item = pending.get(id); if (item === undefined) return;
    pending.delete(id); clearTimeout(item.timer);
    const error: unknown = Reflect.get(value, 'error');
    if (error !== undefined) item.refuse(new Error(JSON.stringify(error)));
    else item.done(Reflect.get(value, 'result'));
  });
  const send = (method: string, params: object, sessionId?: string): Promise<unknown> => new Promise((done, refuse) => {
    const id = ++serial, timer = setTimeout(() => {pending.delete(id); refuse(new Error(`Native Escape command deadline: ${method}`));}, 5000);
    pending.set(id, {done, refuse, timer}); ws.send(JSON.stringify({id, method, params, sessionId}));
  });
  const field = (value: unknown, name: string): unknown => typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
  const target = await send('Target.createTarget', {url: 'about:blank'}), targetId = field(target, 'targetId');
  if (typeof targetId !== 'string') throw new Error('Native Escape target missing');
  const attached = await send('Target.attachToTarget', {targetId, flatten: true}), sessionId = field(attached, 'sessionId');
  if (typeof sessionId !== 'string') throw new Error('Native Escape session missing');
  await send('Emulation.setDeviceMetricsOverride', {width: 402, height: 874, deviceScaleFactor: 3, mobile: true}, sessionId);
  await send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1}, sessionId);
  await send('Runtime.evaluate', {expression: `globalThis.escapeEvents=[];for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{escapeEvents.push({type:event.type,key:event.key,code:event.code,trusted:event.isTrusted,repeat:event.repeat});});`}, sessionId);
  await pressEscape(endpoint, 'about:blank');
  const result = await send('Runtime.evaluate', {expression: 'globalThis.escapeEvents', returnByValue: true}, sessionId);
  const events = field(field(result, 'result'), 'value');
  assert.deepEqual(events, [
    {type: 'keydown', key: 'Escape', code: 'Escape', trusted: true, repeat: false},
    {type: 'keyup', key: 'Escape', code: 'Escape', trusted: true, repeat: false},
  ]);
} finally {process.off('SIGTERM', terminate); await close();}
console.log(JSON.stringify({cleanup: 'complete', profile: directory, socketTemp: socketTemp.path,
  startup: {spawnedAt, firstStderrAt, lastStderrAt, endpointAtMs}}));
console.log('original trusted Escape pair preserved');
