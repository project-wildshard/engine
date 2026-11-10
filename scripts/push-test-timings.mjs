// New and restored test files need a committed clock before publication.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,mkdirSync,openSync,readFileSync,readSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as v from 'valibot';

const positive=v.pipe(v.number(),v.finite(),v.minValue(Number.MIN_VALUE));
const target=v.object({file:v.string(),blob:v.string(),rings:v.array(v.picklist(['full','1']))});
export const timingRequestSchema=v.object({schema:v.literal('push-test-timing/1'),sha:v.string(),tree:v.string(),profile:v.string(),platform:v.string(),arch:v.string(),ring:v.picklist(['full','1']),files:v.array(target)});
const reportSchema=v.object({...timingRequestSchema.entries,reason:v.literal('passed'),errorCount:v.literal(0),files:v.array(v.object({...target.entries,state:v.literal('passed'),passedTests:v.pipe(v.number(),v.integer(),v.minValue(1)),durationMs:positive})),finishedAt:v.string()});
const localSchema=v.object({...reportSchema.entries,completed:v.literal(true)});
const hostedSchema=v.object({file:v.string(),sha:v.pipe(v.string(),v.regex(/^[a-f0-9]{40}$/u)),run:v.pipe(v.string(),v.regex(/^\d+$/u)),durationMs:positive,appliedTo:v.array(v.picklist(['full','ring1']))});
const sourceSchema=v.looseObject({localPushObservations:v.optional(v.array(v.unknown())),additionalFileObservations:v.optional(v.array(v.unknown()))});
const observationFile='test/durations-observations.jsonl';
const legacyFile='test/durations-source.json';
/** @param {string} root @param {string[]} args */
const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
/** @param {string} root @param {string} file */
const committedText=(root,file)=>execFileSync('git',['show',`HEAD:${file}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
/** @param {string} root @param {'full'|'1'} ring @returns {Record<string,number>} */
const weights=(root,ring)=>v.parse(v.record(v.string(),positive),JSON.parse(readFileSync(resolve(root,ring==='full'?'test/durations.json':'test/durations-ring1.json'),'utf8')));
/** @param {string} text @returns {v.InferOutput<typeof localSchema>[]} */
function parseObservationLog(text){
 return text.split('\n').flatMap((line,index)=>{
  if(line.trim()==='')return [];
  try{return [v.parse(localSchema,JSON.parse(line))];}
  catch{throw new Error(`Invalid timing observation at ${observationFile}:${index+1}`);}
 });
}
/** @param {string} root @returns {v.InferOutput<typeof localSchema>[]} */
function observationLog(root){
 /** @type {number} */let descriptor;
 try{descriptor=openSync(resolve(root,observationFile),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){if(error!==null&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return [];throw error;}
 try{
  if(!fstatSync(descriptor).isFile())throw new Error('Timing observations must be a regular file');
  return parseObservationLog(readFileSync(descriptor,'utf8'));
 }finally{closeSync(descriptor);}
}
/** @param {string} root */
function committedObservationLog(root){
 const entry=git(root,['ls-tree','HEAD','--',observationFile]);
 if(entry==='')return [];
 if(!/^100(?:644|755) blob /u.test(entry))throw new Error('Committed timing observations must be a regular file');
 return parseObservationLog(committedText(root,observationFile));
}
/** Preserve legacy local and hosted facts; new local facts live in the union log.
 * @param {string} root @param {boolean} [committed] @returns {v.InferOutput<typeof sourceSchema>} */
const provenance=(root,committed=false)=>{
 const text=committed?committedText(root,legacyFile):readFileSync(resolve(root,legacyFile),'utf8');
 const legacy=v.parse(sourceSchema,JSON.parse(text));
 const observations=committed?committedObservationLog(root):observationLog(root);
 return {...legacy,localPushObservations:[...(legacy.localPushObservations??[]),...observations]};
};
/** @param {string} value */
const digest=value=>createHash('sha256').update(value).digest('hex');
/** @param {string} root @param {string} sha @param {string} file */
const blobAt=(root,sha,file)=>{try{return git(root,['rev-parse','--verify',`${sha}:${file}`]);}catch{return null;}};

/** Numeric entries alone cannot admit a new or renamed source blob.
 * @param {string} root @param {string} file @param {'full'|'1'} ring @param {number|undefined} seconds @param {v.InferOutput<typeof sourceSchema>} source */
function committedTiming(root,file,ring,seconds,source){
 if(seconds===undefined||seconds<=0||seconds>60)return false;
 const blob=git(root,['rev-parse',`HEAD:${file}`]);
 for(const raw of source.localPushObservations??[]){
  const parsed=v.safeParse(localSchema,raw);if(!parsed.success||parsed.output.ring!==ring)continue;
  if(parsed.output.files.some(row=>row.file===file&&row.blob===blob&&Math.abs(row.durationMs/1000-seconds)<1e-6))return true;
 }
 for(const raw of source.additionalFileObservations??[]){
  const parsed=v.safeParse(hostedSchema,raw);if(!parsed.success)continue;const row=parsed.output;
  if(row.file===file&&row.appliedTo.includes(ring==='1'?'ring1':'full')&&Math.abs(row.durationMs/1000-seconds)<1e-6&&blobAt(root,row.sha,file)===blob)return true;
 }
 const baseline=v.safeParse(v.object({sha:v.pipe(v.string(),v.regex(/^[a-f0-9]{40}$/u)),run:v.pipe(v.string(),v.regex(/^\d+$/u))}),source[ring==='1'?'ring1':'full']);
 return baseline.success&&blobAt(root,baseline.output.sha,file)===blob;
}

/** Use the same real configured discovery as the planner; kit tests stay kit tests.
 * @param {string} root @param {'full'|'1'} ring */
function inventory(root,ring){
 /** @type {NodeJS.ProcessEnv & {WILDSHARD_RING?:string}} */const env={...process.env,CI:'true',WS_TEST_QUARANTINE:'blocking'};
 if(ring==='1')env.WILDSHARD_RING='1';else Reflect.deleteProperty(env,'WILDSHARD_RING');
 const output=execFileSync(process.execPath,[resolve(import.meta.dirname,'vitest-tmp.ts'),'list','--filesOnly','--json'],{cwd:root,env,encoding:'utf8',timeout:30_000,maxBuffer:16*1024*1024});
 return new Set(v.parse(v.array(v.object({file:v.string()})),JSON.parse(output)).map(row=>resolve(row.file)));
}

/** A new ref has no old tip, but its destination can already contain this code.
 * Query that remote, not a possibly stale/different remote-tracking branch.
 * Unknown/unrelated history retains the conservative whole-tree check.
 * @param {string} root @param {string} local @param {string|undefined} destination */
function publishedBase(root,local,destination){
 try{
  // Git's hook supplies its actual push URL ($2), not the fetch remote's name.
  // The queue's preceding origin gate has no hook arguments yet.
  const url=destination??git(root,['remote','get-url','--push','origin']);
  /** @type {import('node:child_process').ExecFileSyncOptionsWithStringEncoding} */
  const options={cwd:root,encoding:'utf8',timeout:15_000,stdio:['ignore','pipe','ignore']};
  const advertised=execFileSync('git',['ls-remote','--exit-code','--heads','--',url,'refs/heads/main'],options).trim();
  const [sha,ref,...extra]=advertised.split(/\s+/u);
  if(extra.length>0||ref!=='refs/heads/main'||!/^[a-f0-9]{40}$/u.test(sha??''))return null;
  try{execFileSync('git',['cat-file','-e',`${sha}^{commit}`],options);}catch{
   // Hydrate only the advertised commit; no checkout, tracking ref or source edit.
   execFileSync('git',['fetch','--no-tags','--no-write-fetch-head','--no-recurse-submodules','--',url,sha],options);
  }
  return execFileSync('git',['merge-base',local,sha],options).trim();
 }catch{return null;}
}

/** Only actual additions/renames in the complete pushed ranges; no file-import approximation.
 * @param {string|undefined} refs @param {string} [root] @param {string} [destination] */
export function missingTestTimings(refs,root=process.cwd(),destination=process.env.WS_PUSH_DESTINATION){
 if(!refs?.trim())return [];
 const added=new Set();
 for(const row of refs.trim().split('\n')){
  const [,local,,remote]=row.trim().split(/\s+/u);
  if(!/^[a-f0-9]{40}$/u.test(local??'')||!/^[a-f0-9]{40}$/u.test(remote??''))throw new Error('Invalid timing admission push range');
  if(/^0+$/u.test(local))continue;
  const base=/^0+$/u.test(remote)?publishedBase(root,local,destination):remote;
  const paths=base===null?git(root,['ls-tree','-r','--name-only','-z',local]):git(root,['diff','--no-renames','--diff-filter=A','--name-only','-z',base,local]);
  for(const file of paths.split('\0'))if(/^(?:src|test)\/[\s\S]+\.test\.[cm]?[jt]sx?$/u.test(file))added.add(file);
  // Restoring an inherited path changes discovery even when Git reports no
  // new source file. Removed/moved files are filtered by real discovery below.
  if(base!==null){
   const inventoryFile='test/lift-pending.json',before=blobAt(root,base,inventoryFile),after=blobAt(root,local,inventoryFile);
   if(before!==after){
    const previous=before===null?[]:v.parse(v.array(v.string()),JSON.parse(git(root,['show',`${base}:${inventoryFile}`])));
    const remaining=new Set(after===null?[]:v.parse(v.array(v.string()),JSON.parse(git(root,['show',`${local}:${inventoryFile}`]))));
    for(const file of previous)if(!remaining.has(file))added.add(file);
   }
  }
 }
 if(added.size===0)return [];
 const fullFiles=inventory(root,'full'),ringFiles=inventory(root,'1'),full=weights(root,'full'),ring1=weights(root,'1');
 const source=provenance(root,true);
 return [...added].sort((a,b)=>a.localeCompare(b)).flatMap(file=>{
  /** @type {('full'|'1')[]} */const rings=[];
  if(fullFiles.has(resolve(root,file))&&!committedTiming(root,file,'full',full[file],source))rings.push('full');
  if(ringFiles.has(resolve(root,file))&&!committedTiming(root,file,'1',ring1[file],source))rings.push('1');
  return rings.length===0?[]:[{file,blob:git(root,['rev-parse',`HEAD:${file}`]),rings}];
 });
}

/** Write only Git-private evidence; never change the checked source tree.
 * @param {ReturnType<typeof missingTestTimings>} files @param {string} profile @param {string} [root] @param {string} [evidenceRoot] */
export function prepareTestTimings(files,profile,root=process.cwd(),evidenceRoot=resolve(homedir(),'.cache/wildshard/push-test-timings')){
 const directory=resolve(evidenceRoot,randomUUID());
 mkdirSync(directory,{recursive:true});
 const common={schema:'push-test-timing/1',sha:git(root,['rev-parse','HEAD']),tree:git(root,['rev-parse','HEAD^{tree}']),profile,platform:process.platform,arch:process.arch};
 /** @type {Partial<Record<'full'|'1',string>>} */const requests={};
 for(const ring of /** @type {const} */(['full','1'])){
  const selected=files.filter(file=>file.rings.includes(ring));if(selected.length===0)continue;
  const path=resolve(directory,`${ring}.request.json`);
  writeFileSync(path,`${JSON.stringify({...common,ring,files:selected},null,2)}\n`);requests[ring]=path;
 }
 return {directory,requests};
}

/** Only the process owner, after an actual zero exit, seals a report.
 * @param {string} requestPath @param {number} code */
export function completeTestTimings(requestPath,code){
 if(code!==0)throw new Error('Failed timing process cannot complete evidence');
 const requestText=readFileSync(requestPath,'utf8'),request=v.parse(timingRequestSchema,JSON.parse(requestText));
 const reportPath=resolve(requestPath,'..',`${request.ring}.report.json`),reportText=readFileSync(reportPath,'utf8');
 v.parse(reportSchema,JSON.parse(reportText));
 writeFileSync(resolve(requestPath,'..',`${request.ring}.completion.json`),JSON.stringify({request:digest(requestText),report:digest(reportText),code:0}));
}

/** A failed/missing/skipped/zero-test/stale result cannot become a clock.
 * @param {string} directory @param {string} [root] */
export function readTestTimings(directory,root=process.cwd()){
 if(git(root,['status','--porcelain','--untracked-files=normal'])!=='')throw new Error('New-test timing evidence requires a clean checked source tree');
 const result=[];
 for(const ring of /** @type {const} */(['full','1'])){
  const path=resolve(directory,`${ring}.report.json`);
  // Every request must have a report. An absent request means this ring has no new file.
  let request;
  try{request=v.parse(timingRequestSchema,JSON.parse(readFileSync(resolve(directory,`${ring}.request.json`),'utf8')));}catch(error){
   if(error!==null&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')continue;throw error;
  }
  const reportText=readFileSync(path,'utf8'),report=v.parse(reportSchema,JSON.parse(reportText));
  const completion=v.parse(v.object({request:v.string(),report:v.string(),code:v.literal(0)}),JSON.parse(readFileSync(resolve(directory,`${ring}.completion.json`),'utf8')));
  if(completion.request!==digest(readFileSync(resolve(directory,`${ring}.request.json`),'utf8'))||completion.report!==digest(reportText))throw new Error('Timing evidence changed after process completion');
  // Measurements are historical data, not an exact-tree green code proof. A
  // queue's rebased tree can differ from its source; the measured test blob must
  // still match and its original complete source identity remains explicit.
  if(report.ring!==ring||report.tree!==request.tree||report.sha!==request.sha||report.files.length!==request.files.length)throw new Error('New-test timing evidence is for another tree or inventory');
  for(const expected of request.files){
   const file=report.files.find(row=>row.file===expected.file);
   if(file===undefined||file.blob!==expected.blob||file.blob!==git(root,['rev-parse',`HEAD:${file.file}`])||file.durationMs>60_000)throw new Error(`Missing, stale or over-budget new-test timing: ${expected.file}`);
  }
  result.push(report);
 }
 if(result.length===0)throw new Error('No new-test timing evidence');
 return result;
}

/** Explicit source update after a refused push; the next normal gate checks its new tree.
 * @param {string} directory @param {string} [root] */
export function recordTestTimings(directory,root=process.cwd()){
 const reports=readTestTimings(directory,root);
 const source=provenance(root);
 const observed=new Set(observationLog(root).map(row=>JSON.stringify(row)));
 // Validate every target before changing even one tracked timing table.
 const updates=reports.map(report=>{
  const observation={...report,completed:true,basis:'Actual local complete-module diagnostics, including collection/setup/environment. Bootstrap data; not a hosted Linux observation or green code proof.'};
  const alreadyLogged=observed.has(JSON.stringify(v.parse(localSchema,observation)));
  const current=weights(root,report.ring);
  let changed=false;
  for(const row of report.files){
   const seconds=row.durationMs/1000;
   const existing=current[row.file];
   if(committedTiming(root,row.file,report.ring,existing,source)&&(!alreadyLogged||existing!==seconds))throw new Error(`Timing already recorded; refusing to overwrite ${row.file}`);
   if(existing!==seconds){current[row.file]=seconds;changed=true;}
  }
  return {report,current,changed,line:alreadyLogged?null:JSON.stringify(observation)};
 });
 // Publish the observation before its weights. A failed append leaves both
 // tables untouched. Replaying the same sealed evidence can finish a table
 // write without appending a duplicate or overwriting a different clock.
 const descriptor=openSync(resolve(root,observationFile),constants.O_RDWR|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o644);
 try{
  const info=fstatSync(descriptor);
  if(!info.isFile())throw new Error('Timing observations must be a regular file');
  const lines=updates.flatMap(update=>update.line===null?[]:[update.line]);
  if(lines.length>0){
   const lastByte=Buffer.alloc(1);
   if(info.size>0&&readSync(descriptor,lastByte,0,1,info.size-1)!==1)throw new Error('Timing observation tail changed while recording');
   const separator=info.size>0&&lastByte[0]!==10?'\n':'';
   writeFileSync(descriptor,`${separator}${lines.join('\n')}\n`);
  }
 }finally{closeSync(descriptor);}
 for(const {report,current,changed} of updates){
  if(!changed)continue;
  const path=resolve(root,report.ring==='full'?'test/durations.json':'test/durations-ring1.json');
  const temporary=`${path}.${randomUUID()}.tmp`;
  const output=openSync(temporary,'wx');
  try{
   try{writeFileSync(output,`${JSON.stringify(Object.fromEntries(Object.entries(current).sort(([a],[b])=>a.localeCompare(b))),null,2)}\n`);}finally{closeSync(output);}
   renameSync(temporary,path);
  }finally{rmSync(temporary,{force:true});}
 }
 return reports.flatMap(report=>report.files.map(file=>`${report.ring}:${file.file}`));
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]!=='record'||process.argv[3]===undefined)throw new Error('Usage: push-test-timings.mjs record <Git-private-evidence-directory>');
 console.log(`Recorded ${recordTestTimings(process.argv[3]).join(', ')}; commit the changed weight tables and ${observationFile} with a journal entry, then push normally.`);
}
