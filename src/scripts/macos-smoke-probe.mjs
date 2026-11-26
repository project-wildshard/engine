#!/usr/bin/env node
// TS19: independent observations of the stock Ring 1 proof, never a replacement CI gate.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scratchDir } from './.kit/scratch-dir.mjs';
import { servedSlug } from './server-release/served-slug.mjs';

/** @typedef {{code:number|null,signal:NodeJS.Signals|null,timedOut:boolean,cancelled:boolean,error:string|null,wallMs:number}} CommandResult */
/** @typedef {{mode:string,shard:string,developer:unknown,elapsedMs:number,gameplayFrames:{initial:number,final:number},faults:unknown[],fatal:unknown[],renderer:{renderer:string,unmaskedRenderer?:string|null,lost:unknown}}} SmokeCase */
/** @typedef {{schema:string,error:string|null,cancelled:string|null,expected:unknown[],cases:SmokeCase[]}} RendererReport */

/** @param {string} out @param {string} report @param {string} [platform] @param {string} [buildRoot] */
export function stockProofCommand(out, report, platform, buildRoot) {
  const target = platform ?? process.platform;
  if (!['darwin', 'linux'].includes(target)) throw new Error('Unsupported probe platform');
  return [process.execPath, 'src/scripts/parity/boot-smoke.mjs', '--case-group=developer', '--jobs=1',
    `--out=${out}`, `--angle=${target === 'darwin' ? 'metal' : 'swiftshader'}`, `--renderer-report=${report}`,
    ...(buildRoot === undefined ? [] : [`--build-root=${buildRoot}`])];
}

/** Hosted admission is duplicated at the workflow boundary; local Mac observations remain possible.
 * @param {NodeJS.ProcessEnv} env */
export function hostedAdmission(env) {
  if (env.GITHUB_ACTIONS !== 'true') return 'local';
  if (env.GITHUB_REPOSITORY !== 'project-wildshard/engine' || env.WS_SMOKE_VISIBILITY !== 'public') throw new Error('Probe needs the public engine repository');
  if (!['macOS', 'Linux'].includes(env.RUNNER_OS ?? '') || !['macos-15', 'ubuntu-latest'].includes(env.WS_SMOKE_RUNNER ?? '')) throw new Error('Probe needs a standard Mac or Linux runner');
  return 'standard-public';
}

/** Original-case evidence and process status must both qualify. Slow success remains distinct.
 * @param {CommandResult} exit @param {RendererReport|null} report @param {readonly string[]} products */
export function smokeVerdict(exit, report, products) {
  const failed = (/** @type {string} */ reason) => ({ verdict: 'failed', reason });
  if (exit.code !== 0 || exit.signal !== null || exit.timedOut || exit.cancelled || exit.error !== null) return failed('proof command failed');
  if (!report || report.schema !== 'macos-smoke-renderers/1' || report.error !== null || report.cancelled !== null ||
    !Array.isArray(report.cases) || !Array.isArray(report.expected) || products.length === 0 || new Set(products).size !== products.length) return failed('missing complete original case evidence');
  const servedProducts = products.map(servedSlug);
  if (new Set(servedProducts).size !== products.length) return failed('duplicate served product identity');
  const expected = servedProducts.map(shard => JSON.stringify(['standalone', shard, true])).sort();
  if (JSON.stringify(report.expected.map(row => JSON.stringify(row)).sort()) !== JSON.stringify(expected)) return failed('built catalogue differs from pinned proof identity');
  const seen = new Set();
  for (const row of report.cases) {
    if (row?.mode !== 'standalone' || !servedProducts.includes(row.shard) || seen.has(row.shard) || row.developer !== true ||
      !Number.isFinite(row.elapsedMs) || row.elapsedMs <= 0 || !Number.isFinite(row.gameplayFrames?.initial) || !Number.isFinite(row.gameplayFrames?.final) ||
      row.gameplayFrames.final < row.gameplayFrames.initial + 10 || !Array.isArray(row.faults) || row.faults.length > 0 || !Array.isArray(row.fatal) || row.fatal.length > 0 ||
      typeof row.renderer?.renderer !== 'string' || !row.renderer.renderer || row.renderer.lost !== false) return failed('invalid original gameplay/renderer evidence');
    seen.add(row.shard);
  }
  if (seen.size !== products.length || !Number.isFinite(exit.wallMs) || exit.wallMs <= 0) return failed('incomplete proof or invalid wall');
  return { verdict: 'passed', under60Seconds: exit.wallMs <= 60000,
    renderers: [...new Set(report.cases.map(row => row.renderer.unmaskedRenderer ?? row.renderer.renderer))] };
}

