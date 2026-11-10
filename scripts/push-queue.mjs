// Commit, capture an immutable checkout, and let one per-repo worker own normal pushes.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,mkdtempSync,openSync,closeSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as v from 'valibot';
import {rebaseQueuedSnapshot} from './push-queue-rebase.mjs';

const self=import.meta.filename,lock=fileURLToPath(new URL('push-queue-lock.py',import.meta.url));
const jobSchema=v.object({id:v.string(),source:v.string(),snapshot:v.string(),remote:v.string(),sha:v.string(),tree:v.string(),requestedSha:v.optional(v.string()),requestedTree:v.optional(v.string()),owner:v.number(),checkOnly:v.boolean(),state:v.string(),createdAt:v.string(),lane:v.optional(v.string()),attempts:v.optional(v.pipe(v.number(),v.integer(),v.minValue(0))),error:v.optional(v.string()),seconds:v.optional(v.number()),batch:v.optional(v.array(v.string()))});
const terminal=new Set(['pushed','checked','already-published','failed','published-unverified','publication-unknown']);
const pending=new Set(['capturing','queued','retrying','rebasing','installing','waiting-for-hook','checking','pushing','batching']);
const keepalive='ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes';
class RemoteAdvanceError extends Error{name='RemoteAdvanceError';}
class PublicationUnknownError extends Error{name='PublicationUnknownError';}

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
/** A worker outlives its enqueuer and can drain other lanes' jobs. Carry only
 * tool/OS/auth transport settings, never gate bypasses, loaders or test modes.
 * @param {NodeJS.ProcessEnv} [source] */
function workerEnvironment(source=process.env){
 const allowed=new Set(['HOME','PATH','USER','LOGNAME','SHELL','TMPDIR','TMP','TEMP','LANG','TZ','TERM','COLORTERM','NO_COLOR','FORCE_COLOR',
  'PNPM_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','SSH_AUTH_SOCK','SSH_AGENT_PID',
  'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',
  'SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','CPATH','LIBRARY_PATH','MANPATH','SDKROOT',
  'WS_LANE_RECEIPTS']);
 const environment=Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key)||/^LC_[A-Z_]+$/u.test(key)));
 return {...environment,WS_FULL_SUITE:'1',GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:keepalive};
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
 const job={id,source,snapshot,remote,sha,tree:git(source,['rev-parse',`${sha}^{tree}`]),owner:process.pid,checkOnly,state:'capturing',createdAt:new Date().toISOString(),lane:process.env.WS_LANE_NAME??'push-queue'};
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
  job.state='queued';write(file,job);worker(directory);return job;
 }catch(error){job.state='failed';const message=error instanceof Error?error.message:String(error);write(file,{...job,error:message});notify(job,'failed',message);if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});throw error;}
 finally{if(existsSync(anchor))rmSync(anchor,{recursive:true,force:true});}
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

/** Batch only ready FIFO requests. Preserve original snapshots for bisection;
 * every published subset has its own full normal hook and exact Git push.
 * @param {string} directory @param {v.InferOutput<typeof jobSchema>[]} jobs */
async function batch(directory,jobs){
 const root=mkdtempSync(join(directory,'snapshots','batch-'));
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
   execFileSync('git',['clone','--quiet','--branch=main','--reference-if-able',first.snapshot,'--dissociate',first.remote,combined],{env:workerEnvironment(),stdio:'pipe'});
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

/** The exact same normal hook/push pipeline serves single jobs and candidates.
 * A batch's transient result is private; only its proven subsets update jobs.
 * @param {string} directory @param {v.InferOutput<typeof jobSchema>} job
 * @param {string} snapshot @param {string} [candidateRecord] */
async function checkJob(directory,job,snapshot,candidateRecord){
  const file=candidateRecord??join(directory,`${job.id}.json`),started=Date.now();
  let pushed=false;
  if(job.state==='capturing'){
   const held=spawnSync('python3',[lock,'--held',join(directory,'capture.lock')],{stdio:'ignore'});
   if(held.status===0){await new Promise(resolve=>{setTimeout(resolve,100);});return null;}
   const error=held.status===1?'Capture no longer holds capture.lock; PID reuse is not liveness':'Capture lock could not be verified';
   write(file,{...job,state:'failed',error});notify(job,'failed',error);if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});return null;
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
     save('checking');run('bash',['.githooks/pre-push','origin',job.remote],`refs/heads/main ${job.sha} refs/heads/main ${base}\n`);
     verifySnapshot(snapshot,job,'after the normal hook, before publication');
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
  }catch(error){const state=pushed?'published-unverified':error instanceof PublicationUnknownError?'publication-unknown':'failed',message=error instanceof Error?error.message:String(error);save(state,{finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000,error:message});if(candidateRecord===undefined)notify(job,state,message);}
  finally{if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});}
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
 const output=execFileSync('python3',[lock,join(directory,'capture.lock'),process.execPath,self,'capture',source,directory,...(args.includes('--check-only')?['--check-only']:[]),...(commit===undefined?[]:[commit])],{encoding:'utf8'});process.stdout.write(output);
}else if(mode==='capture'){
 const [source,directory]=args;if(source===undefined||directory===undefined)throw new Error('Missing queue capture paths');
 console.log(JSON.stringify(capture(source,directory,args.includes('--check-only'),args.find(arg=>arg.startsWith('--commit='))?.slice(9))));
}else if(mode==='work'){
 const [directory]=args;if(directory===undefined)throw new Error('Missing queue directory');await drain(resolvePath(directory));
}else if(mode==='status'){
 const [directory]=args;if(directory===undefined)throw new Error('Pass the repository queue directory');
 console.log(JSON.stringify(readdirSync(directory).filter(name=>/^\d+-[a-f0-9]{8}\.json$/u.test(name)).sort().map(name=>{try{return JSON.parse(readFileSync(join(directory,name),'utf8'));}catch{return {id:name.slice(0,-5),state:'invalid',error:'Unreadable queue record'};}}),null,2));
}else throw new Error('Usage: push-queue.mjs enqueue [repo] [--commit=sha] [--root=path] [--check-only] | status <queue-dir>');
