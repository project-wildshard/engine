import {afterAll, beforeAll, test, expect} from 'vitest';
import {nativeChromeExecutable, warmNativeChrome} from '../../../scripts/warm-native-chrome.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- The original trusted-input assertion must execute in a real, leased browser and isolated child.
import {execFileSync, spawnSync, spawn} from 'node:child_process';

// oxlint-disable-next-line import/no-nodejs-modules -- Own the bounded startup-refusal executable under repository scratch.
import {mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, realpathSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise strict native profile removal after actual writer drain.
import {rm, rmdir} from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the isolated native startup fixture.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual native Unix socket path limit, without mocking Chrome.
import {createServer} from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- Await the native listening and close events without wall-clock assumptions.
import {once} from 'node:events';
import {nativeSocketTemporary} from '../../fixtures/native-socket-temp.mjs';
import {drainNativeBrowser} from '../../fixtures/native-browser-drain.mjs';
import {warmNativeInventory} from '../../fixtures/native-process-inventory.mjs';
import {requestNativeRetention} from '../../fixtures/native-retention.mjs';

// Singleplayer prepared these exact executable/resource pages before its
// isolated Escape job. The lift kept the helper but lost that workflow step.
// Keep cold file I/O outside the original 10 s endpoint / 25 s child clocks.
// Reading the complete installed binary/resources can exceed Vitest's default
// 10 s hook on a cold shared runner. Bound only that disk preparation at 60 s;
// the actual endpoint, child-process and trusted-input clocks stay unchanged.
// BROWSER-TESTS-BENCH BB3: two cases only wait on clocks inside their own child (the 10 s endpoint deadline, the 5.1 s
// delivery block). Their children start here, before the warm-up, and run beside every other case; each case still
// awaits its own child and asserts the same facts. Nothing in those children reads this process's clock.
/** @typedef {{status: number | null, signal: string | null, stdout: string, stderr: string}} ChildRun */
/** @type {Promise<unknown>[]} */
const earlyRuns = [];
/** spawnSync's facts without blocking this worker: the same SIGTERM at the same timeout.
 * @param {string[]} args @param {number} timeout @param {NodeJS.ProcessEnv} [env] @returns {Promise<ChildRun>} */
function runChild(args, timeout, env = process.env) {
  /** @type {Promise<ChildRun>} */
  const run = new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, {env, stdio: ['pipe', 'pipe', 'pipe']});
    child.stdin.end();
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => {stdout += chunk;});
    child.stderr.setEncoding('utf8').on('data', chunk => {stderr += chunk;});
    const timer = setTimeout(() => {child.kill('SIGTERM');}, timeout);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('close', (status, signal) => {clearTimeout(timer); resolveRun({status, signal, stdout, stderr});});
  });
  earlyRuns.push(run.catch(() => undefined));
  return run;
}
/** @type {{root: string, child: Promise<ChildRun>} | undefined} */
let endpointRun;
/** @type {{profile: string, runs: Promise<{delay: number, result: ChildRun}[]>} | undefined} */
let deliveryRun;
beforeAll(() => { endpointRun = startEndpointRefusal(); deliveryRun = startDelivery(); });
beforeAll(async () => { warmNativeInventory(); await warmNativeChrome(nativeChromeExecutable()); }, 60_000);
// A filtered run that skips either case still waits for its child; the endpoint root is always removed, as before.
afterAll(async () => {
  await Promise.all(earlyRuns);
  if (endpointRun !== undefined) rmSync(endpointRun.root, {recursive: true, force: true});
}, 30_000);

/** @param {number | undefined} pid */
function stopFixturePid(pid) {
  if (pid === undefined) return;
  try {process.kill(pid, 'SIGKILL');}
  catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;}
}

