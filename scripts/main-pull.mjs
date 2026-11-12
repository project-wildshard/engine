// BUILD-MAX EV1 / meta WORKTREE-LAND WL11 (J290): mode 1's pull, `node scripts/main-pull.mjs`, in place of
// `git pull --rebase origin main` in the canonical checkout. Git's rebase refuses while any lane has an unstaged edit
// there, so one lane's work in progress stopped every other lane's pull. This one touches only the paths it must:
//
//   1. `git fetch origin main`;
//   2. HEAD already contains origin/main: nothing to do;
//   3. otherwise the commits only HEAD has (origin/main..HEAD, every lane's unpushed commits, as a rebase would take)
//      are replayed onto origin/main with `git replay`, which needs no working tree;
//   4. `git read-tree -m -u HEAD <result>` (the two-way merge `git checkout` does) rewrites only the paths that differ
//      between HEAD and the result, refusing before it writes if one of them has an uncommitted change, so every other
//      file, staged or not, stays as it was; then main's ref moves, from the HEAD it read.
//
// Exit 0 when main is current. Exit 1 with one `main-pull STOP` line naming the files or the conflict: wait for the lane
// that owns them and run it again, never stash or restore its files.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

class StopError extends Error{name='StopError';}

/** @param {string} cwd @param {string[]} args */
function run(cwd,args){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 return spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:64<<20});
}
/** @param {string} cwd @param {string[]} args */
function git(cwd,args){
 const result=run(cwd,args);
 if(result.status!==0)throw new StopError(`git ${args.join(' ')}: ${(result.stderr||result.stdout).trim().split('\n').slice(0,6).join(' | ')}`);
 return result.stdout.trim();
}

/** Bring the checkout's main up to origin/main without touching unrelated files.
 * @param {string} cwd @param {{fetch?:boolean,remote?:string}} [options] @returns {string} what it did */
export function mainPull(cwd,{fetch=true,remote='origin'}={}){
 if(run(cwd,['symbolic-ref','--quiet','HEAD']).stdout.trim()!=='refs/heads/main')throw new StopError('the checkout is not on main; mode 1 pulls main only');
 for(const name of ['rebase-merge','rebase-apply','MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD'])
  if(existsSync(resolve(cwd,git(cwd,['rev-parse','--git-path',name]))))throw new StopError(`a git ${name} is in progress; finish or abort it first`);
 if(fetch)git(cwd,['fetch','--quiet',remote,'main']);
 const head=git(cwd,['rev-parse','HEAD']),upstream=git(cwd,['rev-parse',`refs/remotes/${remote}/main`]);
 if(run(cwd,['merge-base','--is-ancestor',upstream,head]).status===0)return `main current at ${head.slice(0,10)}`;
 let target=upstream,how='fast-forward';
 if(run(cwd,['merge-base','--is-ancestor',head,upstream]).status!==0){
  const own=git(cwd,['rev-list','--count',`${upstream}..refs/heads/main`]);
  const replayed=run(cwd,['replay','--ref-action=print','--onto',upstream,`${upstream}..refs/heads/main`]);
  if(replayed.status!==0)throw new StopError(`your ${own} commit(s) conflict with origin/main (${replayed.stderr.trim().split('\n').slice(0,4).join(' | ')}); when no other lane has edits here, git pull --rebase origin main and resolve`);
  const line=replayed.stdout.trim().split('\n').find(row=>row.startsWith('update refs/heads/main ')||row.startsWith('update-ref refs/heads/main '));
  const sha=line?.split(/\s+/u)[2]??'';
  if(!/^[a-f0-9]{40}$/u.test(sha))throw new StopError(`git replay gave no new main (${replayed.stdout.trim().slice(0,200)})`);
  target=sha;how=`rebased ${own} local commit(s)`;
 }
 if(git(cwd,['rev-parse','HEAD'])!==head)throw new StopError('HEAD moved while pulling (another lane committed); run it again');
 // A two-way merge, as `git checkout` does: it refuses before writing anything if a path that changes is dirty, and
 // keeps every other index entry and file (`reset --keep` would unstage another lane's `git add`ed new file).
 const moved=run(cwd,['read-tree','-m','-u',head,target]);
 if(moved.status!==0){
  const files=[...moved.stderr.matchAll(/^error: Entry '([^']+)'/gmu)].map(match=>match[1]);
  throw new StopError(`uncommitted edits in paths main changes, so nothing moved${files.length===0?` (${moved.stderr.trim().split('\n')[0]})`:`: ${files.join(', ')}`}; if they are another lane's, wait for its commit and run this again`);
 }
 git(cwd,['update-ref','-m',`main-pull: ${how}`,'refs/heads/main',target,head]);
 return `main ${head.slice(0,10)} -> ${target.slice(0,10)} (${how}); other lanes' files untouched`;
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.stdout.write(`main-pull ${mainPull(process.cwd())}\n`);}
 catch(error){
  if(!(error instanceof StopError))throw error;
  process.stderr.write(`main-pull STOP ${error.message}\n`);process.exitCode=1;
 }
}