/** The cooperative child owns its detached preview and browser. On timeout, TERM lets its finally drain;
 * KILL is a bounded fallback and can never qualify. Logs are retained even on failed launch.
 * @param {string[]} command
 * @param {{cwd:string,env?:NodeJS.ProcessEnv,log:string,timeoutMs?:number,killAfterMs?:number}} options
 * @returns {Promise<CommandResult>} */
export function runCommand(command, { cwd, env = process.env, log, timeoutMs = 600000, killAfterMs = 10000 }) {
  const started = performance.now(), fd = openSync(log, 'wx');
  return new Promise(resolve => {
    /** @type {ReturnType<typeof spawn>|undefined} */ let child;
    let timedOut = false, cancelled = false;
    /** @type {string|null} */ let error = null;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let escalation;
    const stop = (/** @type {NodeJS.Signals} */ signal) => {
      if (child?.exitCode === null && child.signalCode === null) {
        child.kill(signal);
        escalation ??= setTimeout(() => { if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, killAfterMs);
      }
    };
    const interrupt = () => { cancelled = true; stop('SIGINT'); }, terminate = () => { cancelled = true; stop('SIGTERM'); };
    const timer = setTimeout(() => { timedOut = true; stop('SIGTERM'); }, timeoutMs);
    const finish = (/** @type {number|null} */ code, /** @type {NodeJS.Signals|null} */ signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); closeSync(fd);
      resolve({ code, signal, timedOut, cancelled, error, wallMs: performance.now() - started });
    };
    try { child = spawn(command[0], command.slice(1), { cwd, env, stdio: ['ignore', fd, fd] }); }
    catch (caught) { error = String(caught); finish(null, null); return; }
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', caught => { error = String(caught); }); child.once('close', finish);

  });
}

/** @param {string} path */
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
const IDENTITY_FILES = ['src/scripts/parity/boot-smoke.mjs', 'src/scripts/parity/pool.mjs', 'src/scripts/parity/lane-browser.mjs',
  'src/scripts/parity/serve.mjs', 'src/scripts/ring1.sh', 'src/scripts/macos-smoke-probe.mjs', 'pnpm-lock.yaml',
  'test/pins/shardfiles.json', 'test/pins/rings.json', 'test/pins/slices.json', 'src/scripts/server-release/served-slug.mjs'];
/** @param {string} root */
export function proofIdentity(root) {
  const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Probe requires committed source');
  const sha = git(['rev-parse', 'HEAD']);
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_SHA !== sha) throw new Error('Checkout is not the workflow SHA');
  return { sha, files: Object.fromEntries(IDENTITY_FILES.map(file => [file, digest(join(root, file))])),
    products: /** @type {{'1':{products:string[]}}} */ (JSON.parse(readFileSync(join(root, 'test/pins/rings.json'), 'utf8')))['1'].products };
}

