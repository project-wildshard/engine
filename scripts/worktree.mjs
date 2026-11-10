// DEV-SPEED DS12 (J221, J240): `node scripts/worktree.mjs new <slug>` makes a plan worktree at
// <canonical>/.worktrees/<slug> on plan/<slug> from origin/main, ready to work in and land from.
//
//   1. a short per-repo setup lock, then `git fetch origin main` and `git worktree add --no-checkout`;
//   2. the tracked tree: each file whose blob and mode match a clean file of the canonical checkout is an APFS clone
//      of it (copy-on-write, no new blocks); git writes the rest; `git status` must then be clean, or setup stops;
//   3. `pnpm install --frozen-lockfile --offline`: pnpm's store, cloned, not downloaded;
//   4. `pnpm pins` when the repo has that script (shard products from ~/.cache/wildshard/pins);
//   5. names the herdr pane (inside herdr only) and prints the land steps.
//
// Never copied: .env*, tmp/, .review/, .cache/, browser profiles, leases, ports, push proofs; the worktree gets
// only tracked files and its own install. Each step's seconds go to <worktree>/tmp/worktree-setup.json and, with
// WS_LANE_NAME set, one line in ~/.cache/wildshard/lane-receipts.log. Removal is DS13's reaper, never this script.
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WORKTREES} from './worktree-ignore.mjs';

export const SLUG=/^[a-z0-9][a-z0-9._-]{0,63}$/u;
const REGULAR=/^100(?:644|755)$/u;
// clonefile(2) per file, one process for the whole tree: Node's COPYFILE_FICLONE makes a full copy on macOS (measured:
// ATTR_CMNEXT_PRIVATESIZE equals the file size) and COPYFILE_FICLONE_FORCE fails with ENOSYS. Reads source/target pairs,
// NUL-separated, on stdin; any failure stops it, and git then writes what is missing.
const CLONEFILE=`import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
libc.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
parts = sys.stdin.buffer.read().split(b'\\0')[:-1]
for source, target in zip(parts[0::2], parts[1::2]):
    if libc.clonefile(source, target, 1) != 0:
        sys.exit(f'{target.decode()}: {os.strerror(ctypes.get_errno())}')`;
const USAGE='usage: node scripts/worktree.mjs new <slug> [--no-install] [--no-pins] [--no-herdr] [--no-clone]';

class StopError extends Error{name='StopError';}

/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20});
/** @param {string} cwd @param {string[]} args */
const tryGit=(cwd,args)=>spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:256<<20});

/** @param {string[]} argv */
export function parseArgs(argv){
 const [command,slug,...rest]=argv;
 if(command!=='new'||slug===undefined)throw new StopError(USAGE);
 if(!SLUG.test(slug))throw new StopError(`slug "${slug}" must match ${SLUG.source}`);
 const flags=new Set(['--no-install','--no-pins','--no-herdr','--no-clone']);
 const unknown=rest.filter(arg=>!flags.has(arg));
 if(unknown.length>0)throw new StopError(`unknown option ${unknown.join(' ')}\n${USAGE}`);
 return {slug,install:!rest.includes('--no-install'),pins:!rest.includes('--no-pins'),herdr:!rest.includes('--no-herdr'),clone:!rest.includes('--no-clone')};
}

/** The canonical checkout of the repo `cwd` is in: the main worktree, never a linked one. @param {string} cwd */
export function canonicalRoot(cwd){
 const common=resolve(cwd,git(cwd,['rev-parse','--git-common-dir']).trim());
 if(basename(common)!=='.git')throw new StopError(`${common} is not a checkout's .git (a bare repository has no canonical tree)`);
 return dirname(common);
}

/** `git ls-files -s -z` as path -> "<mode> <oid>". @param {string} cwd */
function stagedBlobs(cwd){
 /** @type {Map<string,string>} */const blobs=new Map();
 for(const row of git(cwd,['ls-files','-s','-z']).split('\0')){
  const match=/^(\d{6}) ([0-9a-f]{40,64}) 0\t(.+)$/su.exec(row);
  if(match!==null)blobs.set(match[3]??'',`${match[1]} ${match[2]}`);
 }
 return blobs;
}

/** Clone into `tree` each tracked file the canonical checkout holds clean with the same blob and mode.
 * @param {string} canonical @param {string} tree @returns {number} files cloned */
