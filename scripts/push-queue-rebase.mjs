// Rebase only the queue's private checkout; never alter its source checkout.
import {spawnSync,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const stamps=['scripts/renderer-revision.json','scripts/validation-revision.json'];
/** @param {string} snapshot @param {NodeJS.ProcessEnv} environment */
export function rebaseQueuedSnapshot(snapshot,environment){
 const env={...environment,GIT_EDITOR:'true'};
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd:snapshot,env,encoding:'utf8'}).trim();
 if(realpathSync(git(['rev-parse','--show-toplevel']))!==realpathSync(snapshot))throw new Error('Queue rebase refuses a crossed snapshot checkout');
 if(git(['status','--porcelain','--untracked-files=normal'])!=='')throw new Error(`Queue private snapshot is dirty before rebase: ${snapshot}`);
 /** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [variables] */
 const run=(command,args,variables=env)=>{
  const result=spawnSync(command,args,{cwd:snapshot,env:variables,encoding:'utf8',maxBuffer:32*1024*1024});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  return result;
 };
 const generate=()=>{
  if(run('pnpm',['install','--frozen-lockfile']).status!==0)throw new Error('Queue stamp regeneration dependency install failed');
  // During a replay HEAD is the preceding commit: the index is the actual
  // combined source inventory, including this commit's additions/deletions.
  const file=resolve(snapshot,git(['rev-parse','--git-path',`queue-stamp-inventory-${randomUUID()}.json`]));
  const root=realpathSync(snapshot),files=[...new Set(git(['ls-files','--cached','-z']).split('\0').filter(Boolean))];
  writeFileSync(file,JSON.stringify({root,files}),{mode:0o600});
  try{
   const variables={...env,WS_GENERATION_TREE_ROOT:root,WS_GENERATION_TREE_FILES:file};
   for(const official of ['scripts/stamp-renderer-revision.mjs','scripts/stamp-validation-revision.mjs']){
    if(!existsSync(join(snapshot,official))||run(process.execPath,[official],variables).status!==0)throw new Error(`Queue official stamp regeneration failed: ${official}`);
   }
  }finally{unlinkSync(file);}
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
   if(run('git',['add','--',...stamps]).status!==0)throw new Error('Queue could not stage the two officially regenerated stamp paths');
   result=run('git',['rebase','--continue']);
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
  // Include dependency preparation and final generation in the pre-gate race
  // window; never spend a full gate on a known out-of-date combined tree.
  if(run('git',['fetch','origin','main']).status!==0)throw new Error('Queue post-generation origin fetch failed');
  if(git(['rev-parse','refs/remotes/origin/main'])!==target){
   if(race===0)continue;
   throw new Error('Queue origin advanced twice during rebase; retry this job');
  }
  if(git(['status','--porcelain','--untracked-files=normal'])!=='')throw new Error('Queue private snapshot changed outside the two official generated stamps');
  return target;
 }
 throw new Error('Queue rebase retry exhausted');
}
