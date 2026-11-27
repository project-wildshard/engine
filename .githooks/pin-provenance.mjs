// J375 "pin bumps land like code" (meta MINI-FLOW MF4, was HOW-WE-BUILD PIN1). Both engine-main reds on
// 2026-11-16 (df879dc0, fafee64e) were pin changes pushed straight to main by mode 1, judged by nobody before main.
//
// pre-push, for a push to refs/heads/main whose old..new diff touches test/pins/: the pushed tree's test/pins must be
// what land would push for some plan branch. That is, for some local refs/remotes/origin/plan/* tip T,
// `git merge-tree --write-tree <old main> T` has the same test/pins tree as the pushed commit, and T's `ci` run is
// green on GitHub. Land's exact push (the green SHA itself) and its carried push (a clean rebase, which land's
// verifyReplay already holds to that merge) both pass. A mode-1 push of a pin change has no such T and is refused,
// offline too. No env var says "this is land": any agent could set one (the MINI-FLOW hook review). When GitHub can't
// be asked (down, rate-limited), a matching plan tip passes with a warning: no gridlock on an outage (J381).
// Covers all of test/pins/ (shard pins, ring digests, slices, saves): re-recording any of them goes through a plan
// branch now.
// Escape hatch, when truly stuck (main red and the fix cannot wait for branch CI): ALLOW_PIN_PUSH=1. Say so in your
// receipt.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const PINS = 'test/pins';
const ZERO = /^0+$/u;
const SHA = /^[a-f0-9]{40}$/u;

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() };
};

/** The tree id of test/pins in a tree-ish, or '' when it has none. */
const pinsTree = (cwd, treeish) => git(cwd, ['rev-parse', '--verify', '--quiet', `${treeish}:${PINS}`]).out;

/** @typedef {(cwd: string, old: string, head: string, env: NodeJS.ProcessEnv) => {sha: string}} SelectMainPush */
/** @param {string} cwd @param {string} old @param {string} head
 * @param {string} pushed @param {NodeJS.ProcessEnv} env @param {SelectMainPush|undefined} select */
function mainPushTree(cwd, old, head, pushed, env, select) {
  if (head === pushed) return true;
  if (!env.WS_LANE_NAME || select === undefined) return false;
  // Main-push can replay this lane's commits without the other lanes' local commits (QA 11-25 row 58).
  // A replay can get a new committer timestamp. Compare the selected tree that both gates check.
  try {
    const {sha} = select(cwd, old, head, env);
    const selected = git(cwd, ['rev-parse', `${sha}^{tree}`]).out;
    return selected !== '' && selected === git(cwd, ['rev-parse', `${pushed}^{tree}`]).out;
  } catch {
    return false;
  }
}

/**
 * The plan-branch tips whose merge with `old` gives the pushed commit's test/pins.
 * @param {string} cwd @param {string} old @param {string} pushed @returns {{ ref: string, sha: string }[]}
 */
export function matchingPlanTips(cwd, old, pushed) {
  const want = pinsTree(cwd, pushed);
  const refs = git(cwd, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/origin/plan/']).out.split('\n').filter(Boolean);
  const found = [];
  for (const line of refs) {
    const [ref = '', sha = ''] = line.split(' ');
    const merged = git(cwd, ['merge-tree', '--write-tree', '--no-messages', old, sha]);
    if (!merged.ok) continue;
    const tree = merged.out.split('\n')[0] ?? '';
    if (SHA.test(tree) && pinsTree(cwd, tree) === want) found.push({ ref: ref.replace('refs/remotes/', ''), sha });
  }
  return found;
}

/**
 * The verdict for one push. `ciState(sha)` returns 'green', 'red', 'pending' or throws when GitHub can't be asked.
 * @param {{ cwd: string, refs: string, ciState: (sha: string) => string, env?: NodeJS.ProcessEnv, selectMainPush?: SelectMainPush }} input
 * @returns {{ ok: true, note?: string } | { ok: false, problems: string[] }}
 */
export function checkPinPush({ cwd, refs, ciState, env = process.env, selectMainPush }) {
  // Match landMainMode's single-main-ref rule without importing engine
  // tooling into the standalone installed hook. Seed repos have no scripts/.
  const localOnly = !env.CI && !env.GITHUB_ACTIONS && refs.trim().split('\n').filter(Boolean).length === 1;
  for (const row of refs.split('\n').map((line) => line.trim().split(/\s+/u))) {
    const [, pushed = '', remote = '', old = ''] = row;
    if (remote !== 'refs/heads/main' || !SHA.test(pushed) || ZERO.test(pushed) || !SHA.test(old) || ZERO.test(old)) continue;
    if (!git(cwd, ['cat-file', '-e', `${old}^{commit}`]).ok) continue; // main moved past us: git refuses the push itself
    const changed = git(cwd, ['diff', '--name-only', old, pushed, '--', PINS]).out.split('\n').filter(Boolean);
    if (!changed.length) continue;
    // A marker alone cannot turn a canonical/direct push into a plan land.
    const head = git(cwd, ['rev-parse', 'HEAD']).out;
    const branch = git(cwd, ['symbolic-ref', '--quiet', 'HEAD']).out;
    const gitDir = git(cwd, ['rev-parse', '--absolute-git-dir']).out;
    const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).out;
    // J422 (meta FLOW-SIMPLE FS2): land's push mode is the one way onto main for every row, pins included; main's
    // hosted ci judges it and main-watch names the push on red.
    if (localOnly && env.WS_LAND_MAIN_PUSH === `push:${pushed}` && head === pushed && /^refs\/heads\/plan\//u.test(branch)
      && gitDir !== common && git(cwd, ['merge-base', '--is-ancestor', old, pushed]).ok) {
      return { ok: true, note: `plan HEAD ${pushed.slice(0, 10)} through land's push gate; main ci judges it (J422)` };
    }
    // FS18 (meta FLOW-SIMPLE, J443): a no-plan fix re-recording a pin goes through main-push.mjs from a clone on main
    // (engine-quickfix). The marker names the outgoing commit, and its tree must match the current lane's selection.
    if (localOnly && env.WS_LAND_MAIN_PUSH === `main-push:${pushed}` && branch === 'refs/heads/main'
      && gitDir === common && git(cwd, ['merge-base', '--is-ancestor', old, pushed]).ok
      && mainPushTree(cwd, old, head, pushed, env, selectMainPush)) {
      return { ok: true, note: `main commit ${pushed.slice(0, 10)} through main-push's push gate; main ci judges it (FS18, J422)` };
    }
    if (env.ALLOW_PIN_PUSH === '1') return { ok: true, note: `ALLOW_PIN_PUSH=1: ${changed.length} test/pins file(s) pushed to main without a green plan branch (J375); say so in your receipt` };
    const tips = matchingPlanTips(cwd, old, pushed);
    const states = [];
    let unasked = '';
    for (const tip of tips) {
      let state;
      try {
        state = ciState(tip.sha);
      } catch (error) {
        unasked ||= `${tip.ref} ${tip.sha.slice(0, 10)} (${String(error?.message ?? error).slice(0, 120)})`;
        continue;
      }
      if (state === 'green') return { ok: true, note: `test/pins change carried by ${tip.ref} ${tip.sha.slice(0, 10)}, ci green (J375)` };
      states.push(`${tip.ref} ${tip.sha.slice(0, 10)}: ci ${state}`);
    }
    // GitHub down or rate-limited: the offline provenance (a plan branch carries exactly these pins) is enough, so no
    // agent gridlocks on an outage (J381). Only the green-CI half needs GitHub, and that half only warns.
    if (unasked) return { ok: true, note: `WARNING GitHub could not be asked about ${unasked}; passing on offline provenance (a plan branch carries these pins), CI not checked (J381)` };
    return refuse(changed, tips.length
      ? [`the plan branch(es) carrying these pins are not green: ${states.join('; ')}`]
      : ['no origin/plan/* branch carries these pins: this is a direct push, not a land']);
  }
  return { ok: true };
}

