import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {homedir,hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import * as v from 'valibot';
import {pushDependencyIdentity} from './push-dependencies.mjs';
import {verifiedPinsOutputs} from './pins-reuse.mjs';
import {assertHeavyLease} from './heavy-lane-lease.mjs';

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

// Version 2 receipts retain this field for gate census readers.
const noExclusions=Object.freeze({files:Object.freeze([]),deadline:null});
const exclusionsSchema=v.strictObject({files:v.strictTuple([]),deadline:v.null_()});
const pidSchema=v.pipe(v.number(),v.integer(),v.minValue(2));
const ownerSchema=v.object({pid:pidSchema,identity:v.string(),bornNs:v.string(),uid:v.pipe(v.number(),v.integer(),v.minValue(0))});
const leaseSchema=v.object({token:v.string(),runnerPid:pidSchema,childPid:v.nullable(pidSchema),resources:v.array(v.string()),
  queuedAt:v.number(),startedAt:v.number()});
const measurementSchema=v.object({profile:v.string(),captured:v.string(),machine:v.string(),platform:v.string(),arch:v.string(),
  owner:v.nullable(ownerSchema),lease:v.nullable(leaseSchema)});
const receiptSchema=v.object({version:v.literal(2),tree:v.string(),runtime:v.string(),run:v.string(),commit:v.string(),
  finished:v.string(),seconds:v.number(),mode:v.picklist(['full','related','docs']),files:v.array(v.string()),exclusions:exclusionsSchema,
  measurement:v.optional(measurementSchema),inherited:v.optional(v.object({run:v.string(),commit:v.string()}))});

/** Optional measurement only: an unavailable kernel/lease probe never changes cache admission.
 * @param {string} profile @param {NodeJS.ProcessEnv} env */
function producerMeasurement(profile,env){
  /** @type {v.InferOutput<typeof ownerSchema>|null} */let owner=null;
  /** @type {v.InferOutput<typeof leaseSchema>|null} */let lease=null;
  try{
    const text=execFileSync('python3',[fileURLToPath(new URL('cpu-census.py',import.meta.url)),'--pid',String(process.pid),'--owner-only'],
      {encoding:'utf8',timeout:3000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
    const candidate=v.parse(ownerSchema,JSON.parse(text));
    if(candidate.pid===process.pid)owner=candidate;
  }catch{ /* Missing measurement stays explicitly unavailable, never a fabricated owner. */ }
  if(env.WS_HEAVY_TOKEN){try{
    assertHeavyLease('full-test',env);
    const candidate=v.parse(leaseSchema,JSON.parse(readFileSync(resolve(env.WS_HEAVY_ROOT??resolve(homedir(),'.wildshard-heavy-lanes'),'full-test.active.json'),'utf8')));
    if(candidate.token===env.WS_HEAVY_TOKEN)lease=candidate;
  }catch{ /* No validated current lease: scope cannot be inferred from a resource name. */ }}
  return {profile,captured:new Date().toISOString(),machine:hostname(),platform:process.platform,arch:process.arch,owner,lease};
}
/** The porcelain lines that make `cwd` an unclean checked tree: every change and untracked file, minus the pins
 * outputs this tree's own install published (verifiedPinsOutputs). Land's preflight (DS22) uses the same list, so it
 * stops on exactly what this check would refuse, before the gate instead of minutes into it.
 * @param {string} cwd @param {ReadonlySet<string>} [pinned] @returns {string[]} */
export function checkedTreeDirt(cwd,pinned=verifiedPinsOutputs(cwd).paths){
  const entries=execFileSync('git',['status','--porcelain','-z','--untracked-files=all'],{cwd,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean);
  /** @type {string[]} */const lines=[];
  // Under -z a rename or copy is two entries, `R  new` then the bare old path: the old one joins its line.
  for(let index=0;index<entries.length;index++){
    const line=entries[index]??'';
    lines.push(/^[RC]|^.[RC]/u.test(line)&&index+1<entries.length?`${line} <- ${entries[++index]??''}`:line);
  }
  return lines.filter(line=>!(line.startsWith('?? ')&&pinned.has(line.slice(3))));
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
  const dirty=checkedTreeDirt(cwd,pinned.paths);
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
  const dependencies=pushDependencyIdentity(cwd,env);
  const execution=createHash('sha256').update(JSON.stringify({profile,host:hostname(),node:process.versions,platform:process.platform,arch:process.arch,environment,exclusions:noExclusions,pins:pinned.key})).digest('hex');
  const runtime=createHash('sha256').update(JSON.stringify({execution,dependencies})).digest('hex');
  // Captures also serve pre-lease reuse and after-check comparisons. Retain
  // only the publication inputs; discarded captures need no kernel probe.
  return {tree,commit,runtime,execution,root:resolve(cwd),dependencies,profile,
    producerEnv:{WS_HEAVY_ROOT:env.WS_HEAVY_ROOT,WS_HEAVY_TOKEN:env.WS_HEAVY_TOKEN},
    sharedFile:dependencies===null?null:sharedProofFile(cwd,env,tree,runtime),file:resolve(cwd,git(['rev-parse','--git-path',`wildshard-push-proofs/${tree}-${runtime}.json`]))};
}

/** Only a directly completed full gate can publish without a reusable input
 * observation. Source/policy changes and positive byte changes still refuse.
 * @param {{tree:string,execution:string,runtime:string,dependencies:string|null}} before
 * @param {{tree:string,execution:string,runtime:string,dependencies:string|null}|null} after
 * @param {{full:boolean,inherited:boolean}} options */
export function pushProofDisposition(before,after,options){
 if(after===null||after.tree!==before.tree||after.execution!==before.execution)throw new Error('Checked tree or runtime changed during the gate; no publication proof, rerun the exact tree');
 if(after.runtime===before.runtime)return 'record';
 if(before.dependencies===null||after.dependencies===null){
  if(options.full&&!options.inherited)return 'uncached';
  throw new Error('Full proof inputs unavailable; rerun the complete gate');
 }
 throw new Error('Installed inputs changed during the gate; rerun the exact tree');
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
    const covers=proof.mode==='full'||(proof.mode===selection.mode&&selection.files.every(selected=>proof.files.includes(selected)));
    if(covers)return proof;
  }catch{ /* An absent or invalid candidate never substitutes for the gate. */ }
  }
  return null;
}

/** Authenticate an earlier full tree with this checkout's actual current
 * runtime, installed bytes, pins and publishing scope.
 * @param {NonNullable<ReturnType<typeof capturePushTree>>} context
 * @param {string} commit */
export function readPriorFullProof(context,commit){
 if(!/^[a-f0-9]{40}$/u.test(commit))return null;
 try{
  /** @param {string[]} args */
  const git=args=>execFileSync('git',args,{cwd:context.root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const tree=git(['rev-parse',`${commit}^{tree}`]),name=`${tree}-${context.runtime}.json`;
  const previous={...context,tree,commit,file:resolve(context.root,git(['rev-parse','--git-path',`wildshard-push-proofs/${name}`])),
   sharedFile:context.sharedFile===null?null:resolve(dirname(context.sharedFile),name)};
  return readPushProof(previous,{mode:'full',files:[]});
 }catch{return null;}
}

/** Call only after the complete selected gate succeeds and a second clean-tree capture agrees.
 * @param {NonNullable<ReturnType<typeof capturePushTree>>} context
 * @param {{mode:'full'|'related'|'docs',files:string[]}} selection @param {number} seconds
 * @param {{run:string,commit:string}} [inherited] */
export function writePushProof(context,selection,seconds,inherited){
  const measurement=producerMeasurement(context.profile,context.producerEnv);
  const proof={version:2,tree:context.tree,runtime:context.runtime,run:randomUUID(),commit:context.commit,
    finished:new Date().toISOString(),seconds,mode:selection.mode,files:selection.files,exclusions:noExclusions,
    measurement,...(inherited===undefined?{}:{inherited})};
  mkdirSync(dirname(context.file),{recursive:true});
  const temporary=`${context.file}.${process.pid}`;writeFileSync(temporary,`${JSON.stringify(proof)}\n`,{mode:0o600});renameSync(temporary,context.file);
  if(selection.mode==='full'&&inherited===undefined&&context.sharedFile!==null){
    mkdirSync(dirname(context.sharedFile),{recursive:true,mode:0o700});
    const shared=`${context.sharedFile}.${process.pid}.tmp`;writeFileSync(shared,`${JSON.stringify(proof)}\n`,{mode:0o600});renameSync(shared,context.sharedFile);
  }
  return proof;
}
