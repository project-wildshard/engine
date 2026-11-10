// Commit, capture an immutable checkout, and let one per-repo worker own normal pushes.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,openSync,closeSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as v from 'valibot';
import {cloneQueueOrigin} from './push-queue-clone.mjs';
import {rebaseQueuedSnapshot} from './push-queue-rebase.mjs';
import {workerEnvironment} from './push-environment.mjs';

const self=import.meta.filename,lock=fileURLToPath(new URL('push-queue-lock.py',import.meta.url));
// DS16c: the enqueue preflight's verdict, including a WS_PREFLIGHT_SKIP override.
const preflightSchema=v.object({sha:v.string(),seconds:v.number(),refused:v.array(v.string()),warnings:v.array(v.string()),override:v.optional(v.string()),checkOnly:v.optional(v.boolean())});
const jobSchema=v.object({id:v.string(),source:v.string(),snapshot:v.string(),remote:v.string(),sha:v.string(),tree:v.string(),requestedSha:v.optional(v.string()),requestedTree:v.optional(v.string()),owner:v.number(),checkOnly:v.boolean(),state:v.string(),createdAt:v.string(),lane:v.optional(v.string()),attempts:v.optional(v.pipe(v.number(),v.integer(),v.minValue(0))),error:v.optional(v.string()),seconds:v.optional(v.number()),batch:v.optional(v.array(v.string())),failurePhase:v.optional(v.string()),preflight:v.optional(preflightSchema)});
const terminal=new Set(['pushed','checked','already-published','failed','published-unverified','publication-unknown']);
const pending=new Set(['capturing','queued','retrying','rebasing','installing','waiting-for-hook','checking','publishing-ready','pushing','batching']);
class RemoteAdvanceError extends Error{name='RemoteAdvanceError';}
class PublicationUnknownError extends Error{name='PublicationUnknownError';}
const batchOwnerSchema=v.object({schema:v.literal('queue-batch/1'),queue:v.string(),root:v.string(),owner:v.pipe(v.number(),v.integer(),v.minValue(1)),jobs:v.array(v.pipe(v.string(),v.regex(/^\d{9,}-[a-f0-9]{8}$/u)))});

/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
/** A snapshot fetch cannot lazily hydrate an upload-pack's promisor objects.
 * Refuse before creating any job or snapshot, even if HEAD itself is hydrated.
 * @param {string} source */
function refusePartialSource(source){
 const result=spawnSync('git',['config','--get-regexp',String.raw`^(extensions\.partialclone|remote\..*\.(promisor|partialclonefilter))$`],{cwd:source,encoding:'utf8'});
 if(result.error!==undefined||result.status!==0&&result.status!==1)throw new Error('Push queue cannot inspect source clone configuration',{cause:result.error});
 const partial=result.status===0&&result.stdout.trim().split('\n').some(row=>!/^remote\..*\.promisor\s+(?:false|no|off|0)$/iu.test(row));
 if(partial)throw new Error(`Push queue partial-clone source refused: ${source}; use a full clone without promisor/filter configuration before enqueue`);
}
/** @param {string} file @param {object} value */
function write(file,value){const temporary=`${file}.${process.pid}.tmp`;writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`);renameSync(temporary,file);}
/** @param {{id:string,lane?:string}} job @param {string} state @param {string} message */
function notify(job,state,message){
 const file=resolvePath(process.env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
 const lane=/^[a-z][a-z0-9_-]*$/u.test(job.lane??'')?job.lane:'push-queue';
 try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${new Date().toISOString().slice(11,16)} ${lane} push queue ${job.id} ${state}: ${message.replaceAll(/\s+/gu,' ').slice(0,1000)}\n`);}catch(error){console.error('Push queue receipt unavailable',error);}
}
/** A broken record fails only itself; a minimal invalid receipt is not a publication proof.
 * @param {string} directory @param {string} name */
