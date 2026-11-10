// Actual diagnostic export and real failed-hook cleanup; no browser or fake profiles outside this fixture.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,existsSync,linkSync,mkdirSync,mkdtempSync,openSync,closeSync,ftruncateSync,readdirSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';

const began=performance.now(),mode=process.argv[2]??'files',out=resolvePath(process.argv.slice(3).find(arg=>!arg.startsWith('--'))??'tmp/push-queue-retain-proof');mkdirSync(out,{recursive:true});
const root=mkdtempSync(join(out,'run-')),helper=resolvePath(process.argv.find(arg=>arg.startsWith('--helper='))?.slice(9)??'scripts/push-queue-retain.py'),script=resolvePath(process.argv.find(arg=>arg.startsWith('--driver='))?.slice(9)??'scripts/push-queue.mjs'),lock=resolvePath('scripts/push-queue-lock.py');
const snapshot=join(root,'snapshot'),queue=join(root,'queue'),job='000000001-12345678',sha='1'.repeat(40);mkdirSync(snapshot);mkdirSync(queue,{mode:0o700});
/** @param {string} name @param {object} value */
const request=(name,value)=>{const dir=join(snapshot,'tmp/queue-retain-requests');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,`${name}.json`),JSON.stringify(value),{flag:'wx'});};
/** @param {string} profile */const manifest=profile=>({schema:'wildshard.native-retain/1',kind:'native-writer-drain',profile});
/** @typedef {{partial:boolean,checkedSha:string,requests:{request:string,treeSha256:string,skipped:number,omissions:{reason:string}[]}[],entries:number,bytes:number}} RetainedReport */
/** @param {string} [identity] @returns {RetainedReport} */
const run=(identity=job)=>JSON.parse(execFileSync('python3',[helper,snapshot,queue,identity,sha],{encoding:'utf8',timeout:7000}));
/** @param {string} path @param {number} size */const sparse=(path,size)=>{const fd=openSync(path,'wx');try{ftruncateSync(fd,size);}finally{closeSync(fd);}};
try{
 if(mode==='files'||mode==='caps'){
  const profile=join(snapshot,'tmp/native-writer-drain-ABC123');mkdirSync(profile,{recursive:true});
  writeFileSync(join(profile,'writer'),'retained actual marker');
  const id=randomUUID();request(id,manifest('tmp/native-writer-drain-ABC123'));
  if(mode==='files'){
   const secret=join(root,'outside');writeFileSync(secret,'never export outside bytes');
   symlinkSync(secret,join(profile,'SingletonLock'));linkSync(secret,join(profile,'hard-link'));
   execFileSync('mkfifo',[join(profile,'fifo')]);
   mkdirSync(join(profile,'Default'));writeFileSync(join(profile,'Default/data'),'owned profile bytes');
   request(randomUUID(),manifest('../outside'));request(randomUUID(),{...manifest('tmp/native-writer-drain-ABC123'),kind:[]});
   symlinkSync(root,join(snapshot,'tmp/escape-control-ABC123'));
   request(randomUUID(),{schema:'wildshard.native-retain/1',kind:'native-escape',profile:'tmp/escape-control-ABC123'});
   symlinkSync(secret,join(snapshot,'tmp/queue-retain-requests',`${randomUUID()}.json`));
   const report=run();assert.equal(report.partial,true);assert.equal(report.checkedSha,sha);
   const retained=join(queue,'retained',job,id);assert.equal(readFileSync(join(retained,'writer'),'utf8'),'retained actual marker');
   assert.equal(readFileSync(join(retained,'Default/data'),'utf8'),'owned profile bytes');
   for(const name of ['SingletonLock','hard-link','fifo'])assert.equal(existsSync(join(retained,name)),false);
   const copied=report.requests.find(row=>row.request===`${id}.json`);assert.ok(copied);assert.ok(copied.skipped>=3);const digest=createHash('sha256');for(const path of ['Default/data','writer'])digest.update(path).update('\0').update(createHash('sha256').update(readFileSync(join(retained,path))).digest());assert.equal(copied.treeSha256,digest.digest('hex'));
   const serialized=JSON.stringify(report);assert.ok(!serialized.includes('never export outside bytes'));
   const duplicate=run();assert.equal(duplicate.bytes,0);assert.equal(duplicate.partial,true);assert.equal(readFileSync(join(retained,'writer'),'utf8'),'retained actual marker');
   const destination=join(queue,'retained',job);assert.equal((await import('node:fs')).statSync(destination).mode&0o077,0);
   assert.ok(report.requests.some(row=>row.omissions.some(item=>item.reason==='unsafe native profile path')));
   assert.ok(report.requests.some(row=>row.omissions.some(item=>item.reason==='unsupported native request')));
   assert.equal(readFileSync(secret,'utf8'),'never export outside bytes');
   const linkedQueue=join(root,'linked-queue');symlinkSync(queue,linkedQueue);assert.throws(()=>execFileSync('python3',[helper,snapshot,linkedQueue,job,sha],{encoding:'utf8',stdio:'pipe'}));
   const hostileQueue=join(root,'hostile-queue');mkdirSync(hostileQueue,{mode:0o700});symlinkSync(root,join(hostileQueue,'retained'));assert.throws(()=>execFileSync('python3',[helper,snapshot,hostileQueue,job,sha],{encoding:'utf8',stdio:'pipe'}));
   console.log(JSON.stringify({mode,destinationLinksRefused:true,realCopiedFiles:2,symlinkHardlinkFifoRefused:true,pathEscapeAndMalformedKindRefused:true,priorEvidenceUnchanged:true}));
  }else{
   sparse(join(profile,'too-big'),64*1024*1024+1);
   for(let i=0;i<4100;i++)writeFileSync(join(profile,`file-${i}`),'');
   for(let i=0;i<20;i++)request(randomUUID(),manifest('tmp/native-writer-drain-ABC123'));
   const report=run();assert.equal(report.partial,true);assert.ok(report.requests.length<=16);assert.ok(report.entries<=4096);assert.ok(report.bytes<=64*1024*1024);
   assert.ok(!existsSync(join(queue,'retained',job,id,'too-big')));
   const full=join(queue,'retained','namespace-padding');mkdirSync(full,{mode:0o700});sparse(join(full,'limit'),256*1024*1024);
   assert.throws(()=>run('000000002-12345678'),/quota exceeded/u);
   console.log(JSON.stringify({mode,requests:report.requests.length,entries:report.entries,bytes:report.bytes,namespaceRefused:true}));
  }
 }else if(mode==='requests'){
  const profile=join(snapshot,'tmp/native-writer-drain-ABC123');mkdirSync(profile,{recursive:true});writeFileSync(join(profile,'writer'),'small retained marker');
  const first=Array.from({length:16},()=>randomUUID());for(const id of first)request(id,manifest('tmp/native-writer-drain-ABC123'));
  const original=run();assert.equal(original.requests.length,16);assert.equal(original.partial,false);
  for(const id of first)unlinkSync(join(snapshot,'tmp/queue-retain-requests',`${id}.json`));
  const next=randomUUID();request(next,manifest('tmp/native-writer-drain-ABC123'));const repeated=run();
  assert.equal(repeated.bytes,0,'The request cap belongs to the job, not one export');assert.equal(repeated.partial,true);assert.equal(existsSync(join(queue,'retained',job,next)),false);
  console.log(JSON.stringify({mode,cumulativeRequestCap:16,secondExportRefused:true}));
 }else if(mode==='restored-mtime'){
  const profile=join(snapshot,'tmp/native-writer-drain-ABC123');mkdirSync(profile,{recursive:true});
  const file=join(profile,'changing');sparse(file,63*1024*1024);const id=randomUUID();request(id,manifest('tmp/native-writer-drain-ABC123'));
  const destination=join(queue,'retained',job,id,'changing');
  const source="import os,sys,time\nsource,destination=sys.argv[1:]\noriginal=os.stat(source)\nprint('ready',flush=True)\nend=time.monotonic()+3\nwhile time.monotonic()<end:\n try:\n  if os.stat(destination).st_size>=1048576: break\n except FileNotFoundError: pass\n time.sleep(.0001)\nelse: raise SystemExit('copy never entered')\nfd=os.open(source,os.O_WRONLY)\nos.pwrite(fd,b'X',0)\nos.close(fd)\nos.utime(source,ns=(original.st_atime_ns,original.st_mtime_ns))";
  const racer=spawn('python3',['-u','-c',source,file,destination],{stdio:['ignore','pipe','pipe']});const ended=new Promise(resolve=>{racer.once('exit',resolve);});
  try{
   await new Promise((resolve,reject)=>{racer.stdout.once('data',resolve);racer.once('error',reject);});
   const report=run();await ended;assert.equal(racer.exitCode,0);assert.equal(report.bytes,0,'A same-size write restoring mtime must not keep stale copied bytes');assert.equal(report.partial,true);assert.equal(existsSync(destination),false);
   console.log(JSON.stringify({mode,ctimeMutationRefused:true,partialPayloadDeleted:true}));
  }finally{await ended;}
 }else if(mode==='race'){
  const profile=join(snapshot,'tmp/native-writer-drain-ABC123');mkdirSync(profile,{recursive:true});
  const file=join(profile,'changing');sparse(file,63*1024*1024);const changingRequest=randomUUID();request(changingRequest,manifest('tmp/native-writer-drain-ABC123'));
  const racer=spawn('python3',['-u','-c',"import os,sys,time,select\nprint('ready',flush=True)\nwhile not select.select([sys.stdin],[],[],.0005)[0]:\n os.utime(sys.argv[1],ns=(time.time_ns(),time.time_ns()))",file],{stdio:['pipe','pipe','pipe']});
  const ended=new Promise(resolve=>{racer.once('exit',resolve);});
  try{
   await new Promise((resolve,reject)=>{racer.stdout.once('data',resolve);racer.once('error',reject);});
   const report=run();assert.equal(report.bytes,0);assert.equal(report.partial,true);assert.ok(report.requests[0].omissions.some(row=>row.reason==='profile changed during copy'));assert.equal(existsSync(join(queue,'retained',job,changingRequest,'changing')),false);
   console.log(JSON.stringify({mode,concurrentChangeRefused:true,partialPayloadDeleted:true}));
  }finally{racer.stdin.end();await ended;}
 }else if(mode==='queue'||mode==='green'||mode==='batch'||mode==='refused'||mode==='publish-refused'||mode==='caller'){
  /** @param {string} cwd @param {string[]} args */
  const git=(cwd,args)=>execFileSync('git',['-c','user.name=Retention proof','-c','user.email=proof@example.test',...args],{cwd,encoding:'utf8'}).trim();
  const remote=join(root,'remote.git'),repo=join(root,'repo');mkdirSync(repo);git(root,['init','--quiet','--bare','--initial-branch=main',remote]);git(repo,['init','--quiet','--initial-branch=main']);git(repo,['remote','add','origin',remote]);mkdirSync(join(repo,'.githooks'));
  writeFileSync(join(repo,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.cjs\n');chmodSync(join(repo,'.githooks/pre-push'),0o755);
  writeFileSync(join(repo,'gate.cjs'),`const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');if(fs.readdirSync('.').some(p=>p.startsWith('lane-'))){fs.appendFileSync(${JSON.stringify(join(root,'observed'))},JSON.stringify({sha:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:fs.readdirSync('.').filter(p=>p.startsWith('lane-')).sort()})+'\\n');fs.mkdirSync('tmp/native-writer-drain-ABC123',{recursive:true});fs.writeFileSync('tmp/native-writer-drain-ABC123/writer','original failed-hook marker');fs.mkdirSync('tmp/queue-retain-requests',{recursive:true});fs.writeFileSync('tmp/queue-retain-requests/'+crypto.randomUUID()+'.json',JSON.stringify({schema:'wildshard.native-retain/1',kind:'native-writer-drain',profile:'tmp/native-writer-drain-ABC123'}));${mode==='refused'?"fs.rmSync('tmp/queue-retain-requests',{recursive:true});fs.symlinkSync('native-writer-drain-ABC123','tmp/queue-retain-requests');":''}${mode==='green'||mode==='publish-refused'?'':"throw new Error('exact original cleanup failure');"}}`);
  if(mode==='caller'){
   const callerRoot=process.cwd(),caller=resolvePath('scripts/native-retention-proof.mjs');
   writeFileSync(join(repo,'gate.cjs'),`const fs=require('node:fs'),cp=require('node:child_process');const files=fs.readdirSync('.').filter(p=>p.startsWith('lane-')).sort();if(files.length){fs.appendFileSync(${JSON.stringify(join(root,'observed'))},JSON.stringify({sha:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files})+'\\n');fs.mkdirSync('tmp',{recursive:true});const result=cp.spawnSync(process.execPath,[${JSON.stringify(caller)},'--request-only',${JSON.stringify(`--caller-root=${callerRoot}`)}],{stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1);}`);
  }
  writeFileSync(join(repo,'package.json'),'{"name":"retention-proof","version":"1.0.0","private":true}');writeFileSync(join(repo,'pnpm-workspace.yaml'),'packages: []\n');writeFileSync(join(repo,'.gitignore'),'node_modules/\ntmp/\n');execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,stdio:'pipe'});
  git(repo,['add','.githooks/pre-push','gate.cjs','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','.gitignore']);git(repo,['commit','--quiet','-m','base']);git(repo,['config','core.hooksPath','.githooks']);git(repo,['push','--quiet','origin','main']);const original=git(remote,['rev-parse','main']);if(mode==='publish-refused'){writeFileSync(join(remote,'hooks/pre-receive'),'#!/bin/sh\nexit 1\n');chmodSync(join(remote,'hooks/pre-receive'),0o755);}
  /** @param {string} source @param {boolean} [checkOnly] */
  const enqueue=(source,checkOnly=false)=>JSON.parse(execFileSync(process.execPath,[script,'enqueue',source,`--root=${queue}`,...(checkOnly?['--check-only']:[])],{env:{...process.env,WS_LANE_RECEIPTS:join(root,'receipts')},encoding:'utf8'}));
  /** @param {{id:string,snapshot:string}} item */
  const wait=async item=>{const file=join(dirname(dirname(item.snapshot)),`${item.id}.json`),start=Date.now();while(Date.now()-start<8000){const row=JSON.parse(readFileSync(file,'utf8'));if(['failed','checked','pushed'].includes(row.state)&&!existsSync(item.snapshot))return row;await new Promise(resolve=>{setTimeout(resolve,10);});}throw new Error('Fixture queue did not settle');};
  /** @type {{id:string,snapshot:string,sha:string}[]} */const jobs=[];
  /** @type {ReturnType<typeof spawn>|undefined} */let holder;
  /** @type {Promise<unknown>|undefined} */let ended;
  let actualQueue;
  /** @type {{job:string,checkedSha:string,profile:string,kind:string,bytes:number,payloadSha256:string}|undefined} */let callerEvidence;
  if(mode==='batch'){
   const warm=enqueue(repo,true);assert.equal((await wait(warm)).state,'checked');actualQueue=dirname(dirname(warm.snapshot));
   holder=spawn('python3',[lock,join(actualQueue,'worker.lock'),process.execPath,'-e',"console.log('ready');process.stdin.resume()"],{stdio:['pipe','pipe','pipe']});ended=new Promise(resolve=>{holder?.once('exit',resolve);});await new Promise((resolve,reject)=>{holder?.stdout?.once('data',resolve);holder?.once('error',reject);});
  }
  try{
   for(let i=1;i<=(mode==='batch'?2:1);i++){
    const source=join(root,`source-${i}`);git(root,['clone','--quiet',remote,source]);writeFileSync(join(source,`lane-${i}`),'requested');git(source,['add',`lane-${i}`]);git(source,['commit','--quiet','-m',`request${i}`]);jobs.push(enqueue(source));
   }
  }finally{holder?.stdin?.end();if(ended!==undefined)await ended;}
  for(const item of jobs){const row=await wait(item);assert.equal(row.state,mode==='green'?'pushed':'failed');actualQueue=dirname(dirname(item.snapshot));}
  assert.ok(actualQueue!==undefined);
  if(mode==='green'){assert.equal(existsSync(join(actualQueue,'retained')),false);assert.notEqual(git(remote,['rev-parse','main']),original);}
  else if(mode==='publish-refused'){assert.equal(existsSync(join(actualQueue,'retained')),false,'A green hook with rejected publication must not export expected-control profiles');assert.equal(git(remote,['rev-parse','main']),original);}
  else if(mode==='refused'){assert.equal(existsSync(join(actualQueue,'retained')),false);assert.equal(git(remote,['rev-parse','main']),original);const log=readFileSync(join(actualQueue,'worker.log'),'utf8');assert.match(log,/exact original cleanup failure/u);assert.match(log,/diagnostic retention refused; original failure unchanged/u);}
  else{
   const reportFiles=readdirSync(join(actualQueue,'retained'),{recursive:true,encoding:'utf8'}).filter(name=>/^retention-.*\.json$/u.test(name.split('/').at(-1)??''));assert.ok(reportFiles.length>=jobs.length);
   if(mode==='batch')assert.equal(reportFiles.length,3,'The combined failure and both singleton failures must all survive');
   /** @type {{sha:string,files:string[]}[]} */const gates=readFileSync(join(root,'observed'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
   for(const name of reportFiles){const report=JSON.parse(readFileSync(join(actualQueue,'retained',name),'utf8'));assert.equal(report.partial,false);
   /** @type {Buffer} */
   const payload=readFileSync(join(actualQueue,'retained',report.job,report.requests[0].request.slice(0,-5),mode==='caller'?'locked/marker':'writer'));assert.equal(payload.toString('utf8'),mode==='caller'?'owned refusal':'original failed-hook marker');if(mode==='caller'){assert.equal(report.requests[0].kind,'native-escape');assert.match(report.requests[0].profile,/^tmp\/escape-control-[A-Za-z0-9]{6}$/u);callerEvidence={job:report.job,checkedSha:report.checkedSha,profile:report.requests[0].profile,kind:report.requests[0].kind,bytes:report.bytes,payloadSha256:createHash('sha256').update(payload).digest('hex')};}assert.match(report.checkedSha,/^[a-f0-9]{40}$/u);const gate=gates.find(row=>row.sha===report.checkedSha);assert.ok(gate,'Every retained SHA must name an actual hook invocation');if(mode==='batch')assert.equal(report.job,gate.files.length===2||gate.files[0]==='lane-2'?jobs[1].id:jobs[0].id);}
   if(mode==='batch')assert.deepEqual(gates.map(row=>row.files.length).sort((a,b)=>a-b),[1,1,2]);
   assert.equal(git(remote,['rev-parse','main']),original);assert.match(readFileSync(join(actualQueue,'worker.log'),'utf8'),mode==='caller'?/EACCES/u:/exact original cleanup failure/u);
  }
  console.log(JSON.stringify({mode,callerEvidence,failedHookUnchanged:mode!=='green',snapshotsDeleted:true,retainedAfterCleanup:mode!=='green'&&mode!=='refused'&&mode!=='publish-refused',seconds:(performance.now()-began)/1000}));
 }else throw new Error('Unknown proof mode');
}finally{rmSync(root,{recursive:true,force:true});}
