import { afterEach, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real process/preview lifetime controls.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixtures stay under this run's scratch root.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Child fixture imports the maintained server owner.
import { pathToFileURL } from 'node:url';
import { hostedAdmission, runCommand, smokeVerdict, stockProofCommand } from '../scripts/macos-smoke-probe.mjs';
import { previewReady, serve } from '../scripts/parity/serve.mjs';
import { gameplayRenderer } from '../scripts/parity/boot-smoke.mjs';

const roots: string[] = [];
function scratch() {
  const base = resolve(process.env['VITEST_TMP_ROOT'] ?? 'tmp/vitest', 'macos-smoke-probe');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'case-')); roots.push(dir); return dir;
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const products = ['brasscap-mesa', 'sunscar-dunes', 'far-reach'];
const exit = { code: 0, signal: null, timedOut: false, cancelled: false, error: null, wallMs: 1000 };
function report() {
  const served = ['brasscap-mesa', 'sunscar-dunes', 'far-reach'];
  return { schema: 'macos-smoke-renderers/1', cancelled: null, error: null,
    expected: served.map(shard => ['standalone', shard, true]),
    cases: served.map(shard => ({ mode: 'standalone', shard, developer: true, elapsedMs: 1000,
      gameplayFrames: { initial: 5, final: 15 }, faults: [] as string[], fatal: [] as string[],
      renderer: { renderer: 'fixture renderer', unmaskedRenderer: 'fixture backend', lost: false } })) };
}

test('the stock proof keeps developer cases, one browser and the measured platform backend', () => {
  for (const platform of ['darwin', 'linux']) {
    const command = stockProofCommand('owned/boot', 'owned/renderers.json', platform);
    expect(command.slice(0, 5)).toEqual([process.execPath, 'src/scripts/parity/boot-smoke.mjs', '--case-group=developer', '--jobs=1', '--out=owned/boot']);
    expect(command).toContain(`--angle=${platform === 'darwin' ? 'metal' : 'swiftshader'}`);
  }
  expect(() => stockProofCommand('x', 'y', 'win32')).toThrow();
  expect(stockProofCommand('x', 'y', 'darwin', 'owned/restored')).toContain('--build-root=owned/restored');
});

test('hosted admission refuses private, incomplete and nonstandard runner context before launch', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'project-wildshard/engine', WS_SMOKE_VISIBILITY: 'public', RUNNER_OS: 'macOS', WS_SMOKE_RUNNER: 'macos-15' };
  expect(hostedAdmission(env)).toBe('standard-public');
  for (const patch of [{ WS_SMOKE_VISIBILITY: 'private' }, { WS_SMOKE_VISIBILITY: undefined }, { GITHUB_REPOSITORY: 'other/engine' }, { WS_SMOKE_RUNNER: 'macos-large' }, { RUNNER_OS: 'Windows' }]) expect(() => hostedAdmission({ ...env, ...patch })).toThrow();
  expect(hostedAdmission({})).toBe('local');
});

test('printed success, missing/foreign cases, lost GL and failed process status cannot qualify', () => {
  expect(smokeVerdict(exit, report(), products)).toMatchObject({ verdict: 'passed', under60Seconds: true });
  expect(smokeVerdict({ ...exit, wallMs: 60001 }, report(), products)).toMatchObject({ verdict: 'passed', under60Seconds: false });
  for (const patch of [{ code: 7 }, { signal: 'SIGTERM' as const }, { timedOut: true }, { cancelled: true }, { error: 'spawn failed' }, { wallMs: NaN }]) expect(smokeVerdict({ ...exit, ...patch }, report(), products).verdict).toBe('failed');
  expect(smokeVerdict(exit, null, products).verdict).toBe('failed');
  expect(smokeVerdict(exit, report(), [...products, 'driftwood-isle']).verdict).toBe('failed');
  expect(smokeVerdict(exit, { ...report(), expected: products.slice(1).map(shard => ['standalone', shard, true]) }, products).verdict).toBe('failed');
  const first = report().cases[0], third = report().cases[2];
  if (!first || !third) throw new Error('Missing fixture cases');
  const badReports = [
    { ...report(), error: 'actual failure' }, { ...report(), cancelled: 'SIGTERM' },
    { ...report(), cases: report().cases.slice(1) }, { ...report(), expected: [] },
    { ...report(), cases: [first, first, third] },
    { ...report(), cases: report().cases.map(row => ({ ...row, fatal: ['actual fatal'] })) },
    { ...report(), cases: report().cases.map(row => ({ ...row, gameplayFrames: { initial: 5, final: 14 } })) },
    { ...report(), cases: report().cases.map(row => ({ ...row, renderer: { ...row.renderer, lost: true } })) },
  ];
  for (const value of badReports) expect(smokeVerdict(exit, value, products).verdict).toBe('failed');
});