function readJob(directory,name){
 const file=join(directory,name),id=name.slice(0,-5);
 try{
  /** @type {unknown} */const raw=JSON.parse(readFileSync(file,'utf8'));
  if(raw!==null&&typeof raw==='object'&&'invalid'in raw&&raw.invalid===true&&'state'in raw&&raw.state==='failed')return null;
  const job=v.parse(jobSchema,raw);
  if(job.id!==id||!/^\d{9,}-[a-f0-9]{8}$/u.test(id)||job.snapshot!==join(directory,'snapshots',id)||!terminal.has(job.state)&&!pending.has(job.state))throw new Error('Unsafe queue identity or unsupported state');
  identity(job.remote);
  return job;
 }catch(error){
  const message=error instanceof Error?error.message:'Unreadable queue metadata';
  write(file,{id,state:'failed',invalid:true,error:message,finishedAt:new Date().toISOString()});notify({id},'failed',message);return null;
 }
}
/** @param {string} remote */
function identity(remote){
 if(/^(?:https?|ssh):\/\//u.test(remote)){
  const parsed=new URL(remote);if(parsed.password||parsed.search||parsed.hash||parsed.protocol!=='ssh:'&&parsed.username)throw new Error('Queue refuses a credential-bearing remote URL');
 }
 return remote.replace(/^git@([^:]+):/u,'https://$1/').replace(/^ssh:\/\/git@/u,'https://').replace(/\.git\/?$/u,'').replace(/\/$/u,'');
}
/** @param {string} directory */
function worker(directory){
 const output=openSync(join(directory,'worker.log'),'a');
 const child=spawn('python3',[lock,join(directory,'worker.lock'),process.execPath,self,'work',directory],{env:workerEnvironment(),detached:true,stdio:['ignore',output,output]});
 child.on('error',error=>{console.error(`Push queue worker unavailable: ${error.message}`);});child.unref();closeSync(output);
}
/** @param {string} source @param {string} directory @param {boolean} checkOnly @param {string | undefined} requested */
function capture(source,directory,checkOnly,requested){
 refusePartialSource(source);
 if(git(source,['branch','--show-current'])!=='main')throw new Error('Push queue accepts main only');
 const number=Number(existsSync(join(directory,'next'))?readFileSync(join(directory,'next'),'utf8'):0);
 if(!Number.isSafeInteger(number)||number<0)throw new Error('Invalid queue sequence');
 writeFileSync(join(directory,'next.tmp'),String(number+1));renameSync(join(directory,'next.tmp'),join(directory,'next'));
 const id=`${String(number).padStart(9,'0')}-${randomUUID().slice(0,8)}`,snapshot=join(directory,'snapshots',id),file=join(directory,`${id}.json`);
 const sha=requested??git(source,['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/u.test(sha)||spawnSync('git',['merge-base','--is-ancestor',sha,'HEAD'],{cwd:source}).status!==0)throw new Error('Queue target must be a full commit on source main');
 const remote=git(source,['remote','get-url','origin']);identity(remote);
 const preflight=v.safeParse(preflightSchema,(()=>{try{return JSON.parse(process.env.WS_PREFLIGHT_RECORD??'null');}catch{return null;}})());
 const job={id,source,snapshot,remote,sha,tree:git(source,['rev-parse',`${sha}^{tree}`]),owner:process.pid,checkOnly,state:'capturing',createdAt:new Date().toISOString(),lane:process.env.WS_LANE_NAME??'push-queue',...(preflight.success?{preflight:preflight.output}:{})};
 write(file,job);
 const anchor=join(directory,'snapshots',`${id}.git`);
 try{
  execFileSync('git',['init','--quiet','--bare','--initial-branch=main',anchor],{stdio:'pipe'});
  execFileSync('git',['--git-dir',anchor,'fetch','--quiet',source,`${sha}:refs/heads/main`],{stdio:'pipe',timeout:300000});
  execFileSync('git',['clone','--quiet','--no-hardlinks','--branch','main',anchor,snapshot],{stdio:'pipe',timeout:300000});
  if(git(snapshot,['rev-parse','HEAD'])!==job.sha)throw new Error('Source advanced during capture; enqueue the new committed tip');
  git(snapshot,['ls-files','--error-unmatch','.githooks/pre-push']);
  // A local clone advertises the source's unpublished main as origin/main.
  // Recreate this snapshot's remote so pull's fork-point cannot treat that
  // unpushed tip as old upstream and drop it on the first real fetch.
  git(snapshot,['remote','remove','origin']);git(snapshot,['remote','add','origin',remote]);git(snapshot,['config','core.hooksPath','.githooks']);
  // The copied snapshot is independent. Remove this queue-owned transport
  // before a worker can consume it; tolerate bounded directory-write races.
  rmSync(anchor,{recursive:true,force:true,maxRetries:3,retryDelay:25});
  // An older live worker re-parses jobs without this field; the sidecar keeps the verdict.
  if(job.preflight!==undefined)write(join(directory,`${id}.preflight.json`),{id,...job.preflight});
  job.state='queued';write(file,job);worker(directory);return job;
 }catch(error){job.state='failed';const message=error instanceof Error?error.message:String(error);write(file,{...job,error:message});notify(job,'failed',message);if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});throw error;}
 finally{if(existsSync(anchor))rmSync(anchor,{recursive:true,force:true,maxRetries:3,retryDelay:25});}
}