/** @param {string} file @param {unknown} value */
function writeJson(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
/** @param {string} file */
function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
/** @param {CommandResult} result */
function requireSuccess(result) {
  if (result.code !== 0 || result.signal !== null || result.timedOut || result.cancelled || result.error !== null) throw new Error(`Command failed: ${JSON.stringify(result)}`);
}

async function main() {
  const root = resolvePath(import.meta.dirname, '..', '..'), admission = hostedAdmission(process.env), identity = proofIdentity(root);
  const out = scratchDir('macos-smoke-probe', 'TS19 original Ring 1 smoke observation', { root });
  const env = { ...process.env, WILDSHARD_RING: '1', WS_PREVIOUS_DEPLOY_OPTIONAL: '1' };
  const mode = process.argv[2];
  if (mode !== 'prepare' && mode !== 'observe') throw new Error('usage: macos-smoke-probe.mjs prepare|observe');
  const started = performance.now();
  const context = { admission, platform: process.platform, arch: process.arch, node: process.version,
    runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    job: process.env.GITHUB_JOB ?? null, runner: process.env.WS_SMOKE_RUNNER ?? 'local', sample: process.env.WS_SMOKE_SAMPLE ?? 'local',
    setupMs: process.env.WS_SMOKE_SETUP_STARTED_MS ? Date.now() - Number(process.env.WS_SMOKE_SETUP_STARTED_MS) : null };
  /** @type {Record<string, CommandResult>} */ const stages = {};
  const run = async (/** @type {string} */ name, /** @type {string[]} */ command) => {
    const result = await runCommand(command, { cwd: root, env, log: join(out, `${name}.log`) }); stages[name] = result; requireSuccess(result);
  };
  const archive = join(out, 'products.tar'), producerFile = join(out, 'producer.json');
  if (mode === 'prepare') {
    /** @type {Record<string,unknown>} */ const producer = { schema: 'macos-smoke-products/1', identity, context, stages, error: null };
    try {
      await run('pins', [process.execPath, 'src/scripts/pins.ts', 'install', '--ring', '1']);
      await run('cook', [process.execPath, 'src/scripts/ring-cook.mjs', '--out', join(out, 'cook')]);
      await run('step', [process.execPath, '--no-warnings', 'src/scripts/ring-step.ts', '--report', join(out, 'step.json')]);
      await run('build', ['pnpm', 'build:ring']);
      const trees = ['dist', 'dist-content'].filter(tree => existsSync(join(root, tree)));
      await run('archive', ['tar', '-cf', archive, ...trees]);
      producer.archiveSha256 = digest(archive); producer.version = readJson(join(root, 'dist/version.json'));
      producer.wallMs = performance.now() - started;
    } catch (error) { producer.error = String(error); throw error; }
    finally { writeJson(producerFile, producer); }
    return;
  }
  const rendererFile = join(out, 'renderers.json');
  /** @type {Record<string,unknown>} */ const observation = { schema: 'macos-smoke-observation/1', identity, context, stages, error: null, verdict: 'failed' };
  try {
    const producer = readJson(producerFile);
    if (producer.schema !== 'macos-smoke-products/1' || producer.error !== null || JSON.stringify(producer.identity) !== JSON.stringify(identity) || producer.archiveSha256 !== digest(archive)) throw new Error('Producer/archive provenance does not match this exact source and pins');
    observation.producer = producer;
    // Pin installation can already publish dist-content. Serve only this
    // archive's fresh owned tree; leave those existing outputs untouched.
    const restored = join(out, 'restored');
    if (existsSync(restored)) throw new Error('Observation requires an empty restored destination');
    mkdirSync(restored);
    await run('restore', ['tar', '-xf', archive, '-C', restored]);
    if (JSON.stringify(readJson(join(restored, 'dist/version.json'))) !== JSON.stringify(producer.version)) throw new Error('Restored build identity differs');
    const command = stockProofCommand(join(out, 'boot'), rendererFile, process.platform, restored); observation.command = command;
    const proof = await runCommand(command, { cwd: root, env, log: join(out, 'proof.log') }); stages.proof = proof;
    const report = existsSync(rendererFile) ? readJson(rendererFile) : null; observation.renderers = report;
    Object.assign(observation, smokeVerdict(proof, report, identity.products));
    if (observation.verdict !== 'passed') throw new Error(`Stock proof did not qualify: ${String(observation.reason)}`);
  } catch (error) { observation.error = String(error); throw error; }
  finally { observation.wallMs = performance.now() - started; writeJson(join(out, 'observation.json'), observation); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) await main();
