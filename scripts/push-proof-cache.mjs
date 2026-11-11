import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {homedir,hostname} from 'node:os';
import * as v from 'valibot';
import {readLiftPending} from './lift-pending.mjs';
import {pushDependencyIdentity} from './push-dependencies.mjs';
import {verifiedPinsOutputs} from './pins-reuse.mjs';

/** The scope is the actual publishing repository, never a caller's cache key.
 * @param {string} root @param {NodeJS.ProcessEnv} env @param {string} tree @param {string} runtime */
function sharedProofFile(root,env,tree,runtime){
 try{
  const remote=execFileSync('git',['remote','get-url','--push','origin'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(/^https?:\/\//u.test(remote)){const url=new URL(remote);if(url.username||url.password||url.search||url.hash)return null;}
  const identity=remote.replace(/^git@([^:]+):/u,'https://$1/').replace(/^ssh:\/\/git@/u,'https://').replace(/\.git\/?$/u,'').replace(/\/$/u,'');
  const scope=createHash('sha256').update(identity).digest('hex').slice(0,20);
  return resolve(env.XDG_CACHE_HOME??resolve(homedir(),'.cache'),'wildshard','full-push-proofs',scope,`${tree}-${runtime}.json`);
 }catch{return null;}
}

const exclusionsSchema=v.object({files:v.array(v.string()),deadline:v.nullable(v.string())});
const receiptSchema=v.object({version:v.literal(2),tree:v.string(),runtime:v.string(),run:v.string(),commit:v.string(),
  finished:v.string(),seconds:v.number(),mode:v.picklist(['full','related','docs']),files:v.array(v.string()),exclusions:exclusionsSchema});
/** Expired policies with no exclusions are already the complete inventory.
 * @param {v.InferOutput<typeof exclusionsSchema>} scope */
// Null is a policy with no time-only transition (no exclusions, or J237
// batches still waiting on integration). exclusionScope revalidates Git's
// landing markers on every read/write; it cannot conceal an omitted receipt.
const scopeLive=scope=>scope.files.length===0||scope.deadline===null||Date.now()<Date.parse(scope.deadline);
/** Local pushEnvironment removes ring/quarantine modes. The lift policy is the
 * same time-dependent exclusion reader used by the actual Vitest config.
 * @param {string} root */
function exclusionScope(root){
  const inventory=existsSync(resolve(root,'test/lift-pending.json')),policy=existsSync(resolve(root,'test/lift-pending-policy.json'));
  if(inventory!==policy)throw new Error('Incomplete time-based test exclusion policy');
  if(!inventory)return {files:[],deadline:null};
  const state=readLiftPending(root);
  return {files:[...state.excluded].sort(),deadline:state.deadline};
}

/** Never cache dirty bytes or use local receipts to skip CI.
 * @param {string} profile @param {NodeJS.ProcessEnv} env @param {string} [cwd] */
export function capturePushTree(profile,env,cwd=process.cwd()){
  const refs=env.WS_PUSH_REFS?.trim();
  if((env.CI||env.GITHUB_ACTIONS)&&!refs)return null;
  /** @param {string[]} args */
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  const tree=git(['rev-parse','HEAD^{tree}']),commit=git(['rev-parse','HEAD']);
  let publishes=false;
  for(const line of refs?refs.split('\n'):[]){
    const fields=line.trim().split(/\s+/u),local=fields[1],remote=fields[3];
    if(fields.length!==4||!/^[a-f0-9]{40}$/u.test(local??'')||!/^[a-f0-9]{40}$/u.test(remote??''))throw new Error('Invalid push refs for checked-tree proof');
    if(local===undefined)throw new Error('Invalid push refs for checked-tree proof');
    if(/^0+$/u.test(local))continue;
    publishes=true;
    if(git(['rev-parse','--verify',`${local}^{tree}`])!==tree)throw new Error('Push target tree differs from the checked HEAD tree; check the exact target in an immutable checkout');
  }
  if(env.CI||env.GITHUB_ACTIONS)return null;
  // Pins outputs this tree's own install published are build output, like out/: a worktree whose canonical checkout
  // never wrote the exclude block lists them untracked. Only mounts that hash to this tree's current pins manifest are
  // passed over, and that manifest's key joins the proof identity below (pins-reuse.mjs verifiedPinsOutputs).
  const pinned=verifiedPinsOutputs(cwd);
  const dirty=git(['status','--porcelain','-z','--untracked-files=all']).split('\0').filter(Boolean).filter(line=>!(line.startsWith('?? ')&&pinned.paths.has(line.slice(3))));
  if(dirty.length>0){
    if(publishes)throw new Error('Push target requires a clean checked tree; enqueue a committed immutable checkout');
    return null;
  }
  // Ref/destination admission runs before reuse; a full tree proof is independent
  // of the destination passed by Git versus the queue's preceding gate.
  // The gate normalizes its actual PWD to its checked root. Its absolute clone
  // location is metadata; installed bytes, host and compiler inputs still bind.
  const excluded=/^(?:PWD|WS_PUSH_REFS|WS_PUSH_DESTINATION|WS_PUSH_TIMINGS|WS_HEAVY_TOKEN|WS_HEAVY_ROOT|WS_HEAVY_TICKET|GIT_.*|SHLVL|_|OLDPWD)$/u;
  const environment=Object.entries(env).filter(([key])=>!excluded.test(key)).sort(([a],[b])=>a.localeCompare(b));
  const exclusions=exclusionScope(cwd);
  const dependencies=pushDependencyIdentity(cwd,env);
  const runtime=createHash('sha256').update(JSON.stringify({profile,host:hostname(),node:process.versions,platform:process.platform,arch:process.arch,environment,exclusions,dependencies,pins:pinned.key})).digest('hex');
  return {tree,commit,runtime,root:resolve(cwd),exclusions,dependencies,sharedFile:dependencies===null?null:sharedProofFile(cwd,env,tree,runtime),file:resolve(cwd,git(['rev-parse','--git-path',`wildshard-push-proofs/${tree}-${runtime}.json`]))};
}

/** A partial result covers only its own complete selection, never a full fallback.
 * @param {NonNullable<ReturnType<typeof capturePushTree>>} context
 * @param {{mode:'full'|'related'|'docs',files:string[]}} selection */
export function readPushProof(context,selection){
  if(context.dependencies===null)return null;
  for(const file of [context.file,context.sharedFile]){
  if(file===null)continue;
  try{
    const info=lstatSync(file);if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o022)!==0)continue;
    const proof=v.parse(receiptSchema,JSON.parse(readFileSync(file,'utf8')));
    if(proof.tree!==context.tree||proof.runtime!==context.runtime||!Number.isFinite(Date.parse(proof.finished))||proof.seconds<0||proof.run==='')continue;
    if(JSON.stringify(proof.exclusions)!==JSON.stringify(context.exclusions)||JSON.stringify(exclusionScope(context.root))!==JSON.stringify(context.exclusions))continue;
    const covers=proof.mode==='full'||(proof.mode===selection.mode&&selection.files.every(selected=>proof.files.includes(selected)));
    if(covers&&scopeLive(context.exclusions))return proof;
  }catch{ /* An absent or invalid candidate never substitutes for the gate. */ }
  }
  return null;
}

/** Call only after the complete selected gate succeeds and a second clean-tree capture agrees.
 * @param {NonNullable<ReturnType<typeof capturePushTree>>} context
 * @param {{mode:'full'|'related'|'docs',files:string[]}} selection @param {number} seconds */
export function writePushProof(context,selection,seconds){
  if(JSON.stringify(exclusionScope(context.root))!==JSON.stringify(context.exclusions)||!scopeLive(context.exclusions))throw new Error('Push proof exclusion scope changed while checking; rerun the full gate');
  const proof={version:2,tree:context.tree,runtime:context.runtime,run:randomUUID(),commit:context.commit,
    finished:new Date().toISOString(),seconds,mode:selection.mode,files:selection.files,exclusions:context.exclusions};
  mkdirSync(dirname(context.file),{recursive:true});
  const temporary=`${context.file}.${process.pid}`;writeFileSync(temporary,`${JSON.stringify(proof)}\n`,{mode:0o600});renameSync(temporary,context.file);
  if(selection.mode==='full'&&context.sharedFile!==null){
    mkdirSync(dirname(context.sharedFile),{recursive:true,mode:0o700});
    const shared=`${context.sharedFile}.${process.pid}.tmp`;writeFileSync(shared,`${JSON.stringify(proof)}\n`,{mode:0o600});renameSync(shared,context.sharedFile);
  }
  if(!scopeLive(context.exclusions)){unlinkSync(context.file);if(selection.mode==='full'&&context.sharedFile!==null)unlinkSync(context.sharedFile);throw new Error('Push proof exclusion scope changed while writing; rerun the full gate');}
  return proof;
}
