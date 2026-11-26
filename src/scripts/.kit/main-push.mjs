#!/usr/bin/env node
// Safe engine sync for many lanes in ONE shared checkout on main (meta MINI-DECISIONS M1, J389; Jake, 2026-11-16: "all
// your agents ... work on one checkout of engine, commit to main push"). Ported from meta's scripts/main-push.mjs (MF7).
// In place of `git commit -- <paths>`, `git pull --rebase origin main` (or main-pull.mjs) and `git push origin main`:
//
//   WS_LANE_NAME=<lane> node scripts/main-push.mjs -m "<subject>" [-m "<body>"]... <file>...   commit, sync, push
//   node scripts/main-push.mjs                                              push commits already made
//   node scripts/main-push.mjs --onto <sha> -m "<subject>" <file>...        after a conflict: commit the files you
//                                                                           merged against origin/main at <sha>
//   options: --tries <n> (default 8), --wait <seconds> (first wait, doubling; default 5)
//
// How it stays safe beside other lanes' edits:
//   1. the commit is by pathspec (`git commit -m ... -- <files>`), after `git add` of only the named files that are
//      untracked; a directory is refused, since it would sweep in another lane's files;
//   2. `git fetch origin main`; when main lacks origin/main, the commits only main has are replayed onto origin/main
//      with `git replay` (no working tree), then `git read-tree -m -u` moves only the paths that differ and refuses,
//      before writing anything, when one of them holds an uncommitted edit; then main's ref moves (main-pull.mjs's way);
//   3. `git push origin main`, through the normal pre-push: it gates the pushed commit in a clean copy
//      (scripts/push-gate-copy.mjs), so other lanes' dirty and untracked files neither refuse the push nor leak in, and
//      runs the split gate (static checks plus the related Vitest files); main's own CI runs the rest, main-watch
//      reports a red, and the lane that pushed fixes it forward at once (J249).
// One run at a time: a lock directory in the git dir (main-push.lock), held through the push; a dead or 30-minute-old
// lock is taken over. Another lane's edit in the way, a held index.lock, the lock or a push race waits and tries again
// (5, 10, 20 ... 640 s). A merge commit or a refused pre-push stops at once, your commit on local main. A real conflict
// holds that lane's original commits under refs/wildshard-held/<lane>/, names and prompts it, and lets independent
// lanes continue. Duplicate patches already on origin are dropped (M11). Recovery uses the printed --onto command.
// Never a rebase, never a stash (never --autostash): in a
// shared checkout `git rebase --continue` refuses beside another lane's unstaged edit and `git rebase --abort` wipes it.
// Exit 0 when pushed; 1 with a `main-push STOP` line; 2 on bad arguments.
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {assertNoLocalCandidates} from '../local-candidates.ts';
import {installLag} from '../install-lag.mjs';
import {holdRefusal} from '../land-hold.mjs';
import {withStoreUse} from './worktree.mjs';
import { laneName } from '../lane-name.mjs';
import { commitLanes, foreignCommits, nameCommits } from '../lane-commits.mjs';

export class StopError extends Error {
  /** @param {string} message @param {boolean} [retry] a later try may succeed */
  constructor(message, retry = false) {
    super(message);
    this.name = 'StopError';
    this.retry = retry;
    /** @type {{upstream:string,files:string[]}|undefined} a real conflict: what to merge against */
    this.conflict = undefined;
  }
}

/** @param {string} cwd @param {string[]} args */
function run(cwd, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 });
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = run(cwd, args);
  if (result.status !== 0) throw new StopError(`git ${args.join(' ')}: ${firstLines(result.stderr || result.stdout)}`);
  return result.stdout.trim();
}

/** @param {string} text @param {number} [n] */
function firstLines(text, n = 6) { return text.trim().split('\n').slice(0, n).join(' | '); }

/** Refuse anything but main with no rebase, merge, cherry-pick or revert in progress. @param {string} cwd */
export function checkState(cwd) {
  try { assertNoLocalCandidates(cwd); } catch (error) { throw new StopError(error instanceof Error ? error.message : String(error)); }
  if (run(cwd, ['symbolic-ref', '--quiet', 'HEAD']).stdout.trim() !== 'refs/heads/main') {
    throw new StopError('the checkout is not on main; lanes here work on main only (M1)');
  }
  for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (existsSync(resolve(cwd, git(cwd, ['rev-parse', '--git-path', name])))) {
      throw new StopError(`a git ${name} is in progress in the shared checkout; whoever started it finishes or aborts it (git status shows it), then run this again`);
    }
  }
}

/** Subjects of the commits this run made (commitFiles), so a push can tell its own from another lane's. A sync replays
 * them to new SHAs, so the subject is what survives. */
const OWN = new Set();
/** The run's lane: the CLI refuses to start without one (meta QA 11-25 row 43, scripts/lane-name.mjs); a test that imports
 * these functions directly reads `unnamed`, never the script's own name. */
const currentLane = () => { const named = laneName(process.env, 'main-push'); return 'lane' in named ? named.lane : 'unnamed'; };

/** The outgoing commits (`%h %s` rows) this run did not make: another lane's, carried along (M1).
 * @param {string} cwd @param {string} range */
