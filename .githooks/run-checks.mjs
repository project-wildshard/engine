// The code-quality lanes, keyed off package.json scripts so they switch
// on by themselves once the scaffold defines them.
//   commit: like the scaffold's own pre-commit: `lint` and `format:check`
//           on the staged code files only, plus the whole `typecheck`,
//           in parallel under a budget (silent < 5 s, warn 5-8 s, BLOCK
//           > 8 s; SKIP_BUDGET=1). Skipped when no code or JSON is staged.
//   push:   the full `check` script (adds knip and the unit tests).
// The hooks only check; `pnpm fix` (or `pnpm lint:fix` / `pnpm format`) fix.
// Bypass a lane: SKIP_CHECK=1 (last resort; CI still runs it).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from './lib.mjs';

const lane = process.argv[2];
const root = git(['rev-parse', '--show-toplevel']).trim();
const SOFT = Number(process.env.PRECOMMIT_SOFT_S ?? 5);
const HARD = Number(process.env.PRECOMMIT_HARD_S ?? 8);
const LINTABLE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const FORMATTABLE = /\.(?:ts|tsx|js|mjs|cjs|json|jsonc)$/;

if (process.env.SKIP_CHECK === '1') {
  console.error(`  - SKIP_CHECK=1: ${lane} lane skipped (CI still runs it)`);
  process.exit(0);
}
// A push that only deletes managed plan/release branches sends no commit,
// so there is nothing to check. Any
// other deleted ref, or any update pushed alongside, keeps the gate.
if (lane === 'push') {
  const lines = (process.env.WS_PUSH_REFS ?? '').split('\n').map((line) => line.trim().split(/\s+/u)).filter((row) => row[0] !== '');
  if (lines.length > 0 && lines.every(([, local = '', remote = '']) => /^0+$/u.test(local) && /^refs\/heads\/(?:plan\/[a-z0-9][a-z0-9._-]*|release\/(?:dryrun-)?v\d+\.\d+\.\d+)$/u.test(remote))) {
    console.error(`  - delete-only push of ${lines.map(([, , remote]) => remote).join(', ')}: no commit leaves this machine; push lane skipped`);
    process.exit(0);
  }
  // Meta QA 11-25 row 113 (J381): re-creating deleted branches at a sha the destination's main holds or the
  // deleted-branches log recorded sends no new code (.githooks/branch-restore.mjs); ALLOW_BRANCH_RESTORE=1 is its
  // hatch. Never a main push.
  const { restoreVerdict } = await import('./branch-restore.mjs');
  const restore = restoreVerdict(root, process.env.WS_PUSH_REFS ?? '');
  if (restore.ok) {
    console.error(`  - ${restore.reason}; push lane skipped`);
    process.exit(0);
  }
}
// A merge-back only carries the version and notes already tested on the tagged release branch.
// The outgoing main tip must be its first parent; unrelated outgoing commits keep the normal gate.
if (lane === 'push') {
  const { releaseMerge } = await import('./release-merge.mjs');
  const tag = releaseMerge(process.env.WS_PUSH_REFS ?? '', root);
  if (tag !== null) {
    console.error(`  - release merge-back ${tag}: version and changelog only; release CI already passed`);
    const sha = (process.env.WS_PUSH_REFS ?? '').trim().split(/\s+/u)[1];
    if (process.env.WS_MAIN_WATCH !== '0' && existsSync(join(root, 'src/scripts/main-watch.mjs'))) {
      const laneName = process.env.WS_LANE_NAME ?? '', pane = process.env.HERDR_PANE_ID ?? '';
      const watchEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      spawn(process.execPath, [join(root, 'src/scripts/main-watch.mjs'), `--follow=${sha}`, '--after-push=300',
        ...(laneName === '' ? [] : [`--lane=${laneName}`]), ...(pane === '' ? [] : [`--pane=${pane}`])],
      { cwd: root, env: watchEnv, detached: true, stdio: 'ignore' }).unref();
    }
    process.exit(0);
  }
}

