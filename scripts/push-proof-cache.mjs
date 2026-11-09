import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import * as v from 'valibot';

const receiptSchema=v.object({version:v.literal(1),tree:v.string(),runtime:v.string(),run:v.string(),commit:v.string(),
  finished:v.string(),seconds:v.number(),mode:v.picklist(['full','related','docs']),files:v.array(v.string())});

/** Never cache dirty bytes or use local receipts to skip CI.
 * @param {string} profile @param {NodeJS.ProcessEnv} env @param {string} [cwd] */
export function capturePushTree(profile,env,cwd=process.cwd()){
  const refs=env.WS_PUSH_REFS?.trim();
  if((env.CI||env.GITHUB_ACTIONS)&&!refs)return null;
  /** @param {string[]} args */
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  const tree=git(['rev-parse','HEAD^{tree}']),commit=git(['rev-parse','HEAD']);
  let publishes=false;
  for(const line of refs?.split('\n')??[]){
    const fields=line.trim().split(/\s+/u),local=fields[1],remote=fields[3];
    if(fields.length!==4||!/^[a-f0-9]{40}$/u.test(local??'')||!/^[a-f0-9]{40}$/u.test(remote??''))throw new Error('Invalid push refs for checked-tree proof');
    if(/^0+$/u.test(local))continue;
    publishes=true;
    if(git(['rev-parse','--verify',`${local}^{tree}`])!==tree)throw new Error('Push target tree differs from the checked HEAD tree; check the exact target in an immutable checkout');
  }
  if(env.CI||env.GITHUB_ACTIONS)return null;
  if(git(['status','--porcelain','--untracked-files=normal'])!==''){
    if(publishes)throw new Error('Push target requires a clean checked tree; enqueue a committed immutable checkout');
    return null;
  }
  const excluded=/^(?:WS_PUSH_REFS|WS_PUSH_TIMINGS|WS_HEAVY_TOKEN|WS_HEAVY_ROOT|WS_HEAVY_TICKET|GIT_.*|SHLVL|_|OLDPWD)$/u;
  const environment=Object.entries(env).filter(([key])=>!excluded.test(key)).sort(([a],[b])=>a.localeCompare(b));
  const runtime=createHash('sha256').update(JSON.stringify({profile,node:process.versions,platform:process.platform,arch:process.arch,environment})).digest('hex');
  return {tree,commit,runtime,file:resolve(cwd,git(['rev-parse','--git-path',`wildshard-push-proofs/${tree}-${runtime}.json`]))};
}

/** A partial result covers only its own complete selection, never a full fallback.
 * @param {NonNullable<ReturnType<typeof capturePushTree>>} context
 * @param {{mode:'full'|'related'|'docs',files:string[]}} selection */
export function readPushProof(context,selection){
  try{
    const proof=v.parse(receiptSchema,JSON.parse(readFileSync(context.file,'utf8')));
    if(proof.tree!==context.tree||proof.runtime!==context.runtime||!Number.isFinite(Date.parse(proof.finished))||proof.seconds<0||proof.run==='')return null;
    const covers=proof.mode==='full'||(proof.mode===selection.mode&&selection.files.every(file=>proof.files.includes(file)));
    return covers?proof:null;
  }catch{return null;}
}

/** Call only after the complete selected gate succeeds and a second clean-tree capture agrees.
 * @param {NonNullable<ReturnType<typeof capturePushTree>>} context
 * @param {{mode:'full'|'related'|'docs',files:string[]}} selection @param {number} seconds */
export function writePushProof(context,selection,seconds){
  const proof={version:1,tree:context.tree,runtime:context.runtime,run:randomUUID(),commit:context.commit,
    finished:new Date().toISOString(),seconds,mode:selection.mode,files:selection.files};
  mkdirSync(dirname(context.file),{recursive:true});
  const temporary=`${context.file}.${process.pid}`;writeFileSync(temporary,`${JSON.stringify(proof)}\n`,{mode:0o600});renameSync(temporary,context.file);
  return proof;
}