const carriedRows = (cwd, range) => run(cwd, ['log', '--format=%h %s', range]).stdout.trim().split('\n').filter(Boolean)
  .filter((row) => !OWN.has(row.slice(row.indexOf(' ') + 1)));

/**
 * Meta QA 11-25 row 53: SKIP_CHECK=1 skips the gate for the pusher's own commits (J381), never for another lane's commit
 * it carries (M1): that commit's own push was never gated, or its gate was red. engine 5068a7365's push refused it on
 * typecheck (TS7006 in an untyped .mjs), then opus-fr13's `SKIP_CHECK=1` main-push carried it ungated to main, red.
 * So with a carried commit the variable is dropped and the gate runs; `dropped` says so for the log.
 * @param {Record<string, string | undefined>} env @param {readonly string[]} carried
 */
export function gateEnv(env, carried) {
  if (carried.length === 0 || env.SKIP_CHECK !== '1') return { env, dropped: false };
  const { SKIP_CHECK: _skip, ...rest } = env;
  return { env: rest, dropped: true };
}

/**
 * Meta QA 11-25 row 58: a lane pushes only its own commits. When local main holds another lane's commit (its `Lane:`
 * trailer names another lane, or it has none), this lane's commits are replayed onto `base` without it (git replay: no
 * worktree, index or local ref moves) and that commit is what goes out; the other lane's commits stay on local main for
 * their own lane to push. ALLOW_CARRY=1 (J381) sends local main whole, as before (M1). A lane's commit that needs the
 * other lane's to apply stops, naming it.
 * @param {string} cwd @param {string} base @param {string} head @param {NodeJS.ProcessEnv} [env]
 * @returns {{sha:string,own:number,left:import('../lane-commits.mjs').LaneCommit[]}}
 */
export function ownCommits(cwd, base, head, env = process.env) {
  const commits = commitLanes(cwd, `${base}..${head}`);
  // A pusher with no lane name (Jake, a CI fixture) cannot tell an unnamed commit from its own, so it sends them; a named
  // lane leaves unnamed commits, which in a shared checkout may be anyone's.
  const lane = currentLane();
  const left = env.ALLOW_CARRY === '1' ? [] : foreignCommits(commits, lane, { unnamed: lane === 'unnamed' ? 'own' : 'foreign' });
  if (left.length === 0) return { sha: head, own: commits.length, left };
  const skipped = new Set(left.map(row => row.sha));
  let target = base, own = 0;
  for (const row of commits) {
    if (skipped.has(row.sha)) continue;
    const parents = git(cwd, ['rev-list', '--parents', '-n', '1', row.sha]).split(' ').slice(1);
    if (parents.length !== 1) throw new StopError(`local commit ${row.sha.slice(0, 10)} is a merge, which git replay cannot move; ask the coordinator`);
    // An own commit that already sits on what goes out moves as it is: no replay (an older git has no --ref-action).
    if (parents[0] === target) { target = row.sha; own++; continue; }
    const replayed = run(cwd, ['replay', '--ref=refs/heads/main', '--ref-action=print', '--onto', target, `${parents[0]}..${row.sha}`]);
    const next = replayed.stdout.trim().split('\n').find(line => /^update(-ref)? refs\/heads\/main /u.test(line))?.split(/\s+/u)[2] ?? '';
    // A replay that git itself refused (no committer identity, as on a CI runner; an old git) is not a conflict: say git's words.
    if (replayed.status !== 0 && /fatal: (?!.*conflict)|unknown option|usage: git replay/u.test(replayed.stderr)) {
      throw new StopError(`git replay could not move your commit ${row.sha.slice(0, 10)} past another lane's (row 58): ${firstLines(replayed.stderr)}. Left: ${nameCommits(left)}; ALLOW_CARRY=1 (J381) sends them with yours`);
    }
    if (replayed.status !== 0 || !/^[a-f0-9]{40}$/u.test(next)) {
      throw new StopError(`your commit ${row.sha.slice(0, 10)} ${row.subject} does not apply without another lane's local commit(s), which this lane never pushes (row 58): ${nameCommits(left)}. Their lane pushes them first; ALLOW_CARRY=1 (J381, named in your commit body) sends them with yours`);
    }
    target = next; own++;
  }
  return { sha: target, own, left };
}

/** @typedef {{sha:string,lane:string,ref:string,files:string[],upstream:string}} HeldCommit */
/** @param {string} cwd */
const heldDirectory = (cwd) => resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'main-push-held']));

/** Recovery records belong only to the named lane. The refs retain its original committed bytes.
 * @param {string} cwd @returns {HeldCommit[]} */
export function heldCommits(cwd) {
  const dir = heldDirectory(cwd);
  return existsSync(dir) ? readdirSync(dir).filter(name => /^[a-f0-9]{40}\.json$/u.test(name))
    .map(name => /** @type {HeldCommit} */ (JSON.parse(readFileSync(join(dir, name), 'utf8')))) : [];
}

/** @param {string} cwd @param {HeldCommit} held */
function heldAdvice(cwd, held) {
  const message = git(cwd, ['show', '-s', '--format=%B', held.sha]);
  return `lane ${held.lane} is held at ${held.ref}; only that lane stops. Original commit: git show ${held.ref}. ` +
    `Merge its change into today's files, then run: ${ontoCommand(held.upstream, [message], held.files)}`;
}