test('Escape sends only its own trusted down and up', () => {
  const args = ['--experimental-transform-types', 'test/fixtures/native-browser-escape.ts'];
  // The shared Mac takes its existing lease. Each isolated Linux CI runner
  // owns one inert native-input browser; no game or external page is loaded.
  const command = process.platform === 'darwin' ? 'scripts/browser-lane.sh' : process.execPath;
  const output = execFileSync(command, process.platform === 'darwin' ? ['--max', '2', process.execPath, ...args] : args,
    {encoding: 'utf8', timeout: 25_000});
  expect(output).toContain('original trusted Escape pair preserved');
  const raw = output.split('\n').find(line => line.startsWith('{"cleanup":"complete"'));
  if (raw === undefined) throw new Error('Missing native cleanup completion');
  /** @type {unknown} */
  const cleanup = JSON.parse(raw);
  if (typeof cleanup !== 'object' || cleanup === null || !('profile' in cleanup) || typeof cleanup.profile !== 'string'
    || !cleanup.profile.startsWith(resolve('tmp/escape-control-')) || !('socketTemp' in cleanup) || typeof cleanup.socketTemp !== 'string'
    || !cleanup.socketTemp.startsWith('/tmp/wsesc-')) throw new Error('Foreign native cleanup completion');
  expect(existsSync(cleanup.profile)).toBe(false);
  expect(existsSync(resolve(cleanup.socketTemp, '..'))).toBe(false);
  expect(output.indexOf(raw)).toBeLessThan(output.indexOf('original trusted Escape pair preserved'));
});