/** Refuse changed checked bytes and retain their paths before managed cleanup.
 * @param {string} snapshot @param {{sha:string,tree:string}} job @param {string} phase */
function verifySnapshot(snapshot,job,phase){
 const head=git(snapshot,['rev-parse','HEAD']),tree=git(snapshot,['rev-parse','HEAD^{tree}']);
 const status=git(snapshot,['status','--porcelain','--untracked-files=normal']);
 const changed=[];
 if(head!==job.sha)changed.push(`HEAD ${job.sha} -> ${head}`);
 if(tree!==job.tree)changed.push(`tree ${job.tree} -> ${tree}`);
 if(status!=='')changed.push(`working tree:\n${status}`);
 if(changed.length>0)throw new Error(`Captured source changed ${phase}; no exact-tree publication proof: ${changed.join('; ')}`);
}

/** The worker lock excludes another active owner. Keep unknown directories,
 * live process groups and unfinished requests; reclaim only marked own clones.
 * @param {string} directory */
function reclaimBatches(directory){
 const snapshots=join(directory,'snapshots');
 for(const name of readdirSync(snapshots).filter(value=>value.startsWith('batch-'))){
  const root=join(snapshots,name);
  try{
   if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())continue;
   const owner=v.parse(batchOwnerSchema,JSON.parse(readFileSync(join(root,'queue-owner.json'),'utf8')));
   if(owner.queue!==directory||owner.root!==root||owner.jobs.length===0)continue;
   try{process.kill(-owner.owner,0);continue;}catch(error){if(!(error instanceof Error)||!('code'in error)||error.code!=='ESRCH')continue;}
   if(!owner.jobs.every(id=>{
    try{const job=v.parse(jobSchema,JSON.parse(readFileSync(join(directory,`${id}.json`),'utf8')));return job.id===id&&terminal.has(job.state);}catch{return false;}
   }))continue;
   rmSync(root,{recursive:true,force:true});console.log(`push-queue: reclaimed completed abandoned batch ${name}`);
  }catch{ /* Unknown ownership or unfinished evidence is retained, never guessed. */ }
 }
}

/** Batch only ready FIFO requests. Preserve original snapshots for bisection;
 * every published subset has its own full normal hook and exact Git push.
 * @param {string} directory @param {v.InferOutput<typeof jobSchema>[]} jobs */
