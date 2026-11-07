import {test, expect} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The original trusted-input assertion must execute in a real, leased browser and isolated child.
import {execFileSync, spawnSync, spawn} from 'node:child_process';

// oxlint-disable-next-line import/no-nodejs-modules -- Own the bounded startup-refusal executable under repository scratch.
import {mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, realpathSync} from 'node:fs';
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

test('the original native startup deadline retains process and endpoint-file facts without accepting an unannounced endpoint', () => {
  const root = mkdtempSync(resolve('tmp/native-endpoint-refusal-'));
  try {
    const binary = resolve(root, 'native-no-endpoint.mjs');
    writeFileSync(binary, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';
      const arg=process.argv.find(value=>value.startsWith('--user-data-dir='));
      if(!arg)throw Error('Missing owned profile');
      writeFileSync(arg.slice('--user-data-dir='.length)+'/DevToolsActivePort','9\\n/devtools/browser/diagnostic-only\\n');
      console.error('Original no-endpoint sentinel');setInterval(()=>{},1000);`, {mode: 0o700});
    const child = spawnSync(process.execPath, ['--experimental-transform-types', 'test/fixtures/native-browser-escape.ts'],
      {encoding: 'utf8', timeout: 25_000, env: {...process.env, CHROME_PATH: binary}});
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
    await drainNativeBrowser(child, () => {child.kill('SIGTERM');}, async () => {
      expect(child.exitCode).toBe(0);
      const table = execFileSync('ps', ['-axo', 'pid=,stat='], {encoding: 'utf8'});
      const live = table.split('\n').map(line => line.trim().split(/\s+/u))
        .find(([pid, state]) => Number(pid) === writerPid && !state?.startsWith('Z'));
      expect(live).toBeUndefined();
      await rm(profile, {recursive: true}); disposed = true;
    });
    expect(disposed).toBe(true);
    expect(parentExitedWithWriter).toBe(true);
    expect(existsSync(profile)).toBe(false);
  } finally {
    for (const pid of [writerPid, child.pid]) stopFixturePid(pid);
    rmSync(profile, {recursive: true, force: true});
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
