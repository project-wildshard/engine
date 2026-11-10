// Outside-hook actual Git/loader/CLI integration, no test bodies or timers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readLiftPending} from './lift-pending.mjs';
import {dateLiftBatches} from './lift-pending-batches.mjs';

const started=performance.now(),base=resolve('tmp/lift-pending-batches');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'run-'));
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
 for(const name of ['lift-pending.mjs','lift-pending-batches.mjs'])copyFileSync(`scripts/${name}`,join(root,'scripts',name));
 git(['init','--quiet','--initial-branch=main']);put();git(['add','test','scripts']);git(['commit','--quiet','-m','original inventory'],'2026-11-09T01:00:00Z');
 policy.extension={rule:'J200',decidedBy:'Jake',decidedAt:'2026-11-10',decision:'Actual proof first extension',deadline:'2026-11-12T01:00:00Z',evidence:'Actual Git first extension control',reason:'One fixed extension for inherited migration debt, not execution qualification.'};put();commit('2026-11-10T01:00:00Z','first extension');
 const batchSchedule=dateLiftBatches({schema:'ci21-batches/1',rule:'J237',decidedBy:'Jake',decidedAt:'2026-11-10',evidence:'Actual J237 introducing-history proof with two independent enablers',startsAfter:'2026-11-12T01:00:00Z',sourceMap:{repository:'Raynos/project-wildshard-meta',revision:'1'.repeat(40),sha256:'2'.repeat(64)},landings:{'CI21-H1':null,'CI21-H2':null},batches:[
  {id:'READY',owner:'codex-mock',members:[a],requires:[],windowHours:48,deadline:null},
  {id:'ONE',owner:'codex-mock',members:[b],requires:['CI21-H1'],windowHours:48,deadline:null},
  {id:'TWO',owner:'codex-mock',members:[c],requires:['CI21-H1','CI21-H2'],windowHours:48,deadline:null},
 ]});policy.batchSchedule=batchSchedule;put();commit('2026-11-10T02:00:00Z','dated per-batch policy');
 const cli=spawnSync(process.execPath,['scripts/lift-pending.mjs'],{cwd:root,encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).excluded,3);
 assert.equal(read('2026-11-13T02:00:00Z').excluded.length,3,'J237 extends each batch beyond the old global expiry');
 assert.throws(()=>read('2026-11-14T01:00:00Z'),/CI21 batch deadline missed: READY/u,'One missed batch makes engine red while others wait');
 files=[b,c];put();commit('2026-11-14T02:00:00Z','port ready file');
 const blocked=read('2026-11-15T00:00:00Z');assert.equal(blocked.excluded.length,2);assert.equal(blocked.deadline,'2026-11-12T01:00:00Z','No time-live proof reuse while every batch awaits its enabler');
 writeFileSync(join(root,'enabler-one'),'actual enabler source');git(['add','enabler-one']);git(['commit','--quiet','-m','land H1'],'2026-11-15T01:00:00Z');const first=git(['rev-parse','HEAD']);
 batchSchedule.landings['CI21-H1']={repository:'project-wildshard/engine',commit:first,landedAt:'2026-11-15T01:00:00Z',evidence:'Actual committed first enabler source; this receipt must never reset'};
 policy.batchSchedule=dateLiftBatches(batchSchedule);put();commit('2026-11-15T01:01:00Z','record first landing');
 const landed=read('2026-11-16T02:00:00Z');assert.equal(landed.batches.find(item=>item.id==='ONE')?.deadline,'2026-11-17T01:00:00.000Z');assert.deepEqual(landed.batches.find(item=>item.id==='TWO')?.waitingFor,['CI21-H2']);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);s.batches[1].deadline='2026-11-18T01:00:00Z';},/date must be derived/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);s.batches[1].windowHours=72;},/immutable/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);s.landings['CI21-H1']=null;},/cannot be reset/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);const landing=s.landings['CI21-H1'];assert.ok(landing);landing.landedAt='2026-11-16T01:00:00Z';},/first committed landing/u);
 refused(()=>{files.push(a);},/deadline missed: READY/u);
 refused(()=>{files.push('test/unassigned.test.ts');},/Unscheduled/u);
 refused(()=>{const s=/** @type {typeof batchSchedule} */(policy.batchSchedule);s.batches[0].id='RENAMED';},/immutable/u);
 assert.throws(()=>read('2026-11-17T01:00:00Z'),/deadline missed: ONE/u);
 files=[c];put();commit('2026-11-17T02:00:00Z','port one-enabler batch');
 writeFileSync(join(root,'enabler-two'),'actual second enabler source');git(['add','enabler-two']);git(['commit','--quiet','-m','land H2'],'2026-11-18T01:00:00Z');const second=git(['rev-parse','HEAD']);
 const schedule=/** @type {typeof batchSchedule} */(policy.batchSchedule);
 schedule.landings['CI21-H2']={repository:'project-wildshard/engine',commit:second,landedAt:'2026-11-18T01:00:00Z',evidence:'Actual second enabler; both dependencies required before the batch is dated'};
 policy.batchSchedule=dateLiftBatches(schedule);put();commit('2026-11-18T01:01:00Z','record second landing');
 assert.equal(read('2026-11-19T01:00:00Z').deadline,'2026-11-20T01:00:00.000Z');
 assert.throws(()=>read('2026-11-20T01:00:00Z'),/deadline missed: TWO/u);
 files=[];put();commit('2026-11-20T02:00:00Z','all tests ported');assert.equal(read('2026-12-01T00:00:00Z').excluded.length,0);
 console.log(JSON.stringify({actualGit:true,actualCLI:true,independentBatchExpiry:true,firstLandingFrozen:true,renameAndReaddRefused:true,multiEnablerLastLanding:true,allPorted:true,wallMs:performance.now()-started}));
}finally{rmSync(root,{recursive:true,force:true});}
