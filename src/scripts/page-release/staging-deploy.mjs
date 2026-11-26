// J434: stage the checked build, exercise the existing proofs and write one deploy decision.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { readPublication } from '../server-release/sign.mjs';
import { worstFirst } from '../staging-smoke/checks.mjs';
import { CHANNELS, RELEASE_PUBLIC_KEY, RefusedError, localQaGap, qaGap, zoneEntryGap } from './flow.mjs';
import { keepReleaseProof, openReleaseRun } from '../release-run.mjs';

const stage = CHANNELS.staging;
const scripts = absolute(import.meta.dirname, '..');
// The repository root: the lean move (f928fdae2) put scripts in src/scripts, and `scripts/..` became src/, so v0.1.94's
// deploy scratch landed in an unignored src/tmp/ and staging refused its dirty release clone (QA 11-25 row 88).
export const toolsRoot = absolute(scripts, '..', '..');
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

/** @param {string} out @param {string} build @param {string} [resume] @returns {Promise<import('./flow.mjs').ZoneEntryProof | undefined>} */
async function runZoneEntry(out, build, resume) {
  const dir = join(out, 'zone-entry');
  const job = start({file:'bash', args:[join(scripts, 'browser-lane.sh'), '--max', '120', process.execPath,
    join(scripts, 'zone-entry-tour.mjs'), `--out=${dir}`, `--expected-build=${build}`,
    ...(resume === undefined ? [] : [`--zone-entry-resume=${resume}`])], cwd:toolsRoot, out, name:'zone-entry'});
  const code = await job.done, proof = read(join(dir, 'zone-entry.json'));
  if (code !== 0 && proof?.failure === undefined) {
    return {build, pass:false, failure:{from:'driftwood-isle', to:'far-reach', reason:'The browser did not complete the zone-entry smoke'}};
  }
  return proof;
}

/** @param {{ root:string, build:string, release:string, source:string, out:string, observerProof?:string, zoneEntryResume?:string,
 * localQa?:import('./flow.mjs').QaVerdict, readState:() => any, get:(url:string) => Promise<any>,
 * phase:(name:import('./flow.mjs').Phase, qa?:import('./flow.mjs').QaVerdict) => Promise<unknown>, log:(line:string)=>void,
 * waitPacks?:() => Promise<void> }} opts */