// The package is at the repo root; its configs live in src/.
const pkgDir = root;
const pkgPath = join(pkgDir, 'package.json');
const scripts = existsSync(pkgPath) ? (JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}) : {};

if (lane === 'push' && scripts.check && existsSync(join(root, 'src/scripts/push-budget.mjs'))) {
  const {pushEnvironment}=await import('./push-checks.mjs');
  const {PUSH_PROFILE,SPLIT_PROFILE}=await import('../src/scripts/push-budget.mjs');
  const {pushSelection}=await import('../src/scripts/push-selection.mjs');
  const {hostedReleaseProof,releaseTag}=await import('../src/scripts/release-gate.mjs');
  const {capturePushTree,readPushProof}=await import('../src/scripts/push-proof-cache.mjs');
  const {landMainMode,mainPushed,planBaseRefs,splitRequested}=await import('../src/scripts/push-local-split.mjs');
  const env = pushEnvironment(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))));
  // Land marks its own main push. History, secrets, size, the changelog and AGENTS.md already ran above in
  // pre-push. J422's `push` takes the ordinary split gate below, like any main push. FLOW-SIMPLE FS5 deleted the
  // hosted land's `exact` and `carried` pushes, FS23 J400's full local gate (`local`).
  // The marker is read from the hook's own environment: the gate's environment keeps only its allowlist.
  const landMain=landMainMode({...env,WS_LAND_MAIN_PUSH:process.env.WS_LAND_MAIN_PUSH},env.WS_PUSH_REFS);
  // BUILD-MAX EV2 (J288, WL13): a main push from the canonical checkout runs the split gate too
  // (src/scripts/push-local-split.mjs MAIN_PUSH_SPLIT); main's own CI runs the full suite and main-watch reports it.
  const split=splitRequested(env);
  // BUILD-MAX EV1 (WL11): the gate checks the pushed commit in a clean copy of it (src/scripts/push-gate-copy.mjs), so
  // another lane's work in progress in this checkout neither refuses the push nor leaks into the checks.
  for(const key of Object.keys(process.env))if(key.startsWith('GIT_'))Reflect.deleteProperty(process.env,key);
  const {copyReason,makeGateCopy,pushedCommit}=await import('../src/scripts/push-gate-copy.mjs');
  const sha=pushedCommit(root,env.WS_PUSH_REFS),why=copyReason(root,sha,env,undefined,landMain==='push');
  // main-push gated these commits before it took the lock (src/scripts/main-push-gated.mjs): the push under the lock
  // skips the gate when every outgoing commit carries its mark. Read from the hook's own environment.
  const pregated=process.env.WS_MAIN_PUSH_GATED==='1'?(await import('../src/scripts/main-push-gated.mjs')).pregated(root,env.WS_PUSH_REFS):null;
  let copy=null;
  if(pregated===null&&why!==null&&sha!==null){
    console.error(`  - gate in a clean copy of ${sha.slice(0,10)}: ${why}`);
    copy=makeGateCopy(root,sha,{env,testPins:true});
  }
  const gateRoot=copy?.path??pkgDir;
  let code=1;
  try{
    const context=pregated!==null?null:capturePushTree(split?SPLIT_PROFILE:PUSH_PROFILE,env,gateRoot);
    const proof=context===null?null:readPushProof(context,pushSelection(
      split?planBaseRefs(env.WS_PUSH_REFS,gateRoot):env.WS_PUSH_REFS,gateRoot,{releaseDestination:env.WS_PUSH_DESTINATION}));
    const observation=process.argv[3]==='--release-observation';
    const release=context===null||proof!==null?null:observation
      ?{commit:context.commit,version:'v'+JSON.parse(readFileSync(join(gateRoot,'package.json'),'utf8')).version}
      :releaseTag(env.WS_PUSH_REFS,env.WS_PUSH_DESTINATION,gateRoot);
    const hosted=release!==null&&release.commit===context?.commit?hostedReleaseProof(release,gateRoot):null;
    // Outgoing history/secrets have already passed in pre-push. Reusing a proved
    // tree starts no heavy work, so it must not wait behind a later full suite.
    if(pregated!==null){
      console.error(`  - pre-gated by main-push: all ${pregated} outgoing commit(s) passed this gate before the lock (patch ids match); no gate under the lock`);
      code=0;
    }else if(proof!==null){
      console.error(`  - exact-tree green reuse before lease: ${proof.tree}; run ${proof.run}; commit ${proof.commit}; ${proof.mode}; ${proof.seconds.toFixed(1)} s; ${proof.finished}`);
      code=0;
    }else if(hosted!==null){
      console.error(`  - release: skipped pnpm check; exact hosted CI proof ${hosted.run} on ${hosted.branch} for ${hosted.commit}${hosted.reused===undefined?'':` (release-only over ${hosted.parent}, code proved by main CI ${hosted.reused})`}`);
      code=0;
    }else{
      // A miss owns the lane before generation/static work too.
      const observationArgs=observation?['--observation-kind','release']:[];
      const child = spawn('python3', ['src/scripts/heavy-lane.py', 'full-test', '--checkout-scope', ...observationArgs, '--', process.execPath, '.githooks/push-checks.mjs'],
        { cwd: gateRoot, env: { ...env, PWD: gateRoot, WS_PUSH_GATE_PROFILE: 'full-v1', WS_CPU_ADMISSION: '1' }, stdio: 'inherit' });
      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
      code = await new Promise(resolveCode => {
        child.once('error', error => { console.error(error); resolveCode(1); });
        child.once('close', value => resolveCode(value ?? 1));
      });
    }
    // A gate that regenerated a tracked file (gen:inputs) fails on the copy's dirt; name it, since the copy goes.
    if(code!==0&&copy!==null){
      const {checkedTreeDirt}=await import('../src/scripts/push-proof-cache.mjs');
      const dirt=checkedTreeDirt(copy.path);
      if(dirt.length>0)console.error(`  !! the gate changed ${dirt.length} file(s) in the copy; regenerate them in your checkout (pnpm gen:inputs) and commit them with your change:\n${dirt.slice(0,10).map(line=>`     ${line}`).join('\n')}`);
    }
  }finally{copy?.remove();}
  // EV2: a green split main push hands main's verdict to main-watch, as land does (LS5). It waits for this SHA to
  // reach origin/main and quits quietly if the push never lands (a lost race).
  if(code===0&&split&&landMain===null&&sha!==null&&mainPushed(env.WS_PUSH_REFS)&&process.env.WS_MAIN_WATCH!=='0'&&existsSync(join(root,'src/scripts/main-watch.mjs'))){
    const lane=process.env.WS_LANE_NAME??'',pane=process.env.HERDR_PANE_ID??'';
    try{
      const mainSha=(env.WS_PUSH_REFS??'').split('\n').map(line=>line.trim().split(/\s+/u)).find(row=>row[2]==='refs/heads/main')?.[1]??sha;
      spawn(process.execPath,[join(root,'src/scripts/main-watch.mjs'),`--follow=${mainSha}`,'--after-push=300',...(lane===''?[]:[`--lane=${lane}`]),...(pane===''?[]:[`--pane=${pane}`])],
        {cwd:root,env:process.env,detached:true,stdio:'ignore'}).unref();
      console.error(`  - main-watch follows ${sha.slice(0,10)} once it reaches main; main's ci runs the full suite (J249: a red is fixed forward at once)`);
    }catch(error){console.error(`  !! main-watch not started (${error instanceof Error?error.message:String(error)}); run node src/scripts/main-watch.mjs by hand`);}
  }
  process.exit(code);
}