/** Replay separately so a conflict holds its lane, while other lanes continue. No worktree or index is touched.
 * @param {string} cwd @param {string} upstream @param {string} head */
function replayLanes(cwd, upstream, head) {
  const commits = git(cwd, ['rev-list', '--reverse', '--topo-order', `${upstream}..${head}`]).split('\n').filter(Boolean);
  const duplicates = new Set(git(cwd, ['cherry', upstream, head]).split('\n').filter(row => row.startsWith('- ')).map(row => row.slice(2)));
  /** @type {HeldCommit[]} */ const held = [];
  /** @type {string[]} */ const dropped = [];
  const stopped = new Set();
  let target = upstream;
  for (const sha of commits) {
    const parents = git(cwd, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
    if (parents.length !== 1) throw new StopError(`local commit ${sha.slice(0, 10)} is a merge, which git replay cannot move; ask the coordinator`);
    if (duplicates.has(sha)) { dropped.push(sha); continue; }
    const message = git(cwd, ['show', '-s', '--format=%B', sha]);
    const lane = /^Lane: ([a-z][a-z0-9_-]*)$/mu.exec(message)?.[1] ?? `unnamed-${sha.slice(0, 10)}`;
    const replayed = stopped.has(lane) ? null : run(cwd, ['replay', '--ref=refs/heads/main', '--ref-action=print', '--onto', target, `${parents[0]}..${sha}`]);
    if (replayed?.status === 0) {
      const next = replayed.stdout.trim().split('\n').find(row => /^update(-ref)? refs\/heads\/main /u.test(row))?.split(/\s+/u)[2] ?? '';
      if (!/^[a-f0-9]{40}$/u.test(next)) throw new StopError(`git replay gave no new main for ${sha.slice(0, 10)}`);
      if (git(cwd, ['rev-parse', `${next}^{tree}`]) === git(cwd, ['rev-parse', `${target}^{tree}`])) dropped.push(sha);
      else target = next;
      continue;
    }
    if (replayed !== null) {
      // Only a demonstrated merge conflict is held. A git/tool failure must leave main alone.
      const merged = run(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '--merge-base', parents[0], target, sha]);
      if (merged.status !== 1) throw new StopError(`git replay failed for ${sha.slice(0, 10)}: ${firstLines(replayed.stderr || replayed.stdout)}`);
    }
    stopped.add(lane);
    const files = git(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]).split('\n').filter(Boolean);
    held.push({ sha, lane, ref: `refs/wildshard-held/${lane}/${sha}`, files, upstream });
  }
  return { target, dropped, held, count: commits.length };
}

/** One `lane-receipts.log` line, `<HH:MM Cancún> <lane> <text>` (the Mac's clock is Cancún time). WS_MAIN_PUSH_RECEIPT=0
 * (the tests) writes none. @param {string} text */
function receipt(text) {
  if (process.env.WS_MAIN_PUSH_RECEIPT === '0') return;
  const file = resolve(process.env.WS_LANE_RECEIPTS ?? join(homedir(), '.cache/wildshard/lane-receipts.log'));
  const lane = currentLane();
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toTimeString().slice(0, 5)} Cancún ${lane} ${text.replaceAll(/\s+/gu, ' ').slice(0, 1000)}\n`);
  } catch {
    /* a receipt is best effort */
  }
}

/**
 * Commit exactly these files by pathspec. Untracked ones are added first, one by one.
 * @param {string} cwd @param {string[]} files @param {string[]} messages
 */
export function commitFiles(cwd, files, messages) {
  for (const file of files) {
    const full = resolve(cwd, file);
    if (existsSync(full) && statSync(full).isDirectory()) throw new StopError(`${file} is a directory; name each file, so no other lane's file rides along`);
  }
  const untracked = files.filter((file) => existsSync(resolve(cwd, file)) && run(cwd, ['ls-files', '--error-unmatch', '--', file]).status !== 0);
  if (untracked.length > 0) git(cwd, ['add', '--', ...untracked]);
  // Keep Assisted-by last while making the lane discoverable after another process replays this commit (M11).
  const labelled = messages.some(message => /^Lane: /mu.test(message)) ? [...messages]
    : messages.map(message => message.replace(/^(Assisted-by: .+)$/mu, `Lane: ${currentLane()}\n\n$1`));
  if (!labelled.some(message => /^Lane: /mu.test(message))) labelled.push(`Lane: ${currentLane()}`);
  const commit = run(cwd, ['commit', ...labelled.flatMap((message) => ['-m', message]), '--', ...files]);
  if (commit.status !== 0) {
    if (untracked.length > 0) run(cwd, ['reset', '--quiet', '--', ...untracked]);
    throw new StopError(`git commit refused: ${firstLines(`${commit.stdout}\n${commit.stderr}`, 12)}`);
  }
  const made = git(cwd, ['rev-parse', '--short=8', 'HEAD']);
  OWN.add(git(cwd, ['log', '-1', '--format=%s', 'HEAD']));
  return made;
}

/**
 * Bring main up to origin/main without touching unrelated files (engine's main-pull.mjs).
 * @param {string} cwd @param {string} [remote] @returns {string} what it did
 */