export async function deployStaging({ root, build, release, source, out, observerProof, zoneEntryResume, localQa, readState, get, phase, log, waitPacks }) {
  const reportPath = join(out, 'verdict.json');
  if (existsSync(reportPath)) throw new RefusedError('Choose a fresh staging deploy evidence directory');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const scratch = openReleaseRun(toolsRoot, 'deploy');
  const work = scratch.work, shared = join(work, 'observer');
  const observedPath = join(out, observerFile);
  /** @type {ReturnType<typeof observeMove>|undefined} */ let running;
  /** @type {DeploymentQa|undefined} */ let qa;
  /** @type {DeploymentQa|undefined} */ let live;
  /** @type {import('./flow.mjs').ZoneEntryProof|undefined} */ let zoneEntry;
  /** @type {Observation|undefined} */ let observation;
  let aliasMoved = false;
  let step = 'local QA';
  /** @type {import('../staging-smoke/checks.mjs').Finding|undefined} */ let observerNote;
  const noteObserver = (/** @type {string} */ key, /** @type {string} */ text) => {
    observerNote = {scenario: 'MMO observer', key, severity: 'P2', source: 'check', text};
    log(`MS9 NOTE ${text}`);
  };
  const record = (/** @type {string|undefined} */ problem) => {
    /** @type {import('../staging-smoke/checks.mjs').Finding[]} */
    const findings = [...(qa?.findings ?? []), ...(live?.findings ?? [])];
    if (observerNote !== undefined) findings.push(observerNote);
    if (problem !== undefined) findings.push({ scenario: step, key: 'deploy', severity: 'P1', source: 'check', text: problem });
    findings.sort(worstFirst);
    const hold = findings.some(row => row.severity === 'P0' || row.severity === 'P1');
    // QA 11-25 row 131: the content set this QA played, so production compares its own set's bytes with it.
    const contentBase = readState().build?.contentBase;
    write(reportPath, { ...(live ?? qa), build, release, status: hold ? 'hold' : 'pass', hold, worst: findings[0]?.severity ?? 'none', findings,
      aliasMoved, ...(typeof contentBase === 'string' ? { contentBase } : {}),
      deploy: { local: localQa?.build, qualification: qa, live, observation, zoneEntry } });
  };
  try {
    const gap = localQaGap(localQa, source, release);
    if (gap !== undefined) throw new RefusedError(`staging go-live needs --local-qa=<verdict.json>: ${gap}`);
    const page = await get(`${stage.origin}/version.json`), alreadyLive = page.build === build;
    if (!alreadyLive && zoneEntryResume !== undefined) throw new RefusedError('A zone-entry resume requires the build already live on staging');
    try {
      observation = read((alreadyLive ? observerProof : undefined) ?? observedPath);
      if (!alreadyLive && observation === undefined) {
        const signed = readPublication(JSON.stringify(await get(stage.release)), RELEASE_PUBLIC_KEY);
        if (signed.engineBuild === build) {
          noteObserver('rooms-already-switched', 'Signed rooms already changed before the observer could seat its baseline.');
        } else {
          running = observeMove({ root: out, out: work, shared });
          await running.baseline();
        }
      }
    } catch (error) {
      // Say why, and keep the observer's log: its scratch goes with this run (QA 11-25 row 120 hid for a day behind a bare note).
      const why = read(observedPath)?.reason ?? (error instanceof Error ? error.message : String(error));
      keepReleaseProof(work, out, ['mmo.log']);
      noteObserver('baseline-unavailable', `The staging observer could not arm or read its baseline (${why}; mmo.log kept).`);
    }
    if (!alreadyLive) {
      step = 'page upload';
      if (readState().upload === undefined) await phase('upload');
      step = 'signed candidate';
      if (readState().check === undefined) {
        const signed = readPublication(JSON.stringify(await get(stage.release)), RELEASE_PUBLIC_KEY);
        if (signed.engineBuild !== build) {
          const signer = start({file: 'gh', args: ['workflow', 'run', 'server-release.yml', '--ref', 'main', '-f', `build=${build}`], cwd: root, out: work, name: 'sign'});
          await signer.done; // The exact hosted-CI admission also invokes the signer automatically.
        }
        await phase('check');
      }
    }
    // FR-A19: never tour a build mid-recook (v0.1.89 and v0.1.90 held on 404 packs); wait, bounded, for every staging head.
    if (waitPacks !== undefined) {
      step = 'packs';
      await waitPacks();
    }
    step = 'deploy smoke';
    const candidate = alreadyLive ? undefined : readState().check.deployment.url;
    qa = await runQa({ root, build, release, out: work, name: 'qualification', ...(candidate === undefined ? {} : { candidate }), deploy: true });
    keepReleaseProof(work, out, ['qualification/leg.json']);
    const bad = qaGap(qa, build);
    if (bad !== undefined) throw new RefusedError(bad);
    const serial = alreadyLive ? (await get(stage.health)).serial : readState().check.serial;
    /** @type {string|undefined} */ let liveProblem;
    if (!alreadyLive) {
      step = 'alias';
      await phase('go-live', qa);
      aliasMoved = true;
      step = 'live smoke';
      try {
        live = await runQa({ root, build, release, out: work, name: 'live', deploy: false });
        liveProblem = qaGap(live, build);
      } catch (error) {
        liveProblem = error instanceof RefusedError ? error.message : 'Live M3 did not complete';
      }
    }
    step = 'zone entry';
    zoneEntry = await runZoneEntry(work, build, zoneEntryResume);
    try {
      observation ??= read(observedPath);
      observation = resumedObservation(out, observedPath, observation);
      const exact = observation?.to?.build === build && observation.to.serial === serial;
      if (exact && observation?.status === 'observed' && observation.continuity === 'restored') {
        observerNote = undefined;
      } else if (exact && observation?.continuity === 'lost') {
        noteObserver('checkpoint-progress-lost', 'MS9 observed lost checkpoint progress after the staging rooms changed.');
      } else if (exact && observation?.status === 'inconclusive' && observation.reason === 'checkpoint-progress-changed') {
        noteObserver('checkpoint-progress-changed', 'Both observers returned with newer saves and retained coins and ledger. A progress hash changed between the captures.');
      } else if (observerNote === undefined) {
        noteObserver('continuity-unverified', 'MS9 did not verify checkpoint continuity for the signed staging rooms.');
      }
    } catch {
      noteObserver('report-unavailable', 'The staging observer report could not be read.');
    }
    const entryGap = zoneEntryGap(zoneEntry, build);
    if (entryGap !== undefined) throw new RefusedError(entryGap);
    if (liveProblem !== undefined) { step = 'live smoke'; throw new RefusedError(liveProblem); }
    record(undefined);
    log(`staging go-live PASS ${release} ${build.slice(0,8)} rooms/${serial} (${reportPath})`);
  } catch (error) {
    if (step === 'alias' && !aliasMoved) aliasMoved = (await get(`${stage.origin}/version.json`).catch(() => undefined))?.build === build;
    record(error instanceof RefusedError ? error.message : `${step} failed`);
    log(`staging go-live HOLD ${release} ${build.slice(0,8)} (${reportPath})`);
    throw error;
  } finally {
    try {
      running?.stop();
      await running?.done;
      keepReleaseProof(work, out, ['live/leg.json', 'zone-entry/zone-entry.json']);
    } finally { scratch.close(); }
  }
}
