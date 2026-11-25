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

/** FAST-RELEASE FR6: a release branch's ci reuses main's proof of its cut (scripts/ci-selection.mjs) when the release
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