export function syncMain(cwd, remote = 'origin') {
  checkState(cwd);
  const fetched = run(cwd, ['fetch', '--quiet', remote, 'main']);
  if (fetched.status !== 0) throw new StopError(`git fetch ${remote} main: ${firstLines(fetched.stderr)}`, true);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const upstream = git(cwd, ['rev-parse', `refs/remotes/${remote}/main`]);
  if (run(cwd, ['merge-base', '--is-ancestor', upstream, head]).status === 0) return `main current at ${head.slice(0, 8)}`;
  let target = upstream;
  let how = 'fast-forward';
  /** @type {HeldCommit[]} */ let held = [];
  /** @type {string[]} */ let dropped = [];
  if (run(cwd, ['merge-base', '--is-ancestor', head, upstream]).status !== 0) {
    const replay = replayLanes(cwd, upstream, head);
    target = replay.target; held = replay.held; dropped = replay.dropped;
    how = `replayed ${replay.count} local commit(s)`;
    // Protect every held commit before removing it from main, even if a later index/ref race refuses the move.
    for (const row of held) git(cwd, ['update-ref', row.ref, row.sha]);
  }
  if (git(cwd, ['rev-parse', 'HEAD']) !== head) throw new StopError('another lane committed while syncing; nothing moved', true);
  run(cwd, ['update-index', '-q', '--refresh']);
  const moved = run(cwd, ['read-tree', '-m', '-u', head, target]);
  if (moved.status !== 0) {
    if (/index\.lock/u.test(moved.stderr)) throw new StopError('another git command holds the index (index.lock); nothing moved', true);
    const untracked = [...moved.stderr.matchAll(/^error: Untracked working tree file '([^']+)'/gmu)].map((match) => match[1]);
    if (untracked.length > 0) throw new StopError(`untracked files sit where origin/main adds files: ${untracked.join(', ')}; nothing moved. Another lane's? It commits soon`, true);
    const files = [...moved.stderr.matchAll(/^error: Entry '([^']+)'/gmu)].map((match) => match[1]);
    throw new StopError(`uncommitted edits in paths origin/main changes: ${files.length > 0 ? files.join(', ') : firstLines(moved.stderr, 1)}; nothing moved. Another lane's? It commits soon`, true);
  }
  const ref = run(cwd, ['update-ref', '-m', `main-push: ${how}`, 'refs/heads/main', target, head]);
  if (ref.status !== 0) {
    const now = git(cwd, ['rev-parse', 'HEAD']);
    const back = run(cwd, ['read-tree', '-m', '-u', target, now]);
    if (back.status !== 0) throw new StopError(`another lane committed while syncing and the tree could not be put back (${firstLines(back.stderr, 1)}): git status, then git read-tree -m -u ${target.slice(0, 10)} HEAD`);
    throw new StopError('another lane committed while syncing; nothing moved', true);
  }
  for (const sha of dropped) receipt(`main-push dropped duplicate ${sha.slice(0, 10)}: patch already on origin/main`);
  const notified = new Set();
  for (const row of held) {
    mkdirSync(heldDirectory(cwd), { recursive: true });
    writeFileSync(join(heldDirectory(cwd), `${row.sha}.json`), `${JSON.stringify(row)}\n`);
    const message = heldAdvice(cwd, row);
    receipt(`main-push HELD ${message}`);
    if (process.env.WS_MAIN_PUSH_NOTIFY !== '0' && !row.lane.startsWith('unnamed-') && !notified.has(row.lane)) {
      const sent = spawnSync('herdr', ['agent', 'prompt', row.lane, `main-push M11: ${message}`], { encoding: 'utf8', timeout: 10_000 });
      receipt(`main-push HELD message to ${row.lane} ${sent.status === 0 ? 'delivered' : 'not delivered; recovery is in the held receipt'}`);
      notified.add(row.lane);
    }
  }
  if (dropped.length > 0) how += `; dropped ${dropped.length} duplicate(s)`;
  if (held.length > 0) how += `; held lane(s) ${[...new Set(held.map(row => row.lane))].join(', ')}`;
  return `main ${head.slice(0, 8)} -> ${target.slice(0, 8)} (${how}); other lanes' files untouched`;
}

