// Commit, capture an immutable checkout, and let one per-repo worker own normal pushes.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,openSync,closeSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as v from 'valibot';

const self=import.meta.filename,lock=fileURLToPath(new URL('push-queue-lock.py',import.meta.url));
const jobSchema=v.object({id:v.string(),source:v.string(),snapshot:v.string(),remote:v.string(),sha:v.string(),tree:v.string(),owner:v.number(),checkOnly:v.boolean(),state:v.string(),createdAt:v.string()});
const terminal=new Set(['pushed','checked','already-published','failed','published-unverified','publication-unknown']);
const keepalive='ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes';

/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
/** @param {string} file @param {object} value */
function write(file,value){const temporary=`${file}.${process.pid}.tmp`;writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`);renameSync(temporary,file);}
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
 const child=spawn('python3',[lock,join(directory,'worker.lock'),process.execPath,self,'work',directory],{detached:true,stdio:['ignore',output,output]});
 child.on('error',error=>{console.error(`Push queue worker unavailable: ${error.message}`);});child.unref();closeSync(output);
}
/** @param {string} source @param {string} directory @param {boolean} checkOnly @param {string | undefined} requested */
function capture(source,directory,checkOnly,requested){
 if(git(source,['branch','--show-current'])!=='main')throw new Error('Push queue accepts main only');
 const number=Number(existsSync(join(directory,'next'))?readFileSync(join(directory,'next'),'utf8'):0);
 if(!Number.isSafeInteger(number)||number<0)throw new Error('Invalid queue sequence');
 writeFileSync(join(directory,'next.tmp'),String(number+1));renameSync(join(directory,'next.tmp'),join(directory,'next'));
 const id=`${String(number).padStart(9,'0')}-${randomUUID().slice(0,8)}`,snapshot=join(directory,'snapshots',id),file=join(directory,`${id}.json`);
 const sha=requested??git(source,['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/u.test(sha)||spawnSync('git',['merge-base','--is-ancestor',sha,'HEAD'],{cwd:source}).status!==0)throw new Error('Queue target must be a full commit on source main');
 const remote=git(source,['remote','get-url','origin']);identity(remote);
 const job={id,source,snapshot,remote,sha,tree:git(source,['rev-parse',`${sha}^{tree}`]),owner:process.pid,checkOnly,state:'capturing',createdAt:new Date().toISOString()};
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
 }catch(error){job.state='failed';write(file,{...job,error:error instanceof Error?error.message:String(error)});if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});throw error;}
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

/** @param {string} directory */
async function drain(directory){
 for(;;){
  const names=readdirSync(directory).filter(name=>/^\d+-[a-f0-9]{8}\.json$/u.test(name)).sort();
  const next=names.find(name=>!terminal.has(v.parse(jobSchema,JSON.parse(readFileSync(join(directory,name),'utf8'))).state));if(next===undefined)return;
  const file=join(directory,next),job=v.parse(jobSchema,JSON.parse(readFileSync(file,'utf8')));
  if(!/^[0-9]{9,}-[a-f0-9]{8}$/u.test(job.id)||job.snapshot!==join(directory,'snapshots',job.id))throw new Error('Unsafe queue snapshot identity');
  const snapshot=job.snapshot,started=Date.now();
  let pushed=false;
  if(job.state==='capturing'){
   let alive=true;try{process.kill(job.owner,0);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ESRCH')alive=false;else throw error;}
   if(alive){await new Promise(resolve=>{setTimeout(resolve,100);});continue;}
   write(file,{...job,state:'failed',error:'Capture owner exited before the immutable checkout was ready'});if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});continue;
  }
  const environment={...process.env,WS_FULL_SUITE:'1',GIT_SSH_COMMAND:keepalive,PWD:snapshot};
  for(const key of Object.keys(environment))if(key.startsWith('GIT_')&&key!=='GIT_SSH_COMMAND'||key.startsWith('WS_HEAVY_')||['WS_CPU_ADMISSION','WS_CPU_ROOT','WS_PUSH_REFS','WILDSHARD_RING','WS_TEST_QUARANTINE'].includes(key))Reflect.deleteProperty(environment,key);
  /** @param {string} command @param {string[]} args @param {string} [input] */
  const run=(command,args,input)=>execFileSync(command,args,{cwd:snapshot,env:environment,stdio:input===undefined?'inherit':['pipe','inherit','inherit'],input});
  /** @param {string} state @param {object} [extra] */
  const save=(state,extra={})=>{job.state=state;write(file,{...job,...extra});};
  try{
   if(git(snapshot,['rev-parse','HEAD'])!==job.sha)throw new Error('Queue snapshot changed before checking');
   save('installing');run('pnpm',['install','--frozen-lockfile']);
   const manifest=v.parse(v.object({scripts:v.optional(v.record(v.string(),v.string()),{})}),JSON.parse(readFileSync(join(snapshot,'package.json'),'utf8')));
   if(manifest.scripts['tools:install']!==undefined)run('pnpm',['run','tools:install']);
   const {pins}=manifest.scripts;if(pins!==undefined)run('pnpm',['pins']);
   run('git',['fetch','origin','main']);const remote=git(snapshot,['rev-parse','refs/remotes/origin/main']);
   if(!job.checkOnly){
    const contains=spawnSync('git',['merge-base','--is-ancestor',job.sha,remote],{cwd:snapshot,stdio:'ignore'});
    if(contains.status===0){save('already-published',{remote,finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000});continue;}
    if(contains.status!==1)throw new Error('Could not verify remote ancestry');
   }
   const base=git(snapshot,['merge-base',remote,job.sha]);
   if(!job.checkOnly&&base!==remote)throw new Error('Remote advanced: rebase the source and enqueue its new immutable tip');
   if(!job.checkOnly)run('git',['pull','--rebase','origin','main']);
   if(git(snapshot,['rev-parse','HEAD'])!==job.sha)throw new Error('Remote changed the captured tip; re-enqueue from source');
   if(git(snapshot,['status','--porcelain','--untracked-files=normal'])!=='')throw new Error('Preparation changed tracked or untracked source');
   save('checking');
   run('bash',['.githooks/pre-push','origin',job.remote],`refs/heads/main ${job.sha} refs/heads/main ${base}\n`);
   verifySnapshot(snapshot,job,'after the normal hook, before publication');
   if(!job.checkOnly){save('pushing');run('git',['push','origin',`${job.sha}:refs/heads/main`]);pushed=true;}
   verifySnapshot(snapshot,job,'after the normal push');
   save(job.checkOnly?'checked':'pushed',{finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000});
  }catch(error){save(pushed?'published-unverified':job.state==='pushing'?'publication-unknown':'failed',{finishedAt:new Date().toISOString(),seconds:(Date.now()-started)/1000,error:error instanceof Error?error.message:String(error)});}
  finally{if(existsSync(snapshot))rmSync(snapshot,{recursive:true,force:true});}
 }
}

const [mode,...args]=process.argv.slice(2);
if(mode==='enqueue'){
 if(process.env.CI||process.env.GITHUB_ACTIONS)throw new Error('The unattended push queue is a local service');
 const source=resolvePath(args.find(arg=>!arg.startsWith('--'))??'.'),remote=git(source,['remote','get-url','origin']);
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
 console.log(JSON.stringify(readdirSync(directory).filter(name=>/^\d+-[a-f0-9]{8}\.json$/u.test(name)).sort().map(name=>JSON.parse(readFileSync(join(directory,name),'utf8'))),null,2));
}else throw new Error('Usage: push-queue.mjs enqueue [repo] [--commit=sha] [--root=path] [--check-only] | status <queue-dir>');
