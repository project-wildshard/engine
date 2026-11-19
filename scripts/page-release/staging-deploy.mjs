// J434: stage the checked build, exercise the existing proofs and write one deploy decision.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { readPublication } from '../server-release/sign.mjs';
import { worstFirst } from '../staging-smoke/checks.mjs';
import { CHANNELS, RELEASE_PUBLIC_KEY, RefusedError, localQaGap, qaGap } from './flow.mjs';

const stage = CHANNELS.staging;
const scripts = absolute(import.meta.dirname, '..');
const toolsRoot = absolute(scripts, '..');
const observerFile = 'mmo-observer.json';
/** @typedef {import('./flow.mjs').QaVerdict & {findings?: readonly import('../staging-smoke/checks.mjs').Finding[]}} DeploymentQa */
/** @typedef {{status?:string,reason?:string,continuity?:string,to?:{build?:string,serial?:number}}} Observation */
const read = (/** @type {string} */ path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
const write = (/** @type {string} */ path, /** @type {unknown} */ body) => writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });

/** A retry after a harness kept sending the retired wire can resume from an owned, exact capture.
 * @param {string} root @param {string} path @param {Observation|undefined} observed @returns {Observation|undefined} */
function resumedObservation(root, path, observed) {
  if (observed?.reason !== 'reconnect-budget' || !existsSync(path)) return observed;
  const recovery = read(join(root, 'mmo-reload.json'));
  /** @type {{moved:boolean,laterCheckpoint:boolean,sameShard:boolean,ledgerKept:boolean,coinsKept:boolean}[]|undefined} */
  const comparisons = recovery?.recovery?.comparisons;
  const prior = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (recovery?.recovery?.baselineSha256 !== prior || recovery?.recovery?.kind !== 'exact-client-after-reload' ||
    observed.to?.build !== recovery.recovery.clientBuild || observed.to?.serial !== recovery.to?.serial ||
    !Array.isArray(comparisons) || comparisons.length !== 2 ||
    !comparisons.every(row => row.moved && row.laterCheckpoint && row.sameShard && row.ledgerKept && row.coinsKept)) return observed;
  return recovery;
}

/** @param {{ file: string, args: string[], cwd: string, out: string, name: string, observe?: (row: {phase?:string,report?:string}) => void }} job */
function start({ file, args, cwd, out, name, observe }) {
  const log = openSync(join(out, `${name}.log`), 'w', 0o600);
  const child = spawn(file, args, { cwd, env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', log] });
  if (child.stdout === null) {
    child.kill();
    closeSync(log);
    throw new Error(`Could not open ${name}'s output`);
  }
  const lines = createInterface({ input: child.stdout });
  /** @type {unknown} */ let failure;
  child.once('error', error => { failure = error; });
  lines.on('line', line => {
    writeSync(log, `${line}\n`);
    if (observe !== undefined && line.startsWith('{')) {
      try { observe(JSON.parse(line)); } catch { /* Unstructured output remains in the log. */ }
    }
  });
  const done = new Promise(resolve => {
    child.once('close', code => { lines.close(); closeSync(log); resolve(failure === undefined ? code : null); });
  });
  return { done, stop: () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); } };
}

/** @param {{ root:string, out:string, shared:string }} options */
function observeMove({ root, out, shared }) {
  /** @type {((value: boolean) => void) | undefined} */ let ready;
  /** @type {Promise<boolean>} */
  const baseline = new Promise(resolve => { ready = resolve; });
  const job = start({ file: process.execPath, args: ['--import', join(scripts, 'bake-loader.mjs'),
    join(scripts, 'mmo-release-observer.mjs'), 'staging', '--seconds', '3600', '--work-dir', shared], cwd: toolsRoot, out, name: 'mmo',
    observe: row => {
      if (row.phase === 'baseline-playing') ready?.(true);
      if (typeof row.report === 'string' && absolute(row.report).startsWith(`${shared}/`)) {
        const report = read(row.report);
        if (report !== undefined) write(join(root, observerFile), report);
      }
    } });
  return { ...job, baseline: async () => {
    const controller = new AbortController();
    try {
      const armed = await Promise.race([baseline, job.done.then(() => false), delay(240_000, false, { signal: controller.signal })]);
      if (!armed) throw new RefusedError('The MMO observer did not seat both baseline bots with durable checkpoints');
    } finally { controller.abort(); }
  } };
}

/** @param {{ root:string, out:string, build:string, release:string, name:string, candidate?:string, deploy:boolean }} options */
async function runQa({ root, out, build, release, name, candidate, deploy }) {
  const dir = join(out, name);
  const job = start({ file: 'bash', args: [join(scripts, 'browser-lane.sh'), '--max', '20', process.execPath,
    join(scripts, 'staging-qa.mjs'), '--root', root, '--build', build, '--release', release, '--out', dir,
    ...(candidate === undefined ? ['--url', stage.origin] : ['--candidate', candidate]), ...(deploy ? ['--deploy-checks'] : [])],
  cwd: toolsRoot, out, name });
  const code = await job.done, path = join(dir, 'verdict.json'), result = read(path);
  if (result === undefined || (code !== 0 && result.hold !== true)) throw new RefusedError(`${name} did not produce its QA verdict`);
  renameSync(path, join(dir, 'leg.json'));
  return result;
}

/** @param {{ root:string, build:string, release:string, source:string, out:string, observerProof?:string,
 * localQa?:import('./flow.mjs').QaVerdict, readState:() => any, get:(url:string) => Promise<any>,
 * phase:(name:import('./flow.mjs').Phase, qa?:import('./flow.mjs').QaVerdict) => Promise<unknown>, log:(line:string)=>void }} opts */