/** Push main. A push race retries; a refused pre-push stops. @param {string} cwd @param {string} [remote] */
export function pushMain(cwd, remote = 'origin') {
  // What this push sends: this lane's commits over origin/main (row 58). Another lane's commit, made in this shared
  // checkout but not yet pushed, stays on local main and the receipt names it; ALLOW_CARRY=1 carries it along (M1).
  const local = git(cwd, ['rev-parse', 'HEAD']), base = git(cwd, ['rev-parse', `refs/remotes/${remote}/main`]);
  // Row 58: another lane's local commits stay on local main; only this lane's go out.
  const { sha: sent, left } = ownCommits(cwd, base, local);
  if (sent === base) return `nothing of this lane's to push; left on local main for their lane (row 58): ${nameCommits(left)}`;
  // Meta QA 11-25 row 37: an open engine land HOLD in the receipts stops every pusher but the lander it names.
  // Row 67: a hold binds only a push touching the red's files; a disjoint one says so and goes.
  const held = holdRefusal({ lane: currentLane(), bodies: run(cwd, ['log', '--format=%B', `refs/remotes/${remote}/main..${sent}`]).stdout,
    files: run(cwd, ['diff', '--name-only', `refs/remotes/${remote}/main...${sent}`]).stdout.split('\n').filter(Boolean), say: line => receipt(`main-push ${line}`) });
  if (held !== null) { receipt(`main-push STOP ${held}`); throw new StopError(held); }
  const outgoing = run(cwd, ['log', '--format=%h %s', `refs/remotes/${remote}/main..${sent}`]).stdout.trim().split('\n').filter(Boolean);
  // The pre-push's whole output (the gate) goes to a log in the git dir: its RED lines are the cause on a refusal.
  const log = resolve(cwd, git(cwd, ['rev-parse', '--git-path', `main-push-${process.pid}.log`]));
  const fd = openSync(log, 'w');
  let pushed;
  try {
    // FS18: the pre-push's pin provenance passes a test/pins change that main-push itself sends from main.
    const { env } = gateEnv({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), WS_LAND_MAIN_PUSH: `main-push:${sent}` },
      carriedRows(cwd, `refs/remotes/${remote}/main..${sent}`));
    pushed = spawnSync('git', ['push', remote, `${sent}:refs/heads/main`], { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  // The gate's lint and type errors go to stdout, its summary to stderr: both are in the log.
  const text = readFileSync(log, 'utf8');
  if (pushed.status === 0) {
    rmSync(log, { force: true });
    const head = sent.slice(0, 10);
    const carried = outgoing.filter((row) => !OWN.has(row.slice(row.indexOf(' ') + 1)));
    // FS19: the pane lets main-watch message this lane on a red it pushed.
    const pane = /^[\w:.-]+$/u.test(process.env.HERDR_PANE_ID ?? '') ? ` pane ${process.env.HERDR_PANE_ID}` : '';
    const kept = left.length > 0 ? `; left on local main for their lane (row 58): ${nameCommits(left)}` : '';
    const line = `pushed main ${head}: ${outgoing.length} commit(s)${pane}${carried.length > 0 ? `, ${carried.length} of them another lane's, carried along (M1): ${carried.join('; ')}` : ''}${kept}`;
    receipt(`main-push ${line}`);
    if (sent !== local) {
      // Local main still holds this lane's commits under the other lane's: a sync drops them (already on origin).
      try { syncMain(cwd, remote); } catch (error) { if (!(error instanceof StopError)) throw error; }
    }
    return line;
  }
  if (/\[rejected\]|fetch first|non-fast-forward|failed to update ref|cannot lock ref/iu.test(text) && !/pre-push hook/iu.test(text)) {
    rmSync(log, { force: true });
    throw new StopError('origin/main moved during the push', true);
  }
  // oxlint-disable-next-line no-control-regex -- strips terminal colour codes.
  const lines = text.split('\n').map((line) => line.replaceAll(/\u001B\[[0-9;]*m/gu, '').trim()).filter(Boolean);
  const red = lines.filter((line) => /(?:^|\s)(?:RED|X)\s|blocked|refused|Error: |error TS\d|: error /u.test(line)).slice(0, 8);
  throw new StopError(`git push refused by the pre-push: ${(red.length > 0 ? red : lines.slice(-8)).join(' | ')}. Whole output: ${log}`);
}

/**
 * Build-max C4: a sync that moved pnpm-lock.yaml leaves this shared checkout's install behind it, and the gate's typecheck
 * then fails for every lane (2026-11-21, 14:33 to 16:59 Cancún: shard-format 0.66.0 installed, 0.67.0 locked). Install
 * before a gate reads it. Returns the line to log, or '' when the install is current.
 * @param {string} cwd @param {{ env?: NodeJS.ProcessEnv, install?: (cwd: string) => {status: number|null, stderr: string, stdout: string} }} [options]
 */
export function freshInstall(cwd, { env = process.env, install } = {}) {
  const lag = installLag(cwd);
  if (lag === '') return '';
  const doInstall = install ?? ((/** @type {string} */ root) => spawnSync('pnpm', ['install', '--frozen-lockfile', '--config.confirmModulesPurge=false'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }));
  let result;
  try { result = withStoreUse(env, 'main-push install', () => doInstall(cwd)); }
  catch (error) { throw new StopError(`node_modules is behind (${lag}) and the install could not start: ${error instanceof Error ? error.message : String(error)}`); }
  if (result.status !== 0) throw new StopError(`node_modules is behind (${lag}) and pnpm install --frozen-lockfile failed: ${firstLines(`${result.stderr}${result.stdout}`, 3)}. Run it in ${cwd}`);
  return `installed: ${lag}`;
}

/**
 * Sync and push, trying again on a retryable stop. `afterSync` runs once, after the first sync that succeeds (the
 * --onto commit).
 * @param {string} cwd @param {{ tries?: number, wait?: number, sleep?: (s: number) => void, log?: (line: string) => void, afterSync?: () => void }} [options]
 */
export function syncAndPush(cwd, { tries = 8, wait = 5, sleep = sleepSeconds, log = () => { /* No logging requested. */ }, afterSync = () => { /* No deferred commit. */ } } = {}) {
  let synced = false;
  for (let attempt = 1; ; attempt++) {
    try {
      log(syncMain(cwd));
      const installed = freshInstall(cwd);
      if (installed !== '') log(installed);
      if (!synced) {
        synced = true;
        afterSync();
      }
      if (run(cwd, ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']).status === 0) return 'nothing to push';
      return pushMain(cwd);
    } catch (error) {
      if (!(error instanceof StopError) || !error.retry || attempt >= tries) throw error;
      const seconds = wait * 2 ** (attempt - 1);
      log(`try ${attempt} of ${tries}: ${error.message}; trying again in ${seconds} s`);
      sleep(seconds);
    }
  }
}

/**
 * Undo this run's own commit after a conflict: main goes back one commit and the files' index entries with it, so the
 * lane's edits are uncommitted changes again, byte for byte. Only when that commit is still HEAD.
 * @param {string} cwd @param {string} sha @param {string[]} files
 */
export function uncommit(cwd, sha, files) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head.startsWith(sha)) return false;
  const parent = git(cwd, ['rev-parse', 'HEAD~1']);
  if (run(cwd, ['update-ref', '-m', 'main-push: undo own commit after a conflict', 'refs/heads/main', parent, head]).status !== 0) return false;
  run(cwd, ['reset', '--quiet', parent, '--', ...files]);
  return true;
}

/**
 * --onto <sha>: the lane merged its files against origin/main as of <sha>. Refuse when origin/main has changed one of
 * them since; otherwise point their index entries at origin/main's version, so the sync moves past them and the
 * worktree (the lane's merged content) stays as it is.
 * @param {string} cwd @param {string} onto @param {string[]} files @param {string} [remote]
 */
export function prepareOnto(cwd, onto, files, remote = 'origin') {
  const fetched = run(cwd, ['fetch', '--quiet', remote, 'main']);
  if (fetched.status !== 0) throw new StopError(`git fetch ${remote} main: ${firstLines(fetched.stderr)}`);
  const base = run(cwd, ['rev-parse', '--verify', '--quiet', `${onto}^{commit}`]).stdout.trim();
  if (!base) throw new StopError(`--onto ${onto} is not a commit here`);
  const upstream = git(cwd, ['rev-parse', `refs/remotes/${remote}/main`]);
  const blob = (/** @type {string} */ commit, /** @type {string} */ file) => run(cwd, ['rev-parse', '--verify', '--quiet', `${commit}:${file}`]).stdout.trim();
  const moved = files.filter((file) => blob(base, file) !== blob(upstream, file));
  if (moved.length > 0) {
    const error = new StopError(`origin/main changed ${moved.join(', ')} again since ${base.slice(0, 8)}; nothing moved`);
    error.conflict = { upstream, files: moved };
    throw error;
  }
  const known = files.filter((file) => blob(upstream, file));
  const fresh = files.filter((file) => !blob(upstream, file));
  if (known.length > 0) git(cwd, ['reset', '--quiet', upstream, '--', ...known]);
  if (fresh.length > 0) run(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...fresh]);
}

/** The shell command to run once the lane has merged its files against `upstream`.
 * @param {string} upstream @param {string[]} messages @param {string[]} files */
export function ontoCommand(upstream, messages, files) {
  const quote = (/** @type {string} */ text) => (/^[\w@%+=:,./-]+$/u.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
  return ['node src/scripts/.kit/main-push.mjs --onto', upstream.slice(0, 12), ...messages.flatMap((message) => ['-m', quote(message)]), ...files.map(quote)].join(' ');
}

/** The STOP text for a conflict: what to merge and the exact command that finishes it.
 * @param {{upstream:string,files:string[]}} conflict @param {string[]} messages @param {string[]} mine @param {boolean} undone */
export function conflictAdvice({ upstream, files }, messages, mine, undone) {
  const show = files.map((file) => `git show ${upstream.slice(0, 12)}:${file}`).join('; ');
  const where = undone ? `Your commit is undone and your edits are back, uncommitted, in ${mine.join(', ')}.` : 'Your files are as they were.';
  return `${where} Another lane changed the same lines. Do not rebase here: in this shared checkout git rebase --continue ` +
    `refuses beside other lanes' edits and git rebase --abort wipes them. Instead write each file as origin/main's version ` +
    `(${show}) plus your change (git diff -- <file> shows it), then run: ${ontoCommand(upstream, messages, mine)}`;
}

/**
 * Take the checkout's main-push lock (a directory in the git dir), so two runs never move main at once. A lock whose
 * process is gone, or that is over 10 minutes old, is taken over. Waits like a sync does, then stops.
 * @param {string} cwd @param {{tries?:number,wait?:number,sleep?:(seconds:number)=>void,log?:(line:string)=>void}} [options]
 * @returns {() => void} the release
 */
export function takeLock(cwd, { tries = 8, wait = 5, sleep = sleepSeconds, log = () => { /* No logging requested. */ } } = {}) {
  const lock = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'main-push.lock']));
  const owner = join(lock, 'pid');
  for (let attempt = 1; ; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(owner, `${process.pid}\n`);
      return () => rmSync(lock, { recursive: true, force: true });
    } catch (error) {
      const failure = /** @type {NodeJS.ErrnoException} */ (error);
      if (failure.code !== 'EEXIST') throw new StopError(`cannot take the lock ${lock}: ${failure.message}`);
    }
    let pid = 0;
    try {
      pid = Number(readFileSync(owner, 'utf8').trim());
    } catch {
      pid = 0;
    }
    let alive = pid > 0;
    if (alive) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        alive = /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
      }
    }
    const old = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > 30 * 60 * 1000;
    if ((!alive && pid > 0) || old) {
      log(`taking over a stale lock (pid ${pid || '?'}${old ? ', over 30 min old' : ', gone'})`);
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (attempt >= tries) throw new StopError(`another main-push (pid ${pid || '?'}) holds ${lock}; nothing moved. Run this again when it finishes`);
    // Another lane's gate holds the lock for a minute or two: poll at most every 15 s, so the lock never sits idle.
    const seconds = Math.min(wait * 2 ** (attempt - 1), 15);
    log(`try ${attempt} of ${tries}: another main-push (pid ${pid || '?'}) is running; trying again in ${seconds} s`);
    sleep(seconds);
  }
}

