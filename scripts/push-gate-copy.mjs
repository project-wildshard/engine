// BUILD-MAX EV1 / WORKTREE-LAND WL11 (J290): the push gate checks the pushed commit in a clean copy of it, never the
// shared working tree. J290's mode 1 has up to three lanes committing by pathspec in the one canonical checkout; a gate
// run there refused every push while any other lane had a dirty or untracked file ("Push target requires a clean
// checked tree"), and a gate that did start linted and type-checked whatever bytes the other lanes wrote meanwhile.
//
// The copy is a detached `git worktree` of the pushed SHA under <root>/tmp/push-gate/<sha>-<pid>:
//   1. tracked files: APFS clones of every file the checkout holds clean with the same blob and mode (worktree.mjs's
//      verified clone, hashed against its blob afterwards); git writes the rest, so other lanes' edits never enter;
//   2. build state, cloned whole (copy-on-write, no new blocks): node_modules, .bin-deps/node_modules, .tsc-layers (the
//      tsc -b cache) and out/ with the pins mounts this checkout's install published (pins-reuse.mjs);
//   3. `pnpm install --offline` in the copy when the pushed lockfile is not the installed one; if the copy is still unclean (a commit that moves the pins key), `pnpm pins` in the copy, once;
//   4. the gate runs there; then the copy and its worktree entry are removed, green or red. A copy whose gate was
//      killed is swept by the next one (its pid is gone).
// Each step's seconds print as one `push-gate copy` line. Turn it off in one commit: CLEAN_COPY below.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {clonePaths} from './apfs-clone.mjs';
import {verifiedPinsOutputs} from './pins-reuse.mjs';
import {checkedTreeDirt} from './push-proof-cache.mjs';
import {cloneTrackedFiles} from './worktree.mjs';

/** The switch (EV1). false gates in place again, refusing a dirty checkout as before. */
export const CLEAN_COPY=true;
/** Where copies live, under the checkout (gitignored /tmp/; AGENTS.md: never the system tmp). */
export const GATE_DIR='tmp/push-gate';
/** Ignored build state a gate reads, cloned whole when present. */
const BUILD_STATE=['node_modules','.bin-deps/node_modules','.tsc-layers','out'];

/** Git without the hook's GIT_* variables: a GIT_DIR from the pushing checkout must never steer the copy.
 * @param {string} cwd @param {string[]} args */
function git(cwd,args){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 return execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20}).trim();
}

/** The one commit a push publishes, or null for a delete-only push. Publishing refs with different trees keep the
 * old refusal: one gate proves one tree. @param {string} root @param {string|undefined} refs @returns {string|null} */
export function pushedCommit(root,refs){
 /** @type {string|null} */let sha=null,tree=null;
 for(const line of (refs??'').split('\n').map(row=>row.trim()).filter(Boolean)){
  const local=line.split(/\s+/u)[1]??'';
  if(!/^[a-f0-9]{40}$/u.test(local))throw new Error('Invalid push refs for the gate copy');
  if(/^0+$/u.test(local))continue;
  const own=git(root,['rev-parse','--verify',`${local}^{tree}`]);
  if(tree!==null&&own!==tree)throw new Error('Pushed refs carry different trees; push them one at a time');
  sha??=local;tree=own;
 }
 return sha;
}

/** Why this push gates in a clean copy, or null to gate in place. The canonical checkout always copies: other lanes
 * may write there while the gate runs. A plan worktree copies only when it is dirty or HEAD is not the pushed tree.
 * @param {string} root @param {string|null} sha @param {NodeJS.ProcessEnv} env @param {boolean} [enabled] */
export function copyReason(root,sha,env,enabled=CLEAN_COPY){
 if(!enabled||sha===null||env.CI||env.GITHUB_ACTIONS)return null;
 const gitDir=resolve(root,git(root,['rev-parse','--git-dir'])),common=resolve(root,git(root,['rev-parse','--git-common-dir']));
 if(gitDir===common)return 'canonical checkout (shared by mode-1 lanes)';
 if(git(root,['rev-parse','HEAD^{tree}'])!==git(root,['rev-parse',`${sha}^{tree}`]))return 'pushed commit is not the checked-out tree';
 const dirt=checkedTreeDirt(root);
 return dirt.length===0?null:`${dirt.length} uncommitted path(s) in the checkout, e.g. ${dirt[0]}`;
}

/** Remove copies a killed gate left behind: their pid (the name's suffix) is gone. A live gate's copy is never touched.
 * @param {string} root @returns {number} removed */
export function sweepDeadCopies(root){
 let removed=0;
 /** @type {string[]} */let names=[];
 try{names=readdirSync(join(root,GATE_DIR));}catch{return 0;}
 for(const name of names){
  const pid=Number(/-(\d+)$/u.exec(name)?.[1]??'0');
  if(!Number.isInteger(pid)||pid<=0||pid===process.pid)continue;
  try{process.kill(pid,0);continue;}catch(error){if(!(error instanceof Error)||!('code' in error)||error.code!=='ESRCH')continue;}
  const path=join(root,GATE_DIR,name);
  try{git(root,['worktree','remove','--force',path]);}catch{/* Not registered. */}
  rmSync(path,{recursive:true,force:true});removed++;
 }
 if(removed>0)try{git(root,['worktree','prune']);}catch{/* Housekeeping only. */}
 return removed;
}