function cloneTrackedFiles(canonical,tree){
 const source=stagedBlobs(canonical);
 const dirty=new Set(git(canonical,['ls-files','-z','--modified','--deleted']).split('\0').filter(Boolean));
 for(const row of git(canonical,['diff','--cached','--name-only','-z']).split('\0'))if(row!=='')dirty.add(row);
 /** @type {string[]} */const pairs=[];
 for(const [path,blob] of stagedBlobs(tree)){
  if(source.get(path)!==blob||dirty.has(path)||!REGULAR.test(blob.slice(0,6)))continue;
  const target=join(tree,path);
  mkdirSync(dirname(target),{recursive:true});
  pairs.push(join(canonical,path),target);
 }
 if(pairs.length===0)return 0;
 const result=spawnSync('python3',['-I','-c',CLONEFILE],{input:`${pairs.join('\0')}\0`,encoding:'utf8',maxBuffer:64<<20});
 if(result.status!==0)throw new Error(`clonefile: ${result.stderr.trim()===''?result.error?.message??'failed':result.stderr.trim()}`);
 return pairs.length/2;
}

/** A short per-repo setup lock in the shared Git dir; a holder that died leaves a lock the next run takes over.
 * @param {string} common @returns {() => void} */
function lock(common){
 const path=join(common,'wildshard-worktree-setup.lock'),owner=join(path,'pid');
 for(let attempt=0;attempt<2;attempt++){
  try{mkdirSync(path);writeFileSync(owner,String(process.pid));return ()=>rmSync(path,{recursive:true,force:true});}
  catch(error){
   if(!(error instanceof Error)||!('code' in error)||error.code!=='EEXIST')throw error;
   const pid=Number.parseInt(existsSync(owner)?readFileSync(owner,'utf8'):'',10);
   let alive=false;
   try{if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);alive=true;}}catch{/* The holder is gone. */}
   if(alive)throw new StopError(`another worktree setup (pid ${pid}) holds ${path}; retry when it finishes`);
   rmSync(path,{recursive:true,force:true});
  }
 }
 throw new StopError(`could not take ${path}`);
}

/** @param {string} cwd @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} env */
function run(cwd,command,args,env){
 const result=spawnSync(command,args,{cwd,env,stdio:['ignore','inherit','inherit']});
 if(result.error!==undefined)throw new StopError(`${command} ${args.join(' ')}: ${result.error.message}`);
 if(result.status!==0)throw new StopError(`${command} ${args.join(' ')} exited ${String(result.status)}`);
}