async function batch(directory,jobs){
 const root=mkdtempSync(join(directory,'snapshots','batch-'));
 write(join(root,'queue-owner.json'),{schema:'queue-batch/1',queue:directory,root,owner:process.pid,jobs:jobs.map(job=>job.id)});
 for(const job of jobs){
  job.requestedSha??=job.sha;job.requestedTree??=job.tree;
  write(join(directory,`${job.id}.json`),{...job,state:'batching',batch:jobs.map(row=>row.id)});
 }
 /** @param {v.InferOutput<typeof jobSchema>} job @param {string} state
  * @param {v.InferOutput<typeof jobSchema>[]} subset @param {object} extra */
 const finish=(job,state,subset,extra)=>{
  write(join(directory,`${job.id}.json`),{...job,state,batch:subset.map(row=>row.id),finishedAt:new Date().toISOString(),...extra});
  notify(job,state,`combined ${subset.length} request(s): ${'error'in extra?String(extra.error):'normal full gate and exact publication verified'}`);
  if(existsSync(job.snapshot))rmSync(job.snapshot,{recursive:true,force:true});
 };
 /** @param {v.InferOutput<typeof jobSchema>[]} subset */
 async function attempt(subset){
  const first=subset[0],last=subset.at(-1);if(first===undefined||last===undefined)return;
  const candidateRoot=mkdtempSync(join(root,'candidate-'));
  /** @type {v.InferOutput<typeof jobSchema>|null} */let result=null;
  let failure='';
  try{
   // Origin owns the starting point. The originals are immutable payloads;
   // each is rebased in FIFO order onto the preceding combined private main.
   let combined=join(candidateRoot,'origin');
   cloneQueueOrigin(first.snapshot,first.remote,combined,workerEnvironment());
   for(const [index,job] of subset.entries()){
    verifySnapshot(job.snapshot,job,'before combining the immutable request');
    const view=join(candidateRoot,String(index));
    execFileSync('git',['clone','--quiet','--no-hardlinks','--branch=main',job.snapshot,view],{env:workerEnvironment(),stdio:'pipe'});
    verifySnapshot(view,job,'after copying the immutable request');
    verifySnapshot(job.snapshot,job,'after copying the immutable request');
    git(view,['remote','remove','origin']);git(view,['remote','add','origin',job.remote]);git(view,['config','core.hooksPath','.githooks']);
    git(view,['remote','add','cohort',combined]);
    rebaseQueuedSnapshot(view,{...workerEnvironment(),PWD:view},'cohort');
    if(spawnSync('git',['merge-base','--is-ancestor',git(combined,['rev-parse','HEAD']),'HEAD'],{cwd:view}).status!==0)throw new Error('Queue batch lost a preceding rebased request');
    combined=view;
   }
   const candidate={...last,sha:git(combined,['rev-parse','HEAD']),tree:git(combined,['rev-parse','HEAD^{tree}']),state:'queued',attempts:0};
   result=await checkJob(directory,candidate,combined,join(candidateRoot,'result.json'));
   failure=result?.error??'Queue candidate did not finish the normal gate';
  }catch(error){failure=error instanceof Error?error.message:String(error);}
  finally{rmSync(candidateRoot,{recursive:true,force:true});}
  if(result!==null&&['pushed','already-published'].includes(result.state)){
   for(const job of subset)finish(job,result.state,subset,{sha:result.sha,tree:result.tree,seconds:result.seconds});
  }else if(result!==null&&['publication-unknown','published-unverified'].includes(result.state)){
   for(const job of subset)finish(job,result.state,subset,{error:failure,sha:result.sha,tree:result.tree});
   throw new PublicationUnknownError('Uncertain batch push needs remote verification; no bisection after publication');
  }else if(result?.failurePhase!=='checking'&&!failure.startsWith('Queue snapshot rebase conflict:')&&!failure.startsWith('Captured source changed ')){
   for(const job of subset)finish(job,'failed',subset,{error:`Queue infrastructure: ${failure}`});
  }else if(subset.length===1){
   finish(last,'failed',subset,{error:`Queue breaker ${last.lane??last.id}: ${failure}`});
  }else{
   const middle=Math.floor(subset.length/2);
   await attempt(subset.slice(0,middle));await attempt(subset.slice(middle));
  }
 }
 try{await attempt(jobs);}finally{rmSync(root,{recursive:true,force:true});}
}