test('native startup refusal retains its signal and bounded stderr, never claims trusted input, and cleans its profile', () => {
  const root = mkdtempSync(resolve('tmp/native-startup-refusal-'));
  try {
    const binary = resolve(root, 'native-refusal');
    const message = `${'x'.repeat(20_000)}\nOriginal native startup sentinel`;
    writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${message}' >&2\nkill -TERM $$\n`, {mode: 0o700});
    const child = spawnSync(process.execPath, ['--experimental-transform-types', 'test/fixtures/native-browser-escape.ts'],
      {encoding: 'utf8', timeout: 15_000, env: {...process.env, CHROME_PATH: binary}});
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('code=null; signal=SIGTERM');
    expect(child.stderr).toContain('Original native startup sentinel');
    expect(child.stderr.length).toBeLessThan(20_000);
    expect(child.stdout).not.toContain('original trusted Escape pair preserved');
    const profile = /profile=("[^"\n]+")/.exec(child.stderr)?.[1];
    if (profile === undefined) throw new Error('Missing actual failed profile diagnostic');
    /** @type {unknown} */
    const path = JSON.parse(profile);
    if (typeof path !== 'string' || !path.startsWith(resolve('tmp/escape-control-'))) throw new Error('Foreign failed profile');
    expect(existsSync(path)).toBe(false);
    const socketTemp = /socketTemp=("[^"\n]+")/.exec(child.stderr)?.[1];
    if (socketTemp === undefined) throw new Error('Missing owned socket alias diagnostic');
    /** @type {unknown} */
    const alias = JSON.parse(socketTemp);
    if (typeof alias !== 'string' || !alias.startsWith('/tmp/wsesc-') || !alias.endsWith('/t')) throw new Error('Foreign socket alias');
    expect(existsSync(resolve(alias, '..'))).toBe(false);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('long native Unix socket paths refuse while the short alias binds to profile-owned data', async () => {
  const root = mkdtempSync(resolve('tmp/native-socket-control-'));
  let temporary;
  /** @param {string} path */
  const bind = async path => {
    const server = createServer();
    try {server.listen(path); await once(server, 'listening');}
    finally {if (server.listening) {const closed = once(server, 'close'); server.close(); await closed;}}
  };
  try {
    const inherited = resolve(root, 'long-inherited-tmpdir-'.repeat(5), 'com.google.Chrome.ABCDEF');
    mkdirSync(inherited, {recursive: true});
    await expect(bind(resolve(inherited, 'SingletonSocket'))).rejects.toThrow(/EINVAL|ENAMETOOLONG/u);
    temporary = await nativeSocketTemporary(root);
    const alias = resolve(temporary.path, 'com.google.Chrome.ABCDEF');
    mkdirSync(alias);
    expect(realpathSync(alias)).toBe(resolve(root, 'native-tmp/com.google.Chrome.ABCDEF'));
    const socket = resolve(alias, 'SingletonSocket');
    expect(Buffer.byteLength(socket)).toBeLessThan(80);
    await bind(socket);
    await temporary.dispose();
    expect(existsSync(resolve(temporary.path, '..'))).toBe(false);
  } finally {await temporary?.dispose(); rmSync(root, {recursive: true, force: true});}
});

test('native cleanup drains a detached descendant writer after its browser parent exits, before deleting the profile', async () => {
  const profile = mkdtempSync(resolve('tmp/native-writer-drain-'));
  const writer = `const {writeFileSync}=require('node:fs');
    process.on('SIGTERM',()=>{});writeFileSync(process.argv[1]+'/Default/writer','ready');
    console.log('writer ready');setInterval(()=>writeFileSync(process.argv[1]+'/Default/writer','writing'),10);`;
  const parent = `const {spawn}=require('node:child_process');
    const writer=spawn(process.execPath,['-e',${JSON.stringify(writer)},process.argv[1]],{detached:true,stdio:['ignore','pipe','inherit']});
    writer.stdout.once('data',()=>console.log(writer.pid));process.on('SIGTERM',()=>process.exit(0));`;
  mkdirSync(resolve(profile, 'Default'));
  const child = spawn(process.execPath, ['-e', parent, profile], {detached: true, stdio: ['ignore', 'pipe', 'inherit']});
  let writerPid;
  let drained = false;
  let cleanupFailed = false;
  try {
    const [ready] = await once(child.stdout, 'data');
    writerPid = Number(String(ready).trim());
    if (!Number.isSafeInteger(writerPid) || writerPid <= 1) throw new Error('Missing owned writer PID');
    expect(existsSync(resolve(profile, 'Default/writer'))).toBe(true);
    let parentExitedWithWriter = false;
    child.once('exit', () => {
      if (writerPid !== undefined) try {process.kill(writerPid, 0); parentExitedWithWriter = true;}
      catch { /* A writer already gone would not establish the original race. */ }
    });
    let disposed = false;
    try {await drainNativeBrowser(child, () => {child.kill('SIGTERM');}, async () => {
      expect(child.exitCode).toBe(0);
      const table = execFileSync('ps', ['-axo', 'pid=,stat='], {encoding: 'utf8'});
      const live = table.split('\n').map(line => line.trim().split(/\s+/u))
        .find(([pid, state]) => Number(pid) === writerPid && !state?.startsWith('Z'));
      expect(live).toBeUndefined();
      await rm(profile, {recursive: true}); disposed = true;
    });} catch (error) {cleanupFailed = true; throw error;}
    drained = true;
    expect(disposed).toBe(true);
    expect(parentExitedWithWriter).toBe(true);
    expect(existsSync(profile)).toBe(false);
  } finally {
    for (const pid of [writerPid, child.pid]) stopFixturePid(pid);
    if (drained) rmSync(profile, {recursive: true, force: true});
    else {
      console.error(`Native writer-drain profile retained after refusal: ${JSON.stringify(profile)}`);
      if (cleanupFailed && existsSync(profile)) try {requestNativeRetention('native-writer-drain', profile);}
      catch (error) {console.error(`Native retained-profile request refused: ${String(error).slice(0, 240)}`);}
    }
  }
});

test('inventory refusal retains its bounded raw row and never disposes the owned profile', () => {
  const root = mkdtempSync(resolve('tmp/native-inventory-refusal-'));
  const profile = resolve(root, 'profile'), bin = resolve(root, 'bin');
  let verified = false;
  try {
    mkdirSync(profile); mkdirSync(bin); writeFileSync(resolve(profile, 'original'), 'preserved');
    const inventory = `not-a-pid 1 1 S ${'x'.repeat(2000)}`;
    writeFileSync(resolve(bin, 'ps'), `#!/bin/sh\nprintf '%s\\n' '${inventory}'\n`, {mode: 0o700});
    const program = `import {spawn} from 'node:child_process';
      import {once} from 'node:events';import {existsSync,writeFileSync} from 'node:fs';
      const {drainNativeBrowser}=await import(process.argv[1]),profile=process.argv[2],inventoryScript=process.argv[4];
      if(typeof inventoryScript!=='string')throw Error('Missing owned inventory script');
      const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','inherit']});
      let stopping;
      const stop=()=>stopping??=(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}})();
      const terminate=()=>{void stop().then(()=>{writeFileSync(profile+'/terminated',String(child.pid));process.exit(143);});};
      process.on('SIGTERM',terminate);process.on('SIGINT',terminate);
      await once(child.stdout,'data');let disposed=false;
      if(process.argv[3]==='hold')await new Promise(()=>{});
      try{await drainNativeBrowser(child,undefined,async()=>{disposed=true;},{executable:'/bin/sh',args:[inventoryScript]});throw Error('Invalid inventory was admitted');}
      catch(error){console.log(JSON.stringify({message:String(error),disposed,profile:existsSync(profile+'/original')}));}
      finally{await stop();}`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program,
      new URL('../../fixtures/native-browser-drain.mjs', import.meta.url).href, profile, 'run', resolve(bin, 'ps')],
    {encoding: 'utf8', timeout: 10_000});
    expect(result.status).toBe(0);
    /** @type {unknown} */
    const value = JSON.parse(result.stdout);
    if (typeof value !== 'object' || value === null || !('message' in value) || typeof value.message !== 'string'
      || !('disposed' in value) || !('profile' in value)) throw new Error('Missing native inventory refusal facts');
    expect(value.disposed).toBe(false); expect(value.profile).toBe(true);
    expect(value.message).toContain('Invalid native process inventory:');
    /** @type {unknown} */
    const diagnostic = JSON.parse(value.message.slice(value.message.indexOf('{')));
    expect(diagnostic).toMatchObject({pid: null, parent: 1, group: 1, state: 'S', inventory: inventory.slice(0, 160)});
    expect(value.message.length).toBeLessThan(512);
    expect(existsSync(resolve(profile, 'original'))).toBe(true);
    writeFileSync(resolve(bin, 'ps'), `#!/bin/sh\nprintf '%s\\n' '${'o'.repeat(2000)}'\nprintf '%s\\n' '${'e'.repeat(2000)}' >&2\nexec /bin/sleep 5\n`, {mode: 0o700});
    const commandRefused = spawnSync(process.execPath, ['--input-type=module', '-e', program,
      new URL('../../fixtures/native-browser-drain.mjs', import.meta.url).href, profile, 'run', resolve(bin, 'ps')],
    {encoding: 'utf8', timeout: 10_000});
    expect(commandRefused.status).toBe(0);
    /** @type {unknown} */
    const commandValue = JSON.parse(commandRefused.stdout);
    if (typeof commandValue !== 'object' || commandValue === null || !('message' in commandValue) || typeof commandValue.message !== 'string') throw new Error('Missing command refusal facts');
    expect(commandValue).toMatchObject({disposed: false, profile: true});
    expect(commandValue.message).toContain('Native process inventory command refused:');
    /** @type {unknown} */
    const commandFacts = JSON.parse(commandValue.message.slice(commandValue.message.indexOf('{')));
    expect(commandFacts).toMatchObject({code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, stdout: 'o'.repeat(160), stderr: 'e'.repeat(160)});
    expect(commandValue.message.length).toBeLessThan(1024);
    const timed = spawnSync(process.execPath, ['--input-type=module', '-e', program,
      new URL('../../fixtures/native-browser-drain.mjs', import.meta.url).href, profile, 'hold', resolve(bin, 'ps')],
    {encoding: 'utf8', timeout: 1000});
    expect(timed.error).toMatchObject({code: 'ETIMEDOUT'});
    const stopped = Number(readFileSync(resolve(profile, 'terminated'), 'utf8'));
    if (!Number.isSafeInteger(stopped) || stopped <= 1) throw new Error('Timed wrapper did not await its owned child');
    expect(() => process.kill(stopped, 0)).toThrow();
    verified = true;
  } finally {
    if (verified) rmSync(root, {recursive: true, force: true});
    else console.error(`Native inventory control retained after refusal: ${JSON.stringify(root)}`);
  }
});

test('a real profile removal failure rejects cleanup instead of publishing completion', async () => {
  const profile = mkdtempSync(resolve('tmp/native-writer-refusal-'));
  writeFileSync(resolve(profile, 'original'), 'preserved');
  const child = spawn(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)"],
    {detached: true, stdio: ['ignore', 'pipe', 'inherit']});
  try {
    await once(child.stdout, 'data');
    let completed = false;
    await expect((async () => {
      await drainNativeBrowser(child, () => {child.kill('SIGTERM');}, () => rmdir(profile));
      completed = true;
    })()).rejects.toMatchObject({code: 'ENOTEMPTY'});
    expect(completed).toBe(false);
    expect(child.signalCode).toBe('SIGTERM');
    expect(existsSync(resolve(profile, 'original'))).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(profile, {recursive: true, force: true});
  }
});