/** @type {{ name: string, args: string[] }[]} */
const jobs = [];
if (lane === 'commit') {
  // Staged code under src/, passed relative to the repo root (the
  // package root). Code outside src/ (.githooks, docs) has its own checks.
  const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean)
    .filter((path) => path.startsWith('src/'));
  const lint = staged.filter((path) => LINTABLE.test(path));
  const format = staged.filter((path) => FORMATTABLE.test(path));
  if (scripts.lint && lint.length) jobs.push({ name: 'lint', args: ['lint', ...lint] });
  if (scripts['format:check'] && format.length) {
    jobs.push({ name: 'format:check', args: ['format:check', '--no-error-on-unmatched-pattern', ...format] });
  }
  // WL20: tracked and staged files only; another lane's untracked scratch is not in this commit.
  if (scripts.typecheck && format.length) jobs.push({ name: 'typecheck', command: [process.execPath, join(root, '.githooks', 'commit-typecheck.mjs')] });
  if (!jobs.length) {
    if (Object.keys(scripts).length) console.error('  - no code staged: commit lane skipped');
    process.exit(0);
  }
} else if (scripts.check) {
  jobs.push({ name: 'check', args: ['check'] });
}
if (!jobs.length) process.exit(0); // no toolchain yet

if (!existsSync(join(pkgDir, 'node_modules'))) {
  console.error(`\n  X ${lane} blocked: node_modules is missing. Run pnpm install (or SKIP_CHECK=1).\n`);
  process.exit(1);
}
// QA 11-25 row 92: after a pull moved the lockfile, the commit lane ran the old npm-bin-deps runner, which rewrote the
// tracked .bin-deps files from the repo's pnpm settings. A lane never runs tools older than the lockfile.
const lagModule = join(pkgDir, 'src/scripts/install-lag.mjs');
if (existsSync(lagModule)) {
  const { installLag } = await import(pathToFileURL(lagModule).href);
  const lag = installLag(pkgDir);
  if (lag !== '') {
    console.error(`\n  X ${lane} blocked: node_modules is behind (${lag}), and its old tools can rewrite tracked files` +
      ' such as .bin-deps. Run pnpm install (or SKIP_CHECK=1).\n');
    process.exit(1);
  }
}