/** @param {string} directory */
async function drain(directory){
 for(;;){
  reclaimBatches(directory);
  const names=readdirSync(directory).filter(name=>/^\d+-[a-f0-9]{8}\.json$/u.test(name)).sort();
  const jobs=names.map(name=>readJob(directory,name));
  const job=jobs.find(value=>value!==null&&!terminal.has(value.state));if(job===undefined||job===null)return;
  /** @type {v.InferOutput<typeof jobSchema>[]} */const cohort=[];
  for(const candidate of jobs){
   if(candidate===null||terminal.has(candidate.state))continue;
   if(candidate.checkOnly||candidate.state==='capturing'||identity(candidate.remote)!==identity(job.remote))break;
   cohort.push(candidate);
  }
  await(cohort.length>1?batch(directory,cohort):checkJob(directory,job,job.snapshot));
 }
}

/** The explicit manifest is the only authority. Export errors remain diagnostic;
 * they never replace the original hook failure or permit publication.
 * @param {string} directory @param {v.InferOutput<typeof jobSchema>} job
 * @param {string} snapshot */
function retainFailedDiagnostics(directory,job,snapshot){
 try{
  const result=spawnSync('python3',[fileURLToPath(new URL('push-queue-retain.py',import.meta.url)),snapshot,directory,job.id,job.sha],{env:workerEnvironment(),encoding:'utf8',timeout:6000,maxBuffer:128*1024});
  if(result.status!==0)throw new Error(`status=${result.status} signal=${result.signal} ${result.error?.message??result.stderr.slice(0,1000)}`);
  const summary=result.stdout.trim();
  if(summary!=='null')console.error(`Push queue retained requested diagnostics (not case attribution): ${summary}`);
 }catch(error){console.error(`Push queue diagnostic retention refused; original failure unchanged: ${error instanceof Error?error.message:String(error)}`);}
}

/** The exact same normal hook/push pipeline serves single jobs and candidates.
 * A batch's transient result is private; only its proven subsets update jobs.
 * @param {string} directory @param {v.InferOutput<typeof jobSchema>} job
 * @param {string} snapshot @param {string} [candidateRecord] */