// BB3: the two early children's cases come last, so the cases above run while those children wait on their clocks.
/** The endpoint-deadline child: a fake browser that writes a DevToolsActivePort but never announces it. */
function startEndpointRefusal() {
  const root = mkdtempSync(resolve('tmp/native-endpoint-refusal-'));
  const binary = resolve(root, 'native-no-endpoint.mjs');
  writeFileSync(binary, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';
      const arg=process.argv.find(value=>value.startsWith('--user-data-dir='));
      if(!arg)throw Error('Missing owned profile');
      writeFileSync(arg.slice('--user-data-dir='.length)+'/DevToolsActivePort','9\\n/devtools/browser/diagnostic-only\\n');
      console.error('Original no-endpoint sentinel');setInterval(()=>{},1000);`, {mode: 0o700});
  return {root, child: runChild(['--experimental-transform-types', 'test/fixtures/native-browser-escape.ts'], 25_000,
    {...process.env, CHROME_PATH: binary})};
}

test('the original native startup deadline retains process and endpoint-file facts without accepting an unannounced endpoint', async () => {
  if (endpointRun === undefined) throw new Error('Missing endpoint-deadline child');
  const {root} = endpointRun;
  try {
    const child = await endpointRun.child;
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('Native Escape startup endpoint deadline');
    expect(child.stderr).toContain('Original no-endpoint sentinel');
    expect(child.stdout).not.toContain('original trusted Escape pair preserved');
    const raw = /Native startup state: ([^\n]+)/u.exec(child.stderr)?.[1];
    if (raw === undefined) throw new Error('Missing native startup state');
    /** @type {unknown} */
    const state = JSON.parse(raw);
    expect(state).toMatchObject({deadlineMs: 10_000, endpointFile: '9\n/devtools/browser/diagnostic-only\n'});
    if (typeof state !== 'object' || state === null || !('elapsedMs' in state) || typeof state.elapsedMs !== 'number'
      || !('firstStderrAt' in state) || typeof state.firstStderrAt !== 'number') throw new Error('Missing monotonic startup times');
    expect(state.firstStderrAt).toBeLessThan(state.elapsedMs);
    const rawProfile = /profile=("[^"\n]+")/.exec(child.stderr)?.[1];
    if (rawProfile === undefined) throw new Error('Missing owned profile');
    /** @type {unknown} */
    const profile = JSON.parse(rawProfile);
    if (typeof profile !== 'string' || !profile.startsWith(resolve('tmp/escape-control-'))) throw new Error('Foreign profile');
    expect(existsSync(profile)).toBe(false);
  } finally {rmSync(root, {recursive: true, force: true});}
});

/** The delivery child, each delay in turn on one profile: a 650 ms block drains, a 5.1 s block outlives the 5 s drain. */
function startDelivery() {
  const profile = mkdtempSync(resolve('tmp/native-inventory-delivery-'));
  const program = `import{spawn}from'node:child_process';import{once}from'node:events';import{rmSync,existsSync}from'node:fs';
      const{drainNativeBrowser}=await import(process.argv[1]),profile=process.argv[2];
      const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','inherit']});
      let stopping;const stop=()=>stopping??=(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}})();
      process.once('SIGTERM',()=>{void stop().then(()=>process.exit(143));});
      let facts;
      try{await once(child.stdout,'data');let disposed=false,failure=null;
      const pending=drainNativeBrowser(child,()=>child.kill('SIGTERM'),async()=>{rmSync(profile,{recursive:true});disposed=true;});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(process.argv[3]));
      try{await pending;}catch(error){failure=String(error);}
      facts={disposed,profile:existsSync(profile),failure};
      }finally{await stop();}
      console.log(JSON.stringify({...facts,childStopped:child.exitCode!==null||child.signalCode!==null}));`;
  const runs = (async () => {
    const results = [];
    for (const delay of [650, 5100]) {
      mkdirSync(profile, {recursive: true});
      results.push({delay, result: await runChild(['--input-type=module', '-e', program,
        new URL('../../fixtures/native-browser-drain.mjs', import.meta.url).href, profile, String(delay)], 10_000)});
    }
    return results;
  })();
  return {profile, runs};
}

test('delayed JS delivery cannot discard a completed native inventory', async () => {
  if (deliveryRun === undefined) throw new Error('Missing delivery child');
  const {profile} = deliveryRun;
  let verified = false;
  try {
    for (const {delay, result} of await deliveryRun.runs) {
      expect(result.status).toBe(0);
      if (delay === 650) expect(JSON.parse(result.stdout)).toEqual({disposed: true, profile: false, failure: null, childStopped: true});
      else expect(JSON.parse(result.stdout)).toEqual({disposed: false, profile: true, failure: expect.stringContaining('did not drain in 5000ms'), childStopped: true});
    }
    verified = true;
  } finally {
    if (verified) rmSync(profile, {recursive: true, force: true});
    else console.error(`Native delivery control retained after refusal: ${JSON.stringify(profile)}`);
  }
}, 10_000);
