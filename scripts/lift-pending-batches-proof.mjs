// Outside-hook actual Git/loader/CLI integration, no test bodies or timers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readLiftPending} from './lift-pending.mjs';
import {dateLiftBatches} from './lift-pending-batches.mjs';
import {capturePushTree,readPushProof,writePushProof} from './push-proof-cache.mjs';

const started=performance.now(),base=resolve('tmp/lift-pending-batches');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'run-')),published=`${root}-published.git`;
const cacheEnabled=!process.argv.includes('--without-cache');
/** @param {string[]} args @param {string} [date] */
const git=(args,date)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Batch proof',GIT_AUTHOR_EMAIL:'proof@example.test',GIT_COMMITTER_NAME:'Batch proof',GIT_COMMITTER_EMAIL:'proof@example.test',...(date?{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}:{})}}).trim();
/** @param {string} date @param {string} message */
const commit=(date,message)=>git(['commit','--quiet','-am',message],date);
const a='test/ready.test.ts',b='test/one.test.ts',c='test/two.test.ts';
/** @type {string[]} */let files=[a,b,c];
/** @type {Record<string,unknown>} */const policy={schema:1,owner:'codex-mock',registeredAt:'2026-11-09T01:00:00Z',deadline:'2026-11-10T01:00:00Z',reason:'Actual migration fixture: every test must port; no execution is claimed by registration.'};
function put(){
 const bytes=`${JSON.stringify(files)}\n`;policy.inventorySha256=createHash('sha256').update(bytes).digest('hex');
 writeFileSync(join(root,'test/lift-pending.json'),bytes);writeFileSync(join(root,'test/lift-pending-policy.json'),JSON.stringify(policy));
}
/** @param {string} now */const read=now=>readLiftPending(root,Date.parse(now));
/** @param {()=>void} edit @param {RegExp} error */function refused(edit,error){const before=structuredClone(policy),prior=[...files];edit();put();assert.throws(()=>read('2026-11-16T02:00:00Z'),error);for(const key of Object.keys(policy))delete policy[key];Object.assign(policy,before);files=prior;put();}
try{
 mkdirSync(join(root,'test'));mkdirSync(join(root,'scripts'));
 for(const name of ['lift-pending.mjs','lift-pending-batches.mjs','lift-pending-schedule.mjs'])copyFileSync(`scripts/${name}`,join(root,'scripts',name));
 git(['init','--quiet','--initial-branch=main']);git(['init','--bare','--quiet',published]);git(['remote','add','origin',published]);put();
 for(const file of files)writeFileSync(join(root,file),'// Actual inherited source path, never executed by this policy proof.\n');
 git(['add','test','scripts']);git(['commit','--quiet','-m','original inventory'],'2026-11-09T01:00:00Z');
 policy.extension={rule:'J200',decidedBy:'Jake',decidedAt:'2026-11-10',decision:'Actual proof first extension',deadline:'2026-11-12T01:00:00Z',evidence:'Actual Git first extension control',reason:'One fixed extension for inherited migration debt, not execution qualification.'};put();commit('2026-11-10T01:00:00Z','first extension');
 const batchSchedule=dateLiftBatches({schema:'ci21-batches/1',rule:'J237',decidedBy:'Jake',decidedAt:'2026-11-10',evidence:'Actual J237 introducing-history proof with two independent enablers',startsAfter:'2026-11-12T01:00:00Z',sourceMap:{repository:'Raynos/project-wildshard-meta',revision:'1'.repeat(40),sha256:'2'.repeat(64)},landings:{'CI21-H1':null,'CI21-H2':null},batches:[
  {id:'READY',owner:'codex-mock',members:[a],requires:[],windowHours:48,deadline:null},
  {id:'ONE',owner:'codex-mock',members:[b],requires:['CI21-H1'],windowHours:48,deadline:null},
  {id:'TWO',owner:'codex-mock',members:[c],requires:['CI21-H1','CI21-H2'],windowHours:48,deadline:null},
 ]});policy.batchSchedule=batchSchedule;put();commit('2026-11-10T02:00:00Z','dated per-batch policy');
 const cli=spawnSync(process.execPath,['scripts/lift-pending.mjs'],{cwd:root,encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).excluded,3);
 // Policy observation dates only, never a game/test clock. Exercise the actual
 // cached-proof API across the transition and the first batch's exact cutoff.
 const clock=Date.now,selection=/** @type {{mode:'full',files:string[]}} */({mode:'full',files:[]});
 if(cacheEnabled)try{
  Date.now=()=>Date.parse('2026-11-11T02:00:00Z');
  const before=capturePushTree('j237-proof',{PATH:process.env.PATH},root);assert.ok(before);writePushProof(before,selection,.01);assert.ok(readPushProof(before,selection));
  Date.now=()=>Date.parse('2026-11-13T02:00:00Z');assert.equal(readPushProof(before,selection),null,'Prior-cutoff proof cannot survive the J237 transition');
  const after=capturePushTree('j237-proof',{PATH:process.env.PATH},root);assert.ok(after);writePushProof(after,selection,.01);assert.ok(readPushProof(after,selection));
  Date.now=()=>Date.parse('2026-11-14T01:00:00Z');assert.equal(readPushProof(after,selection),null,'A missed batch cannot reuse an exact-tree proof');
 }finally{Date.now=clock;}
 assert.equal(read('2026-11-13T02:00:00Z').excluded.length,3,'J237 extends each batch beyond the old global expiry');
 assert.throws(()=>read('2026-11-14T01:00:00Z'),/CI21 batch deadline missed: READY/u,'One missed batch makes engine red while others wait');
 files=[b,c];put();commit('2026-11-14T02:00:00Z','port ready file');
 const blocked=read('2026-11-15T00:00:00Z');assert.equal(blocked.excluded.length,2);
 writeFileSync(join(root,'enabler-one'),'actual first integration source');git(['add','enabler-one']);git(['commit','--quiet','-m','first enabler source'],'2026-11-15T01:00:00Z');const first=git(['rev-parse','HEAD']);git(['push','--quiet','origin','HEAD:main']);
 // A fresh successful gate can be recorded while all remaining batches wait.
 // An empty-tree integration marker must invalidate it before a receipt exists.
 try{
  Date.now=()=>Date.parse('2026-11-15T00:00:00Z');
  const waiting=cacheEnabled?capturePushTree('j237-proof',{PATH:process.env.PATH},root):null;
  if(cacheEnabled){assert.ok(waiting);writePushProof(waiting,selection,.01);assert.ok(readPushProof(waiting,selection));assert.equal(blocked.deadline,null,'A legitimately waiting batch has no fabricated expiry');}
  git(['commit','--allow-empty','--quiet','-m',`integrate H1\n\nCI21-Enabler: CI21-H1 ${first}`],'2026-11-15T01:00:30Z');
  if(waiting){assert.equal(git(['rev-parse','HEAD^{tree}']),waiting.tree);assert.equal(readPushProof(waiting,selection),null,'A same-tree missing landing receipt must invalidate reuse');}
 }finally{Date.now=clock;}
 assert.throws(()=>read('2026-11-15T02:00:00Z'),/first receipt and derived batch dates are required/u);
 execFileSync(process.execPath,['scripts/lift-pending-schedule.mjs'],{cwd:root});
 Object.assign(policy,JSON.parse(readFileSync(join(root,'test/lift-pending-policy.json'),'utf8')));put();commit('2026-11-15T01:01:00Z','record first landing');
 assert.equal(/** @type {typeof batchSchedule} */(policy.batchSchedule).landings['CI21-H1']?.commit,first);
 const landed=read('2026-11-16T02:00:00Z');assert.equal(landed.batches.find(item=>item.id==='ONE')?.deadline,'2026-11-17T01:00:00.000Z');assert.deepEqual(landed.batches.find(item=>item.id==='TWO')?.waitingFor,['CI21-H2']);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);const batch=s.batches[1];assert.ok(batch);batch.deadline='2026-11-18T01:00:00Z';},/date must be derived/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);const batch=s.batches[1];assert.ok(batch);batch.windowHours=72;},/immutable/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);s.landings['CI21-H1']=null;},/cannot be reset/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);const landing=s.landings['CI21-H1'];assert.ok(landing);landing.landedAt='2026-11-16T01:00:00Z';},/first committed landing/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);const landing=s.landings['CI21-H1'];assert.ok(landing);landing.repository='project-wildshard/sharddev';},/external receipts alone cannot activate/u);
 refused(()=>{files.push(a);},/deadline missed: READY/u);
 refused(()=>{files.push('test/unassigned.test.ts');},/Unscheduled/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);const batch=s.batches[0];assert.ok(batch);batch.id='RENAMED';},/immutable/u);
 // Committed negative histories, not only dirty working-copy edits.
 /** @param {string} name @param {(dir:string,run:(args:string[])=>string,p:Record<string,unknown>&{batchSchedule:ReturnType<typeof dateLiftBatches>})=>void} control @param {string} [at] */
 const fork=(name,control,at='2026-11-16T01:00:00Z')=>{
  const dir=join(root,`control-${name}`);git(['clone','--quiet',root,dir]);
  /** @param {string[]} args */const run=args=>execFileSync('git',['-c','user.name=Batch proof','-c','user.email=proof@example.test',...args],{cwd:dir,encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:at,GIT_COMMITTER_DATE:at}}).trim();
  control(dir,run,/** @type {Record<string,unknown>&{batchSchedule:ReturnType<typeof dateLiftBatches>}} */(structuredClone(policy)));rmSync(dir,{recursive:true,force:true});
 };
 fork('receipt-reset',(dir,run,p)=>{
  const original=structuredClone(p.batchSchedule.landings['CI21-H1']);assert.ok(original);p.batchSchedule.landings['CI21-H1']=null;
  const save=()=>writeFileSync(join(dir,'test/lift-pending-policy.json'),JSON.stringify(p));save();run(['commit','--quiet','-am','remove receipt']);
  assert.throws(()=>readLiftPending(dir,Date.parse('2026-11-16T02:00:00Z')),/cannot be reset/u);
  p.batchSchedule.landings['CI21-H1']={...original,landedAt:'2026-11-16T01:00:00Z'};p.batchSchedule=dateLiftBatches(p.batchSchedule);save();run(['commit','--quiet','-am','re-add later receipt']);
  assert.throws(()=>readLiftPending(dir,Date.parse('2026-11-16T02:00:00Z')),/first committed landing/u);
 });
 fork('rename',(dir,run,p)=>{
  run(['mv',a,'test/renamed.test.ts']);const batch=p.batchSchedule.batches[0];assert.ok(batch);batch.members=['test/renamed.test.ts'];
  const bytes=`${JSON.stringify([...files,'test/renamed.test.ts'])}\n`;p.inventorySha256=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(dir,'test/lift-pending.json'),bytes);writeFileSync(join(dir,'test/lift-pending-policy.json'),JSON.stringify(p));run(['commit','--quiet','-am','rename inherited path']);
  assert.throws(()=>readLiftPending(dir,Date.parse('2026-11-16T02:00:00Z')),/immutable/u);
 });
 fork('foreign-first-receipt',(dir,run,p)=>{
  p.batchSchedule.landings['CI21-H2']={repository:'project-wildshard/sharddev',commit:'3'.repeat(40),landedAt:'2026-11-16T01:00:00Z',evidence:'This unverified external first receipt must not grant any extension'};
  const batch=p.batchSchedule.batches.find(item=>item.id==='TWO');assert.ok(batch);batch.deadline='2026-11-18T01:00:00.000Z';
  writeFileSync(join(dir,'test/lift-pending-policy.json'),JSON.stringify(p));run(['commit','--quiet','-am','false external first landing']);
  assert.throws(()=>readLiftPending(dir,Date.parse('2026-11-16T02:00:00Z')),/external receipts alone cannot activate/u);
 });
 fork('unpublished-source',(dir,run,p)=>{
  writeFileSync(join(dir,'not-published'),'unpublished source');run(['add','not-published']);run(['commit','--quiet','-m','unpublished enabler']);const source=run(['rev-parse','HEAD']);
  run(['commit','--quiet','--allow-empty','-m',`close unpublished source\n\nCI21-Enabler: CI21-H2 ${source}`]);
  p.batchSchedule.landings['CI21-H2']={repository:'project-wildshard/engine',commit:source,landedAt:'2026-11-16T01:00:00Z',evidence:'A real commit in this clone alone must not count as published delivery'};p.batchSchedule=dateLiftBatches(p.batchSchedule);
  writeFileSync(join(dir,'test/lift-pending-policy.json'),JSON.stringify(p));run(['commit','--quiet','-am','record unpublished source']);
  assert.throws(()=>readLiftPending(dir,Date.parse('2026-11-16T02:00:00Z')),/needs a landed engine commit/u);
 });
 assert.throws(()=>read('2026-11-17T01:00:00Z'),/deadline missed: ONE/u);
 files=[c];put();commit('2026-11-17T02:00:00Z','port one-enabler batch');
 writeFileSync(join(root,'enabler-two'),'actual second enabler source');git(['add','enabler-two']);git(['commit','--quiet','-m','second enabler source'],'2026-11-18T01:00:00Z');const second=git(['rev-parse','HEAD']);git(['push','--quiet','origin','HEAD:main']);
 fork('rebased-closure',(dir,run)=>{
  run(['commit','--quiet','--allow-empty','-m',`close H2\n\nCI21-Enabler: CI21-H2 ${second}`]);
  execFileSync(process.execPath,['scripts/lift-pending-schedule.mjs'],{cwd:dir});run(['commit','--quiet','-am','date H2']);
  const before=run(['rev-parse','HEAD']);writeFileSync(join(root,'independent-advance'),'another lane');git(['add','independent-advance']);git(['commit','--quiet','-m','another lane advances main'],'2026-11-18T01:02:00Z');
  run(['pull','--quiet','--rebase','origin','main']);assert.notEqual(run(['rev-parse','HEAD']),before);
  assert.equal(readLiftPending(dir,Date.parse('2026-11-19T01:00:00Z')).deadline,'2026-11-20T01:00:00.000Z','A real queued-style rebase preserves the published enabler clock');
 },'2026-11-18T01:03:00Z');
 git(['commit','--allow-empty','--quiet','-m',`integrate H2\n\nCI21-Enabler: CI21-H2 ${second}`],'2026-11-18T01:00:30Z');
 execFileSync(process.execPath,['scripts/lift-pending-schedule.mjs'],{cwd:root});
 Object.assign(policy,JSON.parse(readFileSync(join(root,'test/lift-pending-policy.json'),'utf8')));put();commit('2026-11-18T01:01:00Z','record second landing');
 assert.equal(/** @type {typeof batchSchedule} */(policy.batchSchedule).landings['CI21-H2']?.commit,second);
 assert.equal(read('2026-11-19T01:00:00Z').deadline,'2026-11-20T01:00:00.000Z');
 assert.throws(()=>read('2026-11-20T01:00:00Z'),/deadline missed: TWO/u);
 files=[];put();commit('2026-11-20T02:00:00Z','all tests ported');assert.equal(read('2026-12-01T00:00:00Z').excluded.length,0);
 console.log(JSON.stringify({actualGit:true,actualCLI:true,actualProofCache:cacheEnabled,independentBatchExpiry:true,firstLandingFrozen:true,renameAndReaddRefused:true,multiEnablerLastLanding:true,allPorted:true,wallMs:performance.now()-started}));
}finally{rmSync(root,{recursive:true,force:true});rmSync(published,{recursive:true,force:true});}
