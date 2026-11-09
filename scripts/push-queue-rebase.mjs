// Rebase only the queue's private checkout; never alter its source checkout.
import {spawnSync,execFileSync} from 'node:child_process';
import {existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

const stamps=['scripts/renderer-revision.json','scripts/validation-revision.json'];
/** @param {string} snapshot @param {NodeJS.ProcessEnv} environment */
export function rebaseQueuedSnapshot(snapshot,environment){
 const env={...environment,GIT_EDITOR:'true'};
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd:snapshot,env,encoding:'utf8'}).trim();
 if(realpathSync(git(['rev-parse','--show-toplevel']))!==realpathSync(snapshot))throw new Error('Queue rebase refuses a crossed snapshot checkout');
 if(git(['status','--porcelain','--untracked-files=normal'])!=='')throw new Error(`Queue private snapshot is dirty before rebase: ${snapshot}`);
 /** @param {string} command @param {string[]} args */
 const run=(command,args)=>{
  const result=spawnSync(command,args,{cwd:snapshot,env,encoding:'utf8',maxBuffer:32*1024*1024});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  return result;
 };
 const generate=()=>{
  if(run('pnpm',['install','--frozen-lockfile']).status!==0)throw new Error('Queue stamp regeneration dependency install failed');
  for(const official of ['scripts/stamp-renderer-revision.mjs','scripts/stamp-validation-revision.mjs']){
   if(!existsSync(join(snapshot,official))||run(process.execPath,[official]).status!==0)throw new Error(`Queue official stamp regeneration failed: ${official}`);
  }
 };
 for(let race=0;race<2;race++){
  if(run('git',['fetch','origin','main']).status!==0)throw new Error('Queue private snapshot origin fetch failed');
  const target=git(['rev-parse','refs/remotes/origin/main']);
  let result=run('git',['rebase','--empty=keep',target]);
  for(let resolutions=0;result.status!==0;resolutions++){
   const conflicts=git(['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean);
   if(conflicts.length===0)throw new Error(`Queue snapshot rebase refused without merge conflicts: ${result.stderr?.trim()??'Git unavailable'}`);
   if(conflicts.some(file=>!stamps.includes(file)))throw new Error(`Queue snapshot rebase conflict: ${conflicts.join(', ')}; owner must fix these source paths`);
   if(resolutions>=128)throw new Error('Queue generated-only conflict resolution limit reached');
   generate();
   if(run('git',['add','--',...conflicts]).status!==0)throw new Error('Queue could not stage the officially regenerated conflict paths');
   result=run('git',['rebase','--continue']);
  }
  // Detect an ordinary remote advance before spending a complete gate.
  if(run('git',['fetch','origin','main']).status!==0)throw new Error('Queue post-rebase origin fetch failed');
  if(git(['rev-parse','refs/remotes/origin/main'])!==target){
   if(race===0)continue;
   throw new Error('Queue origin advanced twice during rebase; retry this job');
  }
  // Intermediate stamp commits cannot know the final combined input inventory.
  // Compute both official stamps once more after every source commit is present.
  if(stamps.every(file=>existsSync(join(snapshot,file)))){
   generate();
   const changed=git(['diff','--name-only','--',...stamps]).split('\n').filter(Boolean);
   if(changed.length>0){
    const message='chore(build): stamp the queued source tree\n\nRegenerate official revisions after private rebase; retain every source\ncommit and require the normal full publication gate.\n\nAssisted-by: Codex:gpt-6.1-sol';
    const command=existsSync(join(snapshot,'scripts/commit.sh'))?'bash':'git';
    const args=command==='bash'?['scripts/commit.sh',message,'--',...changed]:['commit','-m',message,'--',...changed];
    if(run(command,args).status!==0)throw new Error('Queue official generated-stamp commit failed its normal hook');
   }
  }
  if(git(['status','--porcelain','--untracked-files=normal'])!=='')throw new Error('Queue private snapshot changed outside the two official generated stamps');
  return target;
 }
 throw new Error('Queue rebase retry exhausted');
}
