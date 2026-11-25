#!/usr/bin/env node
// Meta QA 11-25 row 67 (velocity, J505): a release train cuts only at a main commit whose own `ci` run is green
// (release-train-proof.mjs provesTrainCi needs `run.headSha === build`). Main's ci cancels a pending run when a newer push
// arrives, so most landed commits never get a run of their own: on 11-25 the v0.1.92 train waited on Driftwood r13's pin
// commit 9a5101633, whose run was "skipped (pending, replaced)" and would never come. This prints the newest main commit
// with a green ci run of its own that contains every commit the train must carry, so a train never waits on a run that
// was cancelled.
//
//   node scripts/green-cut.mjs [--contains=<sha>[,<sha>...]] [--limit=60]
//
// Prints `<sha> run <id> (<created>)`, or exits 1 naming what it waits for: the oldest run still going that contains
// them, or none.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @typedef {{databaseId:number, headSha:string, status:string, conclusion:string|null, createdAt:string, event:string}} CiRun */

/**
 * The newest green push run whose commit contains every `contains` sha, and the oldest unfinished one that does
 * (it finishes first; a newer pending run may still be cancelled).
 * @param {CiRun[]} runs newest first, as `gh run list` gives them
 * @param {string[]} contains
 * @param {(ancestor:string, descendant:string) => boolean} isAncestor
 * @returns {{cut?:CiRun, pending?:CiRun}}
 */
export function greenCut(runs, contains, isAncestor) {
  const carries = (/** @type {CiRun} */ run) => contains.every(sha => isAncestor(sha, run.headSha));
  /** @type {CiRun|undefined} */ let pending;
  for (const run of runs) {
    if (run.event !== 'push' || !carries(run)) continue;
    if (run.status === 'completed' && run.conclusion === 'success') return { cut: run, pending };
    if (run.status !== 'completed') pending = run;
  }
  return { pending };
}

/** @param {string[]} argv */
function main(argv) {
  const option = (/** @type {string} */ name) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const contains = (option('contains') ?? '').split(',').filter(Boolean);
  const limit = Number(option('limit') ?? 60);
  const runs = /** @type {CiRun[]} */ (JSON.parse(execFileSync('gh', ['run', 'list', '-R', 'project-wildshard/engine', '-w', 'ci',
    '-b', 'main', '-L', String(limit), '--json', 'databaseId,headSha,status,conclusion,createdAt,event'], { encoding: 'utf8' })));
  execFileSync('git', ['fetch', '-q', 'origin', 'main'], { stdio: 'ignore' });
  const isAncestor = (/** @type {string} */ a, /** @type {string} */ b) => {
    try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch { return false; }
  };
  const { cut, pending } = greenCut(runs, contains, isAncestor);
  if (cut !== undefined) {
    process.stdout.write(`${cut.headSha.slice(0, 10)} run ${cut.databaseId} (${cut.createdAt})\n`);
    return 0;
  }
  process.stderr.write(pending === undefined
    ? `green-cut: no main ci run in the last ${limit} contains ${contains.join(', ') || 'main'}; the next push's run will\n`
    : `green-cut: no green run yet; wait on run ${pending.databaseId} (${pending.headSha.slice(0, 10)}, ${pending.status}), never on a cancelled sha\n`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
