// J505 (Jake, 2026-11-23 ~20:40 Cancún: "make it a permanent fix ... No queues. No freezing, no waiting"): a stale
// canonical checkout must never run a stale `src/scripts/.kit/worktree.mjs`. Lanes start it from the canonical checkout, which
// may sit hundreds of commits behind origin/main (2026-11-23: 490 behind, still capping worktrees at 6 after main
// raised the cap to 10). Before it does anything, worktree.mjs asks `freshTool`: when any file of the tool differs from
// origin/main's, it exports origin/main's `src/scripts/` and `.agents/hooks/` into <canonical>/tmp/worktree-tool/<sha>/ and
// runs that copy with the same arguments and working directory (node resolves packages from the canonical tree above
// it). WS_WORKTREE_FRESH=1 marks the relaunched copy, so it never relaunches again.
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync} from 'node:fs';
import {basename,dirname,join,relative,resolve} from 'node:path';

/** Every file the worktree tool runs, repo-relative: worktree.mjs and its local imports, transitively (a test holds this
 *  list to the real import graph). */
export const WORKTREE_TOOL=Object.freeze([
 'src/scripts/.kit/worktree.mjs','src/scripts/worktree-fresh.mjs','src/scripts/.kit/worktree-ignore.mjs','src/scripts/.kit/apfs-clone.mjs',
 'src/scripts/.kit/worktree-reap.mjs','src/scripts/install-lag.mjs','src/scripts/.kit/lane-live.mjs','src/scripts/tmp-reap.mjs',
 '.agents/hooks/active-hours.mjs',
]);
/** the folders the relaunched copy is exported from */
export const EXPORTED=Object.freeze(['src/scripts','.agents/hooks']);

/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

/** The tool files whose bytes under `root` differ from `ref`'s (a file missing on either side differs).
 * @param {string} root @param {string} ref */
export function staleFiles(root,ref){
 return WORKTREE_TOOL.filter(file=>{
  const path=join(root,file);
  let want='';
  try{want=git(root,['rev-parse','--verify','--quiet',`${ref}:${file}`]);}catch{return existsSync(path);}
  if(!existsSync(path))return true;
  return git(root,['hash-object','--',path])!==want;
 });
}

/** The exact commands a lane runs by hand when the relaunch cannot be made. @param {string} canonical @param {string[]} argv */
export function byHand(canonical,argv){
 return `cd ${canonical} && git fetch origin main && mkdir -p tmp/worktree-tool/by-hand && git archive origin/main ${EXPORTED.join(' ')} | tar -x -C tmp/worktree-tool/by-hand && node tmp/worktree-tool/by-hand/src/scripts/.kit/worktree.mjs ${argv.join(' ')}`;
}

/**
 * Decide how this run proceeds. `{run:'here'}`: this copy is origin/main's (or it is the relaunched copy, or origin is
 * unreachable and the copy says so). `{run:'fresh', script, stale, sha}`: run `script` instead.
 * @param {{canonical:string, self:string, env?:NodeJS.ProcessEnv, fetch?:boolean, log?:(line:string)=>void}} options
 * @returns {{run:'here', why:string}|{run:'fresh', script:string, stale:string[], sha:string}}
 */
export function freshTool({canonical,self,env=process.env,fetch=true,log=()=>undefined}){
 if(env.WS_WORKTREE_FRESH==='1')return {run:'here',why:'the relaunched origin/main copy'};
 const root=resolve(dirname(self),'../../..');
 // only this repo's own tool is judged: a script run against another repo (a test fixture) runs as it is
 let own=false;
 try{own=realpathSync(resolve(root,git(root,['rev-parse','--git-common-dir'])))===realpathSync(join(canonical,'.git'));}catch{own=false;}
 if(!own)return {run:'here',why:'a tool from another repo'};
 if(fetch){
  try{git(canonical,['fetch','--quiet','origin','main']);}
  catch(error){log(`worktree: origin/main not fetched (${error instanceof Error?error.message.split('\n')[0]:String(error)}); running this copy`);return {run:'here',why:'fetch failed'};}
 }
 const sha=git(canonical,['rev-parse','origin/main']);
 const stale=staleFiles(root,sha);
 if(stale.length===0)return {run:'here',why:'origin/main\'s copy'};
 const dir=join(canonical,'tmp','worktree-tool',sha.slice(0,12));
 const script=join(dir,'src','scripts','.kit','worktree.mjs');
 if(!existsSync(script)){
  const part=`${dir}.part-${String(process.pid)}`;
  rmSync(part,{recursive:true,force:true});mkdirSync(part,{recursive:true});
  const present=EXPORTED.filter(path=>git(canonical,['ls-tree','--name-only',sha,'--',path])!=='');
  const archive=execFileSync('git',['archive',sha,...present],{cwd:canonical,maxBuffer:256*1024*1024});
  execFileSync('tar',['-x','-C',part],{input:archive});
  try{renameSync(part,dir);}catch{rmSync(part,{recursive:true,force:true});}
  // one export per origin/main: an older one (no process holds it past its own run) goes
  for(const name of readdirSync(dirname(dir)))if(name!==basename(dir)&&!name.includes('.part-'))rmSync(join(dirname(dir),name),{recursive:true,force:true});
 }
 return {run:'fresh',script,stale,sha};
}

/** Run origin/main's copy in this process's place; returns its exit status.
 * @param {string} script @param {string[]} argv @param {NodeJS.ProcessEnv} env */
export function relaunch(script,argv,env=process.env){
 const ran=spawnSync(process.execPath,[script,...argv],{stdio:'inherit',env:{...env,WS_WORKTREE_FRESH:'1'}});
 return ran.status??1;
}

/** the repo-relative local imports of one source file (for the WORKTREE_TOOL test) @param {string} root @param {string} file */
export function localImports(root,file){
 const text=readFileSync(join(root,file),'utf8');
 return [...text.matchAll(/from\s+'(\.{1,2}\/[^']+)'/gu)].map(match=>relative(root,resolve(dirname(join(root,file)),match[1]??'')));
}