test('the renderer comes from the actual world context and retains unsupported debug capability', () => {
  const previous = globalThis.window;
  const gl = { RENDERER: 1, VENDOR: 2, VERSION: 3,
    getExtension: () => null, getParameter: (key: number) => `actual ${key}`, isContextLost: () => false };
  try {
    Object.defineProperty(globalThis, 'window', { value: { __wildshard: { requireWorld: () => ({ game: { renderer: { getContext: () => gl } } }) } }, configurable: true });
    expect(gameplayRenderer()).toEqual({ renderer: 'actual 1', vendor: 'actual 2', version: 'actual 3', unmaskedRenderer: null, unmaskedVendor: null, lost: false });
  } finally { Object.defineProperty(globalThis, 'window', { value: previous, configurable: true }); }
});

test('actual command failure, launch failure and timeout remain failures with raw logs', async () => {
  const cwd = scratch();
  const failed = await runCommand([process.execPath, '-e', 'console.log("gameplay PASS");process.exit(7)'], { cwd, log: join(cwd, 'failure.log'), timeoutMs: 3000 });
  expect(failed.code).toBe(7); expect(readFileSync(join(cwd, 'failure.log'), 'utf8')).toContain('gameplay PASS');
  const missing = await runCommand([join(cwd, 'no-command')], { cwd, log: join(cwd, 'launch.log'), timeoutMs: 3000 });
  expect(missing.error).toContain('ENOENT'); expect(smokeVerdict(missing, report(), products).verdict).toBe('failed');
  const timed = await runCommand([process.execPath, '-e', 'setInterval(()=>{},1000)'], { cwd, log: join(cwd, 'timeout.log'), timeoutMs: 100, killAfterMs: 1000 });
  expect(timed.timedOut).toBe(true); expect(timed.signal).toBe('SIGTERM');
});

test('the maintained preview owner closes and reaps its actual detached HTTP server on abort', async () => {
  const cwd = scratch(); mkdirSync(join(cwd, 'dist'));
  writeFileSync(join(cwd, 'dist/version.json'), '{}');
  const controller = new AbortController();
  const preview = await serve(cwd, '', true, { signal: controller.signal, telemetryDir: join(cwd, 'telemetry') });
  expect(await previewReady(`${preview.url}/version.json`)).toBe(true);
  controller.abort(new Error('fixture cancellation')); preview.close(); await preview.closed;
  expect(await previewReady(`${preview.url}/version.json`, 200)).toBe(false);
  preview.close(); await preview.closed;
});

test('a timed command cooperatively reaps the maintained detached preview before writing its exit', async () => {
  const cwd = scratch(); mkdirSync(join(cwd, 'dist')); writeFileSync(join(cwd, 'dist/version.json'), '{}');
  const source = pathToFileURL(resolve('src/scripts/parity/serve.mjs')).href;
  writeFileSync(join(cwd, 'owner.mjs'), `import {serve} from ${JSON.stringify(source)};import {writeFileSync} from 'node:fs';
const controller=new AbortController();process.once('SIGTERM',()=>controller.abort(new Error('timed out')));
const preview=await serve(process.cwd(),'',true,{signal:controller.signal,telemetryDir:'telemetry'});
writeFileSync('ready',preview.url);await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));
preview.close(); await preview.closed;writeFileSync('reaped','yes');`);
  const timed = await runCommand([process.execPath, join(cwd, 'owner.mjs')], { cwd, log: join(cwd, 'owner.log'), timeoutMs: 1500, killAfterMs: 3000 });
  expect(timed).toMatchObject({ code: 0, timedOut: true }); expect(readFileSync(join(cwd, 'reaped'), 'utf8')).toBe('yes');
  expect(await previewReady(`${readFileSync(join(cwd, 'ready'), 'utf8')}/version.json`, 200)).toBe(false);
  expect(smokeVerdict(timed, report(), products).verdict).toBe('failed');
});
