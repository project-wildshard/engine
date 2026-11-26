// FS28: staging npm admission uses only exact CI and alias evidence.
import { provesCode } from './ci-proof-jobs.mjs';
import { releaseOnlyParent } from './release-gate.mjs';

export const trainSha = /^[a-f0-9]{40}$/u;
export const trainTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/** @param {number} id @param {() => Promise<void>} watch
 * @param {(id: number) => import('./release-train-proof.mjs').Run} readRun */
export async function watchTrainRun(id, watch, readRun) {
  // The watcher can lose its connection after Actions has finished the run.
  const watchError = await watch().catch((/** @type {unknown} */ error) => error);
  const run = readRun(id);
  if (run?.databaseId !== id || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`Actions run ${id} did not prove success`, { cause: watchError });
  }
  return run;
}

/** @param {import('./release-train-proof.mjs').Run} run @param {string} build */
export function provesNpmNext(run, build) {
  return run.workflowName === 'npm-publish' && run.event === 'workflow_dispatch' &&
    run.headBranch === 'main' && run.displayTitle === `npm next ${build}` &&
    run.jobs.some(job => job.name === 'publish' && job.status === 'completed' && job.conclusion === 'success');
}

/** @param {string} build @param {string} tag @param {number} ci
 * @param {import('./release-train-proof.mjs').Alias} [alias] @param {import('./release-train-proof.mjs').Leg} [candidate] */
export function nextAdmission(build, tag, ci, alias, candidate) {
  const serial = alias?.serial;
  if (!trainSha.test(build) || !trainTag.test(tag) || !Number.isSafeInteger(ci) || ci <= 0 ||
      alias?.build !== build || alias.channel !== 'staging' || typeof serial !== 'number' ||
      !Number.isSafeInteger(serial) || serial <= 0 || candidate?.build !== build ||
      candidate.release !== tag || candidate.kind !== 'candidate' || candidate.status !== 'pass' ||
      candidate.hold !== false || candidate.roomsSerial !== serial ||
      !alias.deployment?.id || alias.deployment.id !== candidate.deploymentId) return undefined;
  return { staging_build: build, staging_qualification: JSON.stringify({ build, serial, j475: { releaseCi: ci } }) };
}

/** FAST-RELEASE FR6: a release branch's ci reuses main's proof of its cut (src/scripts/ci-selection.mjs) when the release
 * commit only stamps the version and adds notes. The train takes that run as proof only when it is green on the exact
 * build with every `tests` share green, and the build is release-only over `cut`, the main commit whose own ci already
 * passed provesTrainCi.
 * @param {import('./release-train-proof.mjs').Run} run @param {string} build @param {string} tag @param {string} cut
 * @param {string} cwd */
export function provesReleaseReuse(run, build, tag, cut, cwd) {
  const tests = run.jobs.filter(job => /^tests(?: \(.+\))?$/u.test(job.name));
  return trainSha.test(cut) && run.headSha === build && run.status === 'completed' && run.conclusion === 'success' &&
    tests.length > 0 && tests.every(job => job.status === 'completed' && job.conclusion === 'success') &&
    releaseOnlyParent(cwd, build, tag) === cut;
}

/** @param {import('./release-train-proof.mjs').Run} run @param {string} build */
export function provesTrainCi(run, build) {
  return run.headSha === build && run.status === 'completed' && run.conclusion === 'success' &&
    provesCode('ci.yml', run.jobs) &&
    ['boundaries', 'nine-ring1-build', 'memory-client-build'].every(name =>
      run.jobs.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success'));
}

/** Why repo-kit's prepare would refuse this environment's commit, or undefined. Checked before local QA (opus-rel86,
 *  v0.1.86: the train spent its local QA, then prepare stopped on a missing ASSISTED_BY and removed its log).
 * @param {Record<string, string | undefined>} env @param {boolean} prepared @returns {string | undefined} */
export function attributionGap(env, prepared) {
  if (prepared || env.SKIP_ATTRIB === '1') return undefined;
  return (env.ASSISTED_BY ?? '').trim() !== '' ? undefined
    : 'set ASSISTED_BY=Claude:<model> (or Codex:<model>) for the prepared commit; SKIP_ATTRIB=1 only for a human-only release';
}

/**
 * Meta QA 11-25 row 7 (J505): v0.1.91's train held at 15:48 UTC on one `gh run` call that failed once (quota at 2,756
 * of 5,000, release CI queued), and the whole staging leg had to be rerun. A read-only `gh` call now gets three tries,
 * five seconds apart, before it holds the train.
 * @template T @param {() => T} read @param {{tries?: number, pauseMs?: number, pause?: (ms: number) => void}} [opts]
 * @returns {T}
 */
export function retryRead(read, {tries = 3, pauseMs = 5000, pause = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }} = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return read();
    } catch (error) {
      if (attempt >= tries) throw error;
      pause(pauseMs);
    }
  }
}

/**
 * Meta QA 11-25 (opus-rel86, J505): a wait on `gh run list --commit <short sha>` matched no run and sat 20 minutes past
 * a green ci (gh filters on the full SHA). Every `--commit` the train passes to gh is a full 40-hex SHA, or it throws.
 * @param {readonly string[]} args @returns {readonly string[]}
 */
export function fullCommitArgs(args) {
  args.forEach((arg, index) => {
    if (arg === '--commit' && !/^[0-9a-f]{40}$/u.test(args[index + 1] ?? '')) {
      throw new Error(`gh --commit needs a full 40-character SHA (git rev-parse first), not ${JSON.stringify(args[index + 1])}`);
    }
  });
  return args;
}

/**
 * Meta QA 11-25 (opus-rel86, J505): npm-publish.yml admits npm next on the exact green release CI alone (J475), yet the
 * train dispatched it only after a staging candidate passed, so a release waiting behind another's staging never reached
 * npm (the SDK waited on it). This is that J475 admission: the build and its release CI run, no staging serial.
 * @param {string} build @param {number} ci @returns {{staging_build: string, staging_qualification: string}}
 */
/** QA 11-25 row 80: a held local QA verdict stays as evidence, and a rerun runs local QA again in the next `local-N`
 * folder; v0.1.93's held phone-leg flake was otherwise read back on every rerun.
 * @param {string} saved @param {(dir: string) => boolean} held @returns {string} */
export function localAttemptDir(saved, held) {
  for (let attempt = 0; ; attempt += 1) {
    const dir = `${saved}/${attempt === 0 ? 'local' : `local-${attempt}`}`;
    if (!held(dir)) return dir;
  }
}

export function releaseCiAdmission(build, ci) {
  if (!trainSha.test(build) || !Number.isSafeInteger(ci) || ci <= 0) throw new Error('npm next needs the full build SHA and its release CI run');
  return { staging_build: build, staging_qualification: JSON.stringify({ build, j475: { releaseCi: ci } }) };
}

/** Whether a stopped prepare's log is the push gate seeing its installed inputs change mid-gate (push-proof-cache.mjs),
 * a passing stop that a second prepare clears. @param {string} log @returns {boolean} */
export function gateInputsMoved(log) {
  return /Full proof inputs unavailable; rerun the complete gate|Installed inputs changed during the gate/u.test(log);
}