/** After a stop: the checkout must be on main and not mid-rebase or mid-merge. Say so loudly when it is not.
 * @param {string} cwd */
export function verifyAfterStop(cwd) {
  try {
    checkState(cwd);
    return '';
  } catch (error) {
    return `!! main-push STOPPED AND THE SHARED CHECKOUT IS NOT CLEAN: ${error instanceof Error ? error.message : String(error)}. Tell the coordinator now`;
  }
}

/** @param {number} seconds */
function sleepSeconds(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{messages:string[],files:string[],tries:number,wait:number,onto:string}} */
  const out = { messages: [], files: [], tries: 8, wait: 5, onto: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-m' || arg === '--message') out.messages.push(argv[++i] ?? '');
    else if (arg === '--tries') out.tries = Number(argv[++i]);
    else if (arg === '--wait') out.wait = Number(argv[++i]);
    else if (arg === '--onto') out.onto = argv[++i] ?? '';
    else if (arg === '--') { out.files.push(...argv.slice(i + 1)); i = argv.length; }
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else out.files.push(arg);
  }
  if (out.files.length > 0 && !out.messages.some((message) => message.trim())) return { error: 'files need a message: -m "<subject>"' };
  if (out.files.length === 0 && out.messages.length > 0) return { error: '-m needs the files to commit' };
  if (out.onto !== '' && !/^[0-9a-f]{7,40}$/u.test(out.onto)) return { error: '--onto takes the origin/main SHA the STOP line printed' };
  if (out.onto && out.files.length === 0) return { error: '--onto needs -m and the files' };
  if (!Number.isInteger(out.tries) || out.tries < 1 || !Number.isFinite(out.wait) || out.wait < 0) return { error: '--tries takes 1 or more, --wait seconds' };
  return out;
}

