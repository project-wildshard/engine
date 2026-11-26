// E7.2c.b.2: native clients from the authenticated baseline's exact Git source.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,createWriteStream,existsSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stopWorktreeProcesses} from './.kit/worktree-reap.mjs';

/** One owned process group; cancellation waits for close and clears its store-use marker.
 * @param {string} command @param {string[]} args
 * @param {{cwd:string,signal:AbortSignal,log:string,storeUse?:string}} options
 * @returns {Promise<number|null>} */
export async function observerCommand(command,args,{cwd,signal,log,storeUse}){
 signal.throwIfAborted();
 const output=createWriteStream(log,{flags:'a'}),started=Date.now();
 const child=spawn(command,args,{cwd,detached:true,stdio:['ignore','pipe','pipe']});
 child.stdout?.pipe(output,{end:false});child.stderr?.pipe(output,{end:false});
 /** @type {ReturnType<typeof setTimeout>|undefined} */let timer;
 /** @type {Error|undefined} */let outputError;
 /** @param {NodeJS.Signals} name */
 const kill=name=>{if(child.pid!==undefined)try{process.kill(-child.pid,name);}catch{/* This owned group already ended. */}};
 const abort=()=>{kill('SIGTERM');timer=setTimeout(()=>kill('SIGKILL'),5000);};
 signal.addEventListener('abort',abort,{once:true});
 output.on('error',error=>{outputError=error;abort();});
 if(signal.aborted)abort();
 try{
  const code=await new Promise(/** @param {(code:number|null)=>void} resolve */(resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  signal.throwIfAborted();
  if(outputError!==undefined)throw outputError;
  return code;
 }finally{
  signal.removeEventListener('abort',abort);clearTimeout(timer);
  if(signal.aborted||outputError!==undefined)kill('SIGKILL');
  if(!output.destroyed)await new Promise(resolve=>{output.end(resolve);});
  if(storeUse!==undefined&&child.pid!==undefined){
   const marker=join(process.env.WS_STORE_USERS??join(homedir(),'.cache/wildshard/store-users'),`${child.pid}.json`);
   try{
    const owned=JSON.parse(readFileSync(marker,'utf8'));
    if(owned.pid===child.pid&&owned.what===storeUse&&owned.at>=started)rmSync(marker);
   }catch{/* Normally withStoreUse already removed its marker. */}
  }
 }
}

/** The baseline is whatever staging serves, which can predate the lean layout (f928fdae2): v0.1.93 keeps its builder in
 * scripts/, so a lean-only path refused every staging observer from v0.1.94 on (QA 11-25 row 120).
 * @param {string} tree @returns {string} the builder, relative to the archived source tree */
export function observerBuilder(tree){
 for(const path of ['src/scripts/build-server.mjs','scripts/build-server.mjs'])if(existsSync(join(tree,path)))return path;
 throw new Error('Observer source has no build-server.mjs in src/scripts/ or scripts/');
}

/** The directory is a newly created run folder, never a shared checkout or a caller's existing tree.
 * @param {import('../../test/fixtures/dedicated/releaseObserver').ObservationSnapshot} snapshot
 * @param {AbortSignal} signal @param {{root:string,work:string}} options
 * @returns {Promise<import('../../test/fixtures/dedicated/releaseObserver').PreparedObserver>} */
export async function prepareObserverClient(snapshot,signal,{root,work}){
 const build=snapshot.release.engineBuild;
 if(!/^[0-9a-f]{40}$/u.test(build))throw new Error('Observer needs a full authenticated source commit');
 const tree=join(work,'client-source'),out=join(work,'client-build'),archive=join(work,'client-source.tar');
 for(const path of [tree,out,archive])if(existsSync(path))throw new Error('Observer source output must be new');
 mkdirSync(tree);
 const log=join(work,'client-build.log');
 /** @param {string} command @param {string[]} args @param {string} cwd @param {string} [storeUse] */
 const run=async(command,args,cwd,storeUse)=>{
  const code=await observerCommand(command,args,{cwd,signal,log,...(storeUse===undefined?{}:{storeUse})});
  if(code!==0){
   // The cause lives in the build log, which this run's scratch deletes; carry its tail (row 120 hid behind "exit 1").
   const tail=existsSync(log)?readFileSync(log,'utf8').trim().split('\n').slice(-6).join('\n'):'';
   throw new Error(`Observer client ${command} refused with exit ${code}${tail===''?'':`:\n${tail}`}`);
  }
 };
 const dispose=()=>{
  const failures=[];
  try{if(existsSync(tree)){
   // Only processes in this unique owned archive tree; never a pattern kill.
   stopWorktreeProcesses(tree);
   rmSync(tree,{recursive:true});
  }}catch(error){failures.push(error);}
  for(const path of [out,archive])try{if(existsSync(path))rmSync(path,{recursive:true});}catch(error){failures.push(error);}
  return failures.length===0?Promise.resolve():Promise.reject(new AggregateError(failures,'Observer source cleanup failed'));
 };
 try{
  const present=await observerCommand('git',['cat-file','-e',`${build}^{commit}`],{cwd:root,signal,log});
  if(present!==0)await run('git',['fetch','--quiet','origin',build],root);
  await run('git',['archive','--format=tar','--output',archive,build],root);
  await run('tar',['-xf',archive,'-C',tree],root);rmSync(archive);
  /** @type {Record<string,string>} */const harness={};
  for(const name of ['roomBot.ts','mmoBotsGuard.ts','releaseObserverBot.ts']){
   const source=join(root,'test/fixtures/dedicated',name);
   harness[name]=createHash('sha256').update(readFileSync(source)).digest('hex');
   copyFileSync(source,join(tree,'test/fixtures/dedicated',name));
  }
  const use=`MMO observer install ${randomUUID()}`;
  const install=[
   "import {spawnSync} from 'node:child_process';",
   `import {withStoreUse} from ${JSON.stringify(pathToFileURL(join(root,'src/scripts/.kit/worktree.mjs')).href)};`,
   `const result=withStoreUse(process.env,${JSON.stringify(use)},()=>spawnSync('pnpm',['install','--frozen-lockfile','--offline','--ignore-scripts','--config.ci=false'],{cwd:${JSON.stringify(tree)},env:{...process.env,CI:'1'},stdio:'inherit'}));`,
   "if(result.error)throw result.error;process.exitCode=result.status??1;",
  ].join('\n');
  await run(process.execPath,['--input-type=module','--eval',install],root,use);
  await run(process.execPath,[observerBuilder(tree),'--build',build,'--out',out,
   '--entry','releaseObserverBot=test/fixtures/dedicated/releaseObserverBot.ts'],tree);
  const module=await import(pathToFileURL(join(out,'releaseObserverBot.mjs')).href);
  if(module.sourceBuild!==build||typeof module.connect!=='function')throw new Error('Compiled observer source identity differs');
  return {sourceBuild:module.sourceBuild,connect:module.connect,harness,dispose};
 }catch(error){await dispose();throw error;}
}