export async function deployStaging({ root, build, release, source, out, observerProof, localQa, readState, get, phase, log }) {
  const reportPath = join(out, 'verdict.json'), shared = join(toolsRoot, 'tmp', 'staging-observer'), observerRoot = join(root, 'tmp', 'staging-deploy', build);
  if (existsSync(reportPath)) throw new RefusedError('Choose a fresh staging deploy evidence directory');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  mkdirSync(observerRoot, { recursive: true, mode: 0o700 });
  const observedPath = join(observerRoot, observerFile);
  /** @type {ReturnType<typeof observeMove>|undefined} */ let running;
  /** @type {DeploymentQa|undefined} */ let qa;
  /** @type {DeploymentQa|undefined} */ let live;
  /** @type {Observation|undefined} */ let observation;
  let aliasMoved = false;
  let step = 'local QA';
  /** @type {import('../staging-smoke/checks.mjs').Finding|undefined} */ let observerNote;
  const record = (/** @type {string|undefined} */ problem) => {
    /** @type {import('../staging-smoke/checks.mjs').Finding[]} */
    const findings = [...(qa?.findings ?? []), ...(live?.findings ?? [])];
    if (observerNote !== undefined) findings.push(observerNote);
    if (problem !== undefined) findings.push({ scenario: step, key: 'deploy', severity: 'P1', source: 'check', text: problem });
    findings.sort(worstFirst);
    const hold = findings.some(row => row.severity === 'P0' || row.severity === 'P1');
    write(reportPath, { ...(live ?? qa), build, release, status: hold ? 'hold' : 'pass', hold, worst: findings[0]?.severity ?? 'none', findings,
      aliasMoved, deploy: { local: localQa?.build, qualification: qa, live, observation } });
  };
  try {
    const gap = localQaGap(localQa, source, release);
    if (gap !== undefined) throw new RefusedError(`staging go-live needs --local-qa=<verdict.json>: ${gap}`);
    const page = await get(`${stage.origin}/version.json`), alreadyLive = page.build === build;
    if (!alreadyLive && observerProof !== undefined) throw new RefusedError('External observer evidence is for verifying an already live release');
    observation = read(observerProof ?? observedPath);
    step = 'MMO observer';
    if (!alreadyLive && observation === undefined) {
      const signed = readPublication(JSON.stringify(await get(stage.release)), RELEASE_PUBLIC_KEY);
      if (signed.engineBuild === build) throw new RefusedError('Start staging go-live before the signed rooms change, so the observer can seat its baseline');
      running = observeMove({ root: observerRoot, out, shared });
      await running.baseline();
    }
    if (!alreadyLive) {
      step = 'page upload';
      if (readState().upload === undefined) await phase('upload');
      step = 'signed candidate';
      if (readState().check === undefined) {
        const signed = readPublication(JSON.stringify(await get(stage.release)), RELEASE_PUBLIC_KEY);
        if (signed.engineBuild !== build) {
          const signer = start({file: 'gh', args: ['workflow', 'run', 'server-release.yml', '--ref', 'main', '-f', `build=${build}`], cwd: root, out, name: 'sign'});
          await signer.done; // The exact hosted-CI admission also invokes the signer automatically.
        }
        await phase('check');
      }
    }
    step = 'deploy smoke';
    const candidate = alreadyLive ? undefined : readState().check.deployment.url;
    qa = await runQa({ root, build, release, out, name: 'qualification', ...(candidate === undefined ? {} : { candidate }), deploy: true });
    const bad = qaGap(qa, build);
    if (bad !== undefined) throw new RefusedError(bad);
    step = 'MMO observer';
    if (running !== undefined) {
      const controller = new AbortController();
      try {
        const finished = await Promise.race([running.done.then(() => true), delay(300_000, false, { signal: controller.signal })]);
        if (!finished) throw new RefusedError('MS9 did not finish within five minutes of the signed rooms check');
      } finally { controller.abort(); }
    }
    observation ??= read(observedPath);
    observation = resumedObservation(observerRoot, observedPath, observation);
    const serial = alreadyLive ? (await get(stage.health)).serial : readState().check.serial;
    const exact = observation?.to?.build === build && observation.to.serial === serial;
    const restored = observation?.status === 'observed' && observation.continuity === 'restored';
    const changed = observation?.status === 'inconclusive' && observation.reason === 'checkpoint-progress-changed';
    if (!exact || (!restored && !changed)) {
      throw new RefusedError('MS9 has no passing continuity witness for the exact signed staging rooms');
    }
    if (changed) observerNote = {scenario: 'MMO observer', key: 'checkpoint-progress-changed', severity: 'P2', source: 'check',
      text: 'Both observers returned with newer saves and retained coins and ledger. A progress hash changed between the captures.'};
    if (!alreadyLive) {
      step = 'alias';
      await phase('go-live', qa);
      aliasMoved = true;
      step = 'live smoke';
      live = await runQa({ root, build, release, out, name: 'live', deploy: false });
      const missed = qaGap(live, build);
      if (missed !== undefined) throw new RefusedError(missed);
    }
    record(undefined);
    log(`staging go-live PASS ${release} ${build.slice(0,8)} rooms/${serial} (${reportPath})`);
  } catch (error) {
    if (step === 'alias' && !aliasMoved) aliasMoved = (await get(`${stage.origin}/version.json`).catch(() => undefined))?.build === build;
    record(error instanceof RefusedError ? error.message : `${step} failed`);
    log(`staging go-live HOLD ${release} ${build.slice(0,8)} (${reportPath})`);
    throw error;
  } finally {
    running?.stop();
    await running?.done;
  }
}