async function checkJob(directory,job,snapshot,candidateRecord){
  const file=candidateRecord??join(directory,`${job.id}.json`),started=Date.now();
  let pushed=false,hookFailed=false;
  if(job.state==='capturing'){
   const held=spawnSync('python3',[lock,'--held',join(directory,'capture.lock')],{stdio:'ignore'});
   if(held.status===0){await new Promise(resolve=>{setTimeout(resolve,100);});return null;}
   // Capture may publish queued and release its flock after drain read the
   // record but before the probe. Only a fresh capturing record is abandoned.
   const current=readJob(directory,`${job.id}.json`);
   if(current===null||current.state!=='capturing')return null;
   const error=held.status===1?'Capture no longer holds capture.lock; PID reuse is not liveness':'Capture lock could not be verified';
   write(file,{...current,state:'failed',error});notify(current,'failed',error);if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});return null;
  }
  const environment={...workerEnvironment(),PWD:snapshot};
  /** @param {string} command @param {string[]} args @param {string} [input] */
  const run=(command,args,input)=>execFileSync(command,args,{cwd:snapshot,env:environment,stdio:input===undefined?'inherit':['pipe','inherit','inherit'],input});
  /** @param {string} state @param {object} [extra] */
  const save=(state,extra={})=>{job.state=state;write(file,{...job,...extra});};
  try{
   if(git(snapshot,['rev-parse','HEAD'])!==job.sha)throw new Error('Queue snapshot changed before checking');
   let finished=false;
   for(let attempt=(job.attempts??0)+1;attempt<=3;attempt++){
    job.attempts=attempt;
    try{
     run('git',['fetch','origin','main']);let remote=git(snapshot,['rev-parse','refs/remotes/origin/main']);
     if(!job.checkOnly){
      const contains=spawnSync('git',['merge-base','--is-ancestor',job.sha,remote],{cwd:snapshot,stdio:'ignore'});
      if(contains.status===0){save('already-published',{remote,finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000});finished=true;break;}
      if(contains.status!==1)throw new Error('Could not verify remote ancestry');
      job.requestedSha??=job.sha;job.requestedTree??=job.tree;
      save('rebasing');remote=rebaseQueuedSnapshot(snapshot,environment);
      job.sha=git(snapshot,['rev-parse','HEAD']);job.tree=git(snapshot,['rev-parse','HEAD^{tree}']);
     }
     const base=job.checkOnly?git(snapshot,['merge-base',remote,job.sha]):remote;
     save('installing');run('pnpm',['install','--frozen-lockfile']);
     const manifest=v.parse(v.object({scripts:v.optional(v.record(v.string(),v.string()),{})}),JSON.parse(readFileSync(join(snapshot,'package.json'),'utf8')));
     if(manifest.scripts['tools:install']!==undefined)run('pnpm',['run','tools:install']);
     if(manifest.scripts.pins!==undefined)run('pnpm',['pins']);
     if(git(snapshot,['status','--porcelain','--untracked-files=normal'])!=='')throw new Error('Preparation changed tracked or untracked source');
     // An earlier global/manual full suite can legitimately own its lease for
     // more than the hook's five-minute acquisition budget. Wait before the
     // hook starts; its unchanged real lease and all checks still run normally.
     if(existsSync(join(snapshot,'scripts/heavy-lane.py'))){
      save('waiting-for-hook');run('python3',[fileURLToPath(new URL('push-queue-admission.py',import.meta.url)),'--checkout',snapshot]);
     }
     save('checking');try{run('bash',['.githooks/pre-push','origin',job.remote],`refs/heads/main ${job.sha} refs/heads/main ${base}\n`);}catch(error){hookFailed=true;throw error;}
     verifySnapshot(snapshot,job,'after the normal hook, before publication');
     save('publishing-ready');
     if(!job.checkOnly){
      run('git',['fetch','origin','main']);const latest=git(snapshot,['rev-parse','refs/remotes/origin/main']);
      if(latest!==remote)throw new RemoteAdvanceError(`Remote advanced after checking to ${latest}; rebase and check again`);
      save('pushing');
      const upload=spawnSync('git',['push','origin',`${job.sha}:refs/heads/main`],{cwd:snapshot,env:environment,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
      process.stdout.write(upload.stdout??'');process.stderr.write(upload.stderr??'');
      if(upload.status!==0){
       try{run('git',['fetch','origin','main']);}catch{throw new PublicationUnknownError('Push failed and its remote outcome cannot be verified');}
       const after=git(snapshot,['rev-parse','refs/remotes/origin/main']);
       const accepted=spawnSync('git',['merge-base','--is-ancestor',job.sha,after],{cwd:snapshot,stdio:'ignore'}).status===0;
       if(!accepted){
        if(after!==remote&&/! \[(?:remote )?rejected\].*(?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)/u.test(`${upload.stdout??''}\n${upload.stderr??''}`))throw new RemoteAdvanceError(`Normal Git push rejected an advanced main ${after}; rebase and check again`);
        throw new Error('Normal Git push refused; remote does not contain the checked commit');
       }
      }
      pushed=true;
     }
     verifySnapshot(snapshot,job,'after the normal push');
     save(job.checkOnly?'checked':'pushed',{finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000});finished=true;break;
    }catch(error){
     if(error instanceof RemoteAdvanceError&&attempt<3){save('retrying',{retry:{reason:error.message,checkedSha:job.sha,checkedTree:job.tree,attempt}});continue;}
     if(error instanceof RemoteAdvanceError)throw new Error(`Push retry budget exhausted after ${attempt}: ${error.message}`,{cause:error});
     throw error;
    }
   }
   if(!finished)throw new Error('Bounded push retry budget exhausted');
  }catch(error){const state=pushed?'published-unverified':error instanceof PublicationUnknownError?'publication-unknown':'failed',message=error instanceof Error?error.message:String(error);save(state,{failurePhase:job.state,finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000,error:message});if(candidateRecord===undefined)notify(job,state,message);}
  finally{if(existsSync(snapshot)){if(hookFailed&&job.state==='failed')retainFailedDiagnostics(directory,job,snapshot);rmSync(snapshot,{recursive:true,force:true});}}
  return v.parse(jobSchema,JSON.parse(readFileSync(file,'utf8')));
}

const [mode,...args]=process.argv.slice(2);
if(mode==='enqueue'){
 if(process.env.CI||process.env.GITHUB_ACTIONS)throw new Error('The unattended push queue is a local service');
 const source=resolvePath(args.find(arg=>!arg.startsWith('--'))??'.');refusePartialSource(source);
 const remote=git(source,['remote','get-url','origin']);
 const root=resolvePath(args.find(arg=>arg.startsWith('--root='))?.slice(7)??join(homedir(),'.cache/wildshard/push-queue'));
 const directory=join(root,createHash('sha256').update(identity(remote)).digest('hex').slice(0,20));mkdirSync(join(directory,'snapshots'),{recursive:true});
 const commit=args.find(arg=>arg.startsWith('--commit='));
 // DS16c: refuse in seconds what the full gate would bounce on bookkeeping.
 // A preflight that cannot even load never blocks an enqueue.
 const {admitEnqueue}=await import('./push-preflight.mjs').catch((/** @type {unknown} */error)=>{console.error(`push preflight unavailable (${error instanceof Error?error.message:String(error)}); enqueueing without it`);return {admitEnqueue:()=>Promise.resolve({sha:'',seconds:0,refused:[],warnings:['preflight: unavailable']})};});
 /** @type {Awaited<ReturnType<typeof admitEnqueue>>} */let preflight;
 try{preflight=await admitEnqueue(source,{commit:commit?.slice(9),checkOnly:args.includes('--check-only'),lane:process.env.WS_LANE_NAME??'push-queue',skip:process.env.WS_PREFLIGHT_SKIP});}
 catch(error){console.error(`push preflight crashed (${error instanceof Error?error.message:String(error)}); enqueueing without it`);preflight={sha:'',seconds:0,refused:[],warnings:['preflight: crashed']};}
 if(preflight===null)process.exitCode=1;
 else{
  // Capture exactly the commit the preflight checked; a moved HEAD stays an ancestor or is refused.
  const target=preflight.sha===''?commit:`--commit=${preflight.sha}`;
  const output=execFileSync('python3',[lock,join(directory,'capture.lock'),process.execPath,self,'capture',source,directory,...(args.includes('--check-only')?['--check-only']:[]),...(target===undefined?[]:[target])],{encoding:'utf8',env:{...process.env,WS_PREFLIGHT_RECORD:JSON.stringify(preflight)}});process.stdout.write(output);
 }
}else if(mode==='capture'){
 const [source,directory]=args;if(source===undefined||directory===undefined)throw new Error('Missing queue capture paths');
 console.log(JSON.stringify(capture(source,directory,args.includes('--check-only'),args.find(arg=>arg.startsWith('--commit='))?.slice(9))));
}else if(mode==='work'){
 const [directory]=args;if(directory===undefined)throw new Error('Missing queue directory');await drain(resolvePath(directory));
}else if(mode==='status'){
 const [directory]=args;if(directory===undefined)throw new Error('Pass the repository queue directory');
 console.log(JSON.stringify(readdirSync(directory).filter(name=>/^\d+-[a-f0-9]{8}\.json$/u.test(name)).sort().map(name=>{try{return JSON.parse(readFileSync(join(directory,name),'utf8'));}catch{return {id:name.slice(0,-5),state:'invalid',error:'Unreadable queue record'};}}),null,2));
}else throw new Error('Usage: push-queue.mjs enqueue [repo] [--commit=sha] [--root=path] [--check-only] | status <queue-dir>');