/** @param {string[]} changed @param {string[]} why */
function refuse(changed, why) {
  return {
    ok: false,
    problems: [
      `This push to main changes ${changed.length} file(s) under test/pins/ (${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ', …' : ''}).`,
      ...why,
      'J375: pin changes land like code, through a plan branch and its green CI. Do it this way:',
      '  node src/scripts/.kit/worktree.mjs new <slug>   (from the canonical checkout), then commit or cherry-pick the pin change there,',
      '  then from the worktree: WS_LANE_NAME=<lane> node src/scripts/.kit/land.mjs   (push gate, then main; J422).',
      '  A no-plan fix: commit on main in engine-quickfix and WS_LANE_NAME=<lane> node src/scripts/.kit/main-push.mjs (FS18).',
      'Escape hatch, only when truly stuck (main red and the fix cannot wait for CI): ALLOW_PIN_PUSH=1 git push origin main,',
      'and say so in your receipt.',
    ],
  };
}

/** GitHub's `ci` verdict for one SHA, through gh (land's own query and verdict). */
async function ghCiState(cwd, env) {
  const { githubSlug, shaVerdict } = await import('../src/scripts/.kit/land.mjs');
  const repo = env.WS_LAND_REPO ?? githubSlug(git(cwd, ['remote', 'get-url', 'origin']).out);
  if (repo === null || !/^[-\w.]+\/[-\w.]+$/u.test(repo)) throw new Error('origin is not a GitHub repo');
  return (sha) => {
    const result = spawnSync('gh', ['api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 << 20 });
    if (result.error !== undefined || result.status !== 0) throw new Error(`gh api failed: ${`${result.stderr ?? ''}${result.error?.message ?? ''}`.trim().slice(0, 200)}`);
    return shaVerdict(JSON.parse(result.stdout), sha).state;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { readFileSync } = await import('node:fs');
  const refs = readFileSync(0, 'utf8');
  const cwd = process.cwd();
  /** @type {SelectMainPush|undefined} */ let selectMainPush;
  const marker = process.env.WS_LAND_MAIN_PUSH;
  if (marker?.startsWith('main-push:') && marker !== `main-push:${git(cwd, ['rev-parse', 'HEAD']).out}`) {
    ({selectMainPushCommit: selectMainPush} = await import('../src/scripts/.kit/main-push.mjs'));
  }
  // Most pushes touch no pins: answer them without loading land.mjs or asking GitHub.
  let asked = false;
  let verdict = checkPinPush({ cwd, refs, selectMainPush, ciState: () => { asked = true; throw new Error('not asked yet'); } });
  if (asked) {
    let ciState;
    try {
      ciState = await ghCiState(cwd, process.env);
    } catch (error) {
      const message = String(error?.message ?? error);
      ciState = () => { throw new Error(message); };
    }
    verdict = checkPinPush({ cwd, refs, ciState, selectMainPush });
  }
  if (verdict.ok) {
    if (verdict.note) console.error(`  - pin provenance: ${verdict.note}`);
    process.exit(0);
  }
  console.error(`\n  X push blocked: test/pins/ change without a green plan branch (J375, .githooks/pin-provenance.mjs):\n`);
  for (const line of verdict.problems) console.error(`    ${line}`);
  console.error('');
  process.exit(1);
}