/** Make the clean copy of `sha`. Returns its path and a remover; on failure removes what it made and throws.
 * @param {string} root the pushing checkout @param {string} sha
 * @param {{say?:(line:string)=>void,env?:NodeJS.ProcessEnv}} [options] */
export function makeGateCopy(root,sha,{say=line=>process.stderr.write(`${line}\n`),env=process.env}={}){
 const path=join(root,GATE_DIR,`${sha.slice(0,12)}-${process.pid}`),began=performance.now();
 /** @type {string[]} */const steps=[];
 /** @param {string} step @param {() => (string|void)} work */
 const timed=(step,work)=>{const at=performance.now(),detail=work();steps.push(`${step} ${((performance.now()-at)/1000).toFixed(1)} s${typeof detail==='string'?` (${detail})`:''}`);};
 // Removal is off the push's path: the copy is renamed aside, unregistered, and deleted by a detached rm (about 4 s).
 const remove=()=>{
  const trash=`${path}.trash`;
  try{renameSync(path,trash);spawn('rm',['-rf',trash],{detached:true,stdio:'ignore'}).unref();}
  catch{rmSync(path,{recursive:true,force:true});}
  try{git(root,['worktree','prune']);}catch{/* Prune is housekeeping only. */}
 };
 mkdirSync(dirname(path),{recursive:true});
 sweepDeadCopies(root);
 // A leftover registration of this very path (a reused pid) would make `worktree add` refuse: clear both.
 remove();
 try{
  timed('add',()=>{git(root,['worktree','add','--quiet','--detach','--no-checkout',path,sha]);git(path,['reset','--quiet']);});
  timed('tracked',()=>{
   let cloned=0;
   if(process.platform==='darwin'){
    try{cloned=cloneTrackedFiles(root,path);}catch(error){say(`push-gate copy: clone reuse skipped (${error instanceof Error?error.message:String(error)})`);}
   }
   const missing=git(path,['ls-files','-z']).split('\0').filter(Boolean).filter(file=>{try{lstatSync(join(path,file));return false;}catch{return true;}});
   const written=spawnSync('git',['checkout-index','--stdin','-z'],{cwd:path,input:missing.map(file=>`${file}\0`).join(''),encoding:'utf8',maxBuffer:64<<20,
    env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')))});
   if(written.status!==0)throw new Error(`git checkout-index: ${written.stderr.trim()}`);
   try{git(path,['update-index','-q','--refresh']);}catch{/* status below decides. */}
   return `${cloned} cloned, ${missing.length} written by git`;
  });
  timed('state',()=>{
   const pairs=/** @type {[string,string][]} */([]);
   for(const dir of BUILD_STATE)if(existsSync(join(root,dir))&&!existsSync(join(path,dir))){mkdirSync(dirname(join(path,dir)),{recursive:true});pairs.push([join(root,dir),join(path,dir)]);}
   // The pins mounts this checkout's own install published (verified against its manifest), file by file.
   for(const mount of verifiedPinsOutputs(root).paths)if(!existsSync(join(path,mount))){mkdirSync(dirname(join(path,mount)),{recursive:true});pairs.push([join(root,mount),join(path,mount)]);}
   return `${pairs.length} paths, ${clonePaths(pairs)}`;
  });
  // The cloned packages are the checkout's install, which another lane's uncommitted `pnpm add` may have changed: the
  // copy installs its own (offline, from the store) whenever the pushed lockfile is not the one installed (J206 review).
  const lock=join(path,'pnpm-lock.yaml'),installed=join(path,'node_modules/.pnpm/lock.yaml');
  if(existsSync(lock)&&existsSync(join(path,'node_modules'))&&(!existsSync(installed)||!readFileSync(lock).equals(readFileSync(installed)))){
   timed('install',()=>{
    const child=spawnSync('pnpm',['install','--frozen-lockfile','--offline'],{cwd:path,env:Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('GIT_'))),stdio:['ignore','ignore','pipe'],encoding:'utf8'});
    if(child.status!==0)throw new Error(`pnpm install in the gate copy exited ${String(child.status)}: ${child.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    return 'pushed lockfile differs from the checkout\'s install';
   });
  }
  let dirt=checkedTreeDirt(path);
  if(dirt.length>0&&existsSync(join(path,'node_modules'))){
   // A commit that moves the pins key leaves the cloned mounts unverified: publish this tree's own, once.
   timed('pins',()=>{
    const child=spawnSync('pnpm',['--silent','pins'],{cwd:path,env:Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('GIT_'))),stdio:['ignore','ignore','pipe'],encoding:'utf8'});
    if(child.status!==0)throw new Error(`pnpm pins in the gate copy exited ${String(child.status)}: ${child.stderr.trim().split('\n').slice(-3).join(' | ')}`);
   });
   dirt=checkedTreeDirt(path);
  }
  if(dirt.length>0)throw new Error(`the gate copy of ${sha.slice(0,10)} is not clean:\n${dirt.slice(0,10).join('\n')}`);
 }catch(error){remove();throw error;}
 say(`  - push-gate copy (EV1): ${sha.slice(0,10)} at ${GATE_DIR}/${path.split('/').at(-1)} in ${((performance.now()-began)/1000).toFixed(1)} s; ${steps.join(', ')}`);
 return {path,remove};
}