// Hooks export GIT_INDEX_FILE and friends; tools that shell out to git
// (knip, tests that build repos) must see a normal environment.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const run = ({ name, args = [], command = ['pnpm', 'run', '--silent', ...args] }) => new Promise((done) => {
  const child = spawn(command[0], command.slice(1), { cwd: pkgDir, env });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.on('close', (code) => done({ name, code, output }));
});

console.error(`  - ${lane} lane: pnpm ${jobs.map((job) => job.name).join(', ')}`);
const started = Date.now();
const results = await Promise.all(jobs.map(run));
const seconds = (Date.now() - started) / 1000;

const failed = results.filter((result) => result.code !== 0);
for (const { name, output } of failed) console.error(`\n  X pnpm ${name} failed:\n${output.trim().replace(/^/gm, '    ')}`);
if (failed.length) {
  const fix = lane === 'commit' ? ` (${scripts.fix ? 'pnpm fix fixes' : 'pnpm lint:fix / pnpm format fix'} most of it)` : '';
  console.error(`\n  ${lane} blocked. Fix it${fix}; SKIP_CHECK=1 is a last resort.\n`);
  process.exit(1);
}

if (lane === 'commit') {
  if (seconds > HARD && process.env.SKIP_BUDGET !== '1') {
    console.error(`\n  X commit blocked: the commit lane took ${seconds.toFixed(1)} s, over the ${HARD} s budget.`);
    console.error('    Something slow crept in; move it to the push lane. Loaded machine? SKIP_BUDGET=1.\n');
    process.exit(1);
  }
  if (seconds > SOFT) console.error(`  !! commit lane took ${seconds.toFixed(1)} s (soft ${SOFT} s, hard ${HARD} s)`);
}
console.error(`  - ${lane} lane green in ${seconds.toFixed(1)} s`);