/**
 * Run the pre-push on local main's outgoing commits now, outside the lock, and mark them gated (scripts/main-push-gated.mjs):
 * the push under the lock then skips its gate when nothing but these commits goes out. Exit 0 or a StopError with the
 * gate's RED lines. WS_MAIN_PUSH_PREGATE=0 turns it off (the gate runs under the lock, as before).
 * @param {string} cwd @param {(line: string) => void} log @param {string} [remote]
 */
export async function pregate(cwd, log, remote = 'origin') {
  const local = git(cwd, ['rev-parse', 'HEAD']), base = git(cwd, ['rev-parse', `refs/remotes/${remote}/main`]);
  if (run(cwd, ['merge-base', '--is-ancestor', local, base]).status === 0) return 'nothing to gate';
  // Row 58: the gate checks what goes out, this lane's commits without another lane's.
  const { sha: head, left } = ownCommits(cwd, base, local);
  if (left.length > 0) log(`another lane's local commit(s) stay on local main (row 58): ${nameCommits(left)}`);
  if (head === base) return 'nothing of this lane\'s to gate';
  const hook = join(cwd, '.githooks/pre-push');
  if (!existsSync(hook)) return 'no pre-push to run early';
  const url = git(cwd, ['remote', 'get-url', '--push', remote]);
  const logFile = resolve(cwd, git(cwd, ['rev-parse', '--git-path', `main-push-gate-${process.pid}.log`]));
  const fd = openSync(logFile, 'w');
  const began = Date.now();
  // Row 53: a carried commit drops SKIP_CHECK, so its gate runs; a gate skipped by SKIP_CHECK marks nothing, or a later
  // push carrying these commits would skip its gate on the mark.
  const carried = carriedRows(cwd, `${base}..${head}`);
  const { env, dropped } = gateEnv({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), WS_MAIN_WATCH: '0', WS_LAND_MAIN_PUSH: `main-push:${head}` }, carried);
  if (dropped) log(`SKIP_CHECK=1 dropped: ${carried.length} commit(s) of another lane ride along (M1), so the gate runs: ${carried.join('; ')}`);
  let gated;
  try {
    // FS18: the same marker the push under the lock carries (`pushMain`), so pin provenance passes main-push's own
    // test/pins change here too; without it the early gate refused every pin re-record (opus-of19b0, 2026-11-19).
    gated = spawnSync('bash', [hook, remote, url], { cwd, env, input: `refs/heads/main ${head} refs/heads/main ${base}\n`, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['pipe', fd, fd] });
  } finally {
    closeSync(fd);
  }
  if (gated.status !== 0) {
    // oxlint-disable-next-line no-control-regex -- strips terminal colour codes.
    const lines = readFileSync(logFile, 'utf8').split('\n').map((line) => line.replaceAll(/\u001B\[[0-9;]*m/gu, '').trim()).filter(Boolean);
    const red = lines.filter((line) => /(?:^|\s)(?:RED|X)\s|NEW red|blocked|refused|Error: |error TS\d|: error /u.test(line)).slice(0, 8);
    throw new StopError(`the gate (run before the lock) refused: ${(red.length > 0 ? red : lines.slice(-8)).join(' | ')}. Whole output: ${logFile}`);
  }
  rmSync(logFile, { force: true });
  if (env.SKIP_CHECK === '1') return 'SKIP_CHECK=1: the gate skipped this lane\'s own commits; nothing marked gated';
  const { markGated } = await import('../main-push-gated.mjs');
  const marked = markGated(cwd, `${base}..${head}`);
  return `gate green before the lock in ${Math.round((Date.now() - began) / 1000)} s; ${marked} commit(s) marked`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    console.error(`main-push: ${options.error}\nusage: node src/scripts/.kit/main-push.mjs [-m "<subject>" [-m "<body>"]... <file>...] [--tries n] [--wait s]`);
    process.exit(2);
  }
  const cwd = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const log = (/** @type {string} */ line) => console.log(`main-push ${line}`);
  let release = () => { /* No lock acquired yet. */ };
  // Five lanes' pushes can queue for the lock: wait up to about 30 min for it unless --tries says otherwise.
  const lockTries = process.argv.includes('--tries') ? options.tries : 120;
  const lock = () => { release = takeLock(cwd, { tries: lockTries, wait: options.wait, log }); };
  const unlock = () => { release(); release = () => { /* Released. */ }; };
  // A retry's wait never holds the lock: other lanes push meanwhile (a held lock once slept 5 min on another lane's edit).
  const sleepUnlocked = (/** @type {number} */ seconds) => { unlock(); sleepSeconds(seconds); lock(); };
  let made = '';
  try {
    checkState(cwd);
    const named = laneName(process.env, 'main-push');
    if ('refusal' in named) throw new StopError(named.refusal);
    // Row 37: under an open engine land HOLD nothing is committed, so no other lane's push carries it along (M1).
    const held = options.files.length > 0 ? holdRefusal({ lane: currentLane(), bodies: options.messages.join('\n'), files: options.files }) : null;
    if (held !== null) { receipt(`main-push STOP ${held}`); throw new StopError(held); }
    lock();
    const pending = heldCommits(cwd).filter(row => row.lane === currentLane());
    if (!options.onto && pending.length > 0) throw new StopError(heldAdvice(cwd, pending[0]));
    const commit = () => {
      made = commitFiles(cwd, options.files, options.messages);
      log(`committed ${made}`);
    };
    if (options.onto) {
      prepareOnto(cwd, options.onto, options.files);
      try {
        log(syncAndPush(cwd, { tries: options.tries, wait: options.wait, log, afterSync: commit, sleep: sleepUnlocked }));
      } catch (error) {
        if (!made) run(cwd, ['reset', '--quiet', 'HEAD', '--', ...options.files]);
        throw error;
      }
    } else {
      if (options.files.length > 0) commit();
      if (process.env.WS_MAIN_PUSH_PREGATE !== '0') {
        // Sync once under the lock, so the gate sees the commits on today's main; then gate with the lock free.
        try {
          log(syncMain(cwd));
        } catch (error) {
          if (!(error instanceof StopError) || !error.retry) throw error;
          log(`sync before the gate: ${error.message}; the gate runs on local main as it is`);
        }
        const installed = freshInstall(cwd);
        if (installed !== '') log(installed);
        unlock();
        log(await pregate(cwd, log));
        process.env.WS_MAIN_PUSH_GATED = '1';
        lock();
      }
      log(syncAndPush(cwd, { tries: options.tries, wait: options.wait, log, sleep: sleepUnlocked }));
    }
    if (options.onto) {
      for (const row of pending.filter(heldRow => heldRow.files.every(file => options.files.includes(file)))) {
        rmSync(join(heldDirectory(cwd), `${row.sha}.json`));
        git(cwd, ['update-ref', '-d', row.ref, row.sha]);
      }
    }
    const ownHeld = heldCommits(cwd).find(row => row.lane === currentLane());
    if (ownHeld !== undefined) throw new StopError(heldAdvice(cwd, ownHeld));
  } catch (error) {
    if (!(error instanceof StopError)) throw error;
    let message = error.message;
    if (error.conflict && options.files.length > 0) {
      const undone = made !== '' && uncommit(cwd, made, options.files);
      message += `. ${conflictAdvice(error.conflict, options.messages, options.files, undone)}`;
    } else if (error.conflict) {
      message += ". Your commits stay on local main. Do not rebase here (--continue refuses beside other lanes' edits, --abort wipes them); ask the coordinator";
    }
    console.error(`main-push STOP ${message}`);
    const loud = verifyAfterStop(cwd);
    if (loud) console.error(loud);
    process.exitCode = 1;
  } finally {
    release();
  }
}
