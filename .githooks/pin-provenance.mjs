// J375 "pin bumps land like code" (meta MINI-FLOW MF4, was HOW-WE-BUILD PIN1). Both engine-main reds on
// 2026-11-16 (df879dc0, fafee64e) were pin changes pushed straight to main by mode 1, judged by nobody before main.
//
// pre-push, for a push to refs/heads/main whose old..new diff touches test/pins/: the pushed tree's test/pins must be
// what land would push for some plan branch. That is, for some local refs/remotes/origin/plan/* tip T,
// `git merge-tree --write-tree <old main> T` has the same test/pins tree as the pushed commit, and T's `ci` run is
// green on GitHub. Land's exact push (the green SHA itself) and its carried push (a clean rebase, which land's
// verifyReplay already holds to that merge) both pass. A mode-1 push of a pin change has no such T and is refused,
// offline too. No env var says "this is land": any agent could set one (the MINI-FLOW hook review).
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
 * @param {{ cwd: string, refs: string, ciState: (sha: string) => string, env?: NodeJS.ProcessEnv }} input
 * @returns {{ ok: true, note?: string } | { ok: false, problems: string[] }}
 */
export function checkPinPush({ cwd, refs, ciState, env = process.env }) {
  for (const row of refs.split('\n').map((line) => line.trim().split(/\s+/u))) {
    const [, pushed = '', remote = '', old = ''] = row;
    if (remote !== 'refs/heads/main' || !SHA.test(pushed) || ZERO.test(pushed) || !SHA.test(old) || ZERO.test(old)) continue;
    if (!git(cwd, ['cat-file', '-e', `${old}^{commit}`]).ok) continue; // main moved past us: git refuses the push itself
    const changed = git(cwd, ['diff', '--name-only', old, pushed, '--', PINS]).out.split('\n').filter(Boolean);
    if (!changed.length) continue;
    if (env.ALLOW_PIN_PUSH === '1') return { ok: true, note: `ALLOW_PIN_PUSH=1: ${changed.length} test/pins file(s) pushed to main without a green plan branch (J375); say so in your receipt` };
    const tips = matchingPlanTips(cwd, old, pushed);
    const states = [];
    for (const tip of tips) {
      let state;
      try {
        state = ciState(tip.sha);
      } catch (error) {
        return refuse(changed, [`GitHub could not be asked about ${tip.ref} ${tip.sha.slice(0, 10)} (${String(error?.message ?? error).slice(0, 160)}); with no answer this hook refuses`]);
      }
      if (state === 'green') return { ok: true, note: `test/pins change carried by ${tip.ref} ${tip.sha.slice(0, 10)}, ci green (J375)` };
      states.push(`${tip.ref} ${tip.sha.slice(0, 10)}: ci ${state}`);
    }
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
      '  node scripts/worktree.mjs new <slug>   (from the canonical checkout), then commit or cherry-pick the pin change there,',
      '  then from the worktree: WS_LANE_NAME=<lane> node scripts/land.mjs   (it pushes the branch, waits for ci, lands).',
      'Escape hatch, only when truly stuck (main red and the fix cannot wait for CI): ALLOW_PIN_PUSH=1 git push origin main,',
      'and say so in your receipt.',
    ],
  };
}

/** GitHub's `ci` verdict for one SHA, through gh (land's own query and verdict). */
async function ghCiState(cwd, env) {
  const { githubSlug, shaVerdict } = await import('../scripts/land.mjs');
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
  // Most pushes touch no pins: answer them without loading land.mjs or asking GitHub.
  let asked = false;
  let verdict = checkPinPush({ cwd, refs, ciState: () => { asked = true; throw new Error('not asked yet'); } });
  if (asked) {
    let ciState;
    try {
      ciState = await ghCiState(cwd, process.env);
    } catch (error) {
      const message = String(error?.message ?? error);
      ciState = () => { throw new Error(message); };
    }
    verdict = checkPinPush({ cwd, refs, ciState });
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