/** @param {string[]} argv @param {string} [cwd] @param {NodeJS.ProcessEnv} [env] @returns {number} */
export function worktreeNew(argv,cwd=process.cwd(),env=process.env){
 const options=parseArgs(argv),canonical=canonicalRoot(cwd),common=join(canonical,'.git');
 const relative=`${WORKTREES}/${options.slug}`,tree=join(canonical,relative),branch=`plan/${options.slug}`;
 /** @type {{step:string,seconds:number,detail?:string}[]} */const steps=[];
 const began=performance.now();
 /** @param {string} step @param {() => (string|void)} work */
 const timed=(step,work)=>{
  const started=performance.now(),detail=work();
  steps.push({step,seconds:Number(((performance.now()-started)/1000).toFixed(2)),...(typeof detail==='string'?{detail}:{})});
  process.stdout.write(`worktree ${step.padEnd(8)} ${(steps.at(-1)?.seconds??0).toFixed(1)} s${typeof detail==='string'?`  ${detail}`:''}\n`);
 };
 const unlock=lock(common);
 let base='';
 try{
  if(existsSync(tree))throw new StopError(`${relative} already exists; work there, or pick another slug`);
  if(tryGit(canonical,['rev-parse','--verify','--quiet',`refs/heads/${branch}`]).status===0)throw new StopError(`branch ${branch} already exists; delete it or pick another slug`);
  timed('fetch',()=>{git(canonical,['fetch','--quiet','origin','main']);base=git(canonical,['rev-parse','origin/main']).trim();return `origin/main ${base.slice(0,10)}`;});
  timed('add',()=>{git(canonical,['worktree','add','--quiet','--no-checkout','-b',branch,relative,base]);git(tree,['reset','--quiet']);});
  try{timed('checkout',()=>{
   let cloned=0;
   if(options.clone&&process.platform==='darwin'){
    try{cloned=cloneTrackedFiles(canonical,tree);}
    catch(error){process.stderr.write(`worktree: clone reuse skipped (${error instanceof Error?error.message:String(error)}); git writes every file\n`);}
   }
   // Git writes every tracked file the clone did not place (and symlinks); it never overwrites a clone.
   const missing=[...stagedBlobs(tree).keys()].filter(path=>!existsSync(join(tree,path)));
   const written=spawnSync('git',['checkout-index','--stdin','-z'],{cwd:tree,input:missing.map(path=>`${path}\0`).join(''),encoding:'utf8',maxBuffer:64<<20});
   if(written.status!==0)throw new StopError(`git checkout-index: ${written.stderr.trim()}`);
   tryGit(tree,['update-index','-q','--refresh']);
   const stray=git(tree,['status','--porcelain','--untracked-files=no']).trim();
   if(stray!=='')throw new StopError(`${relative} is not clean after checkout:\n${stray.split('\n').slice(0,10).join('\n')}`);
   return `${cloned} of ${stagedBlobs(tree).size} tracked files cloned from the canonical checkout`;
  });}
  catch(error){
   // Nothing was made here but this setup's own empty worktree and its branch at origin/main: take both back.
   tryGit(canonical,['worktree','remove','--force',relative]);
   tryGit(canonical,['branch','-D',branch]);
   throw error;
  }
 }finally{unlock();}
 const scripts=/** @type {{scripts?:Record<string,string>}} */(JSON.parse(readFileSync(join(tree,'package.json'),'utf8'))).scripts??{};
 const childEnv=Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('GIT_')));
 if(options.install)timed('install',()=>run(tree,'pnpm',['install','--frozen-lockfile','--offline'],childEnv));
 if(options.pins&&scripts.pins!==undefined)timed('pins',()=>run(tree,'pnpm',['--silent','pins'],childEnv));
 const hooks=git(tree,['rev-parse','--path-format=absolute','--git-path','hooks']).trim();
 const hooksPath=tryGit(tree,['config','core.hooksPath']).stdout.trim();
 if(hooksPath!==''&&!resolve(tree,hooksPath).startsWith(`${tree}/`))throw new StopError(`core.hooksPath ${hooksPath} resolves outside ${relative}`);
 if(options.herdr&&env.HERDR_ENV==='1'&&env.HERDR_PANE_ID!==undefined&&env.HERDR_PANE_ID!==''){
  const named=spawnSync('herdr',['pane','rename',env.HERDR_PANE_ID,`${basename(canonical)} ${branch}`],{encoding:'utf8'});
  if(named.status!==0)process.stderr.write(`worktree: herdr pane not renamed (${named.error?.message??named.stderr.trim()})\n`);
 }
 const total=Number(((performance.now()-began)/1000).toFixed(2));
 const record={slug:options.slug,branch,base,tree,hooks:hooksPath===''?hooks:resolve(tree,hooksPath),total,steps,finished:new Date().toISOString()};
 mkdirSync(join(tree,'tmp'),{recursive:true});
 writeFileSync(join(tree,'tmp/worktree-setup.json'),`${JSON.stringify(record,null,2)}\n`);
 const lane=/^[a-z][a-z0-9_-]*$/u.test(env.WS_LANE_NAME??'')?String(env.WS_LANE_NAME):'';
 if(lane!==''){
  const file=resolve(env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
  try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${new Date().toISOString().slice(11,16)} UTC ${lane} worktree new ${basename(canonical)}/${relative} on ${branch} from ${base.slice(0,10)} in ${total.toFixed(1)} s (${steps.map(row=>`${row.step} ${row.seconds.toFixed(1)}`).join(', ')})\n`);}
  catch(error){process.stderr.write(`worktree receipt unavailable: ${String(error)}\n`);}
 }
 const name=lane===''?'<lane>':lane;
 process.stdout.write(`\nworktree ready in ${total.toFixed(1)} s: ${tree} on ${branch}\n\nLand (J240):\n  cd ${tree}\n  # commit by pathspec as usual; the hooks allow commits here on ${branch}\n  WS_LANE_NAME=${name} node scripts/land.mjs\n  # it pushes ${branch}, waits for its ci and ring-1, rebases and fast-forwards main;\n  # check its receipt in ~/.cache/wildshard/lane-receipts.log. Force only your own plan/* branch\n  # after a rebase (--force-with-lease), never main.\n`);
 return 0;
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=worktreeNew(process.argv.slice(2));}
 catch(error){
  if(!(error instanceof StopError))throw error;
  process.stderr.write(`worktree STOP ${error.message}\n`);
  process.exitCode=1;
 }
}
