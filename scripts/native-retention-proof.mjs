// Manual actual-caller proof; run through browser-lane.sh, outside hooks.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync, existsSync, statSync, renameSync, symlinkSync, unlinkSync} from 'node:fs';
import {resolve, relative} from 'node:path';

const sourceArg=process.argv.find(value=>value.startsWith('--caller-root='));
const engine=sourceArg===undefined?process.cwd():resolve(sourceArg.slice('--caller-root='.length));
const root=mkdtempSync(resolve('tmp/native-retention-proof-'));
const requestOnly=process.argv.includes('--request-only');
const cwd=requestOnly?process.cwd():root,requests=resolve(cwd,'tmp/queue-retain-requests');
mkdirSync(resolve(cwd,'tmp'),{recursive:true});
const list=()=>{try{return readdirSync(requests);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return[];throw error;}};
const before=new Set(list());
/** @type {string[]} */
const profiles=[];
/** @type {string|undefined} */
let profile;
/** @type {string|undefined} */
let manifest;
let verified=false;
try{
  if(!requestOnly){
    const normal=spawnSync(process.execPath,['--experimental-transform-types',resolve(engine,'test/fixtures/native-browser-escape.ts')],{cwd,encoding:'utf8',timeout:25000});
    assert.equal(normal.status,0,normal.stderr);assert.match(normal.stdout,/original trusted Escape pair preserved/u);
    assert.deepEqual(list().filter(name=>!before.has(name)),[],'Successful native cleanup must not request retention');
  }
  const chrome=resolve(root,'native-refusal.mjs'),receipt=resolve(root,'profile.json');
  writeFileSync(chrome,`#!${process.execPath}\nimport{mkdirSync,writeFileSync,chmodSync}from'node:fs';
const arg=process.argv.find(value=>value.startsWith('--user-data-dir='));if(arg===undefined)throw Error('Missing owned profile');
const profile=arg.slice('--user-data-dir='.length);writeFileSync(${JSON.stringify(receipt)},JSON.stringify(profile));
writeFileSync(profile+'/retained-sentinel','actual native caller bytes');mkdirSync(profile+'/locked');writeFileSync(profile+'/locked/marker','owned refusal');chmodSync(profile+'/locked',0);process.kill(process.pid,'SIGTERM');
`,{mode:0o700});
  const refuse=()=>spawnSync(process.execPath,['--experimental-transform-types',resolve(engine,'test/fixtures/native-browser-escape.ts')],{cwd,encoding:'utf8',timeout:25000,env:{...process.env,CHROME_PATH:chrome}});
  const readProfile=()=>{
    /** @type {unknown} */
    const value=JSON.parse(readFileSync(receipt,'utf8'));
    if(typeof value!=='string'||!/^tmp\/escape-control-[A-Za-z0-9]{6}$/u.test(relative(cwd,value)))throw new Error('Foreign native proof profile');
    profiles.push(value);return value;
  };
  const refused=refuse();
  assert.equal(refused.status,1);assert.match(refused.stderr,/EACCES/u);assert.doesNotMatch(refused.stdout,/original trusted Escape pair preserved/u);
  profile=readProfile();
  // The real caller already refused and retained its profile. Restore only
  // this control's owned mode so export/normal managed cleanup can read it;
  // never retry cleanup or change the original nonzero hook outcome.
  chmodSync(resolve(profile,'locked'),0o700);
  const added=list().filter(name=>!before.has(name));assert.equal(added.length,1);
  const name=added[0];assert.ok(name!==undefined);manifest=resolve(requests,name);
  assert.match(name,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u);
  assert.deepEqual(JSON.parse(readFileSync(manifest,'utf8')),{schema:'wildshard.native-retain/1',kind:'native-escape',profile:relative(cwd,profile)});
  assert.ok(statSync(manifest).size<=4096);assert.equal(statSync(manifest).mode&0o777,0o600);
  assert.equal(readFileSync(resolve(profile,'locked/marker'),'utf8'),'owned refusal');
  if(!requestOnly){
    // Only this isolated control owns this directory. Force a genuine request
    // write refusal; the actual caller must keep its original cleanup error.
    chmodSync(requests,0o500);
    let failedWrite;
    try{failedWrite=refuse();}finally{chmodSync(requests,0o700);}
    const second=readProfile();chmodSync(resolve(second,'locked'),0o700);
    assert.equal(failedWrite.status,1);assert.match(failedWrite.stderr,/Native retained-profile request refused/u);
    assert.ok(failedWrite.stderr.includes(resolve(second,'locked')),'Original cleanup failure must propagate unchanged');
    assert.deepEqual(list().filter(item=>!before.has(item)),added,'A refused write must not emit another request');
    const pinned=resolve(root,'pinned-requests'),foreign=resolve(root,'foreign');mkdirSync(foreign,{mode:0o700});
    renameSync(requests,pinned);symlinkSync(foreign,requests,'dir');
    let linked;
    try{linked=refuse();}finally{unlinkSync(requests);renameSync(pinned,requests);}
    const third=readProfile();chmodSync(resolve(third,'locked'),0o700);
    assert.equal(linked.status,1);assert.match(linked.stderr,/Native retained-profile request refused/u);
    assert.ok(linked.stderr.includes(resolve(third,'locked')));
    assert.deepEqual(readdirSync(foreign),[],'A replaced request directory must receive no file');
  }
  console.log(requestOnly?'EXPECTED native cleanup refusal with manifest':'PASS actual native caller retained original EACCES and exclusive manifest',JSON.stringify({profile:relative(cwd,profile),manifest:relative(cwd,manifest),requestOnly,writeRefusalProved:!requestOnly,symlinkRefusalProved:!requestOnly}));verified=true;
  if(requestOnly){process.stderr.write(refused.stderr);process.exitCode=1;}
}finally{
  for(const owned of profiles)if(existsSync(resolve(owned,'locked')))chmodSync(resolve(owned,'locked'),0o700);
  if(verified)rmSync(root,{recursive:true,force:true});
  else console.error('Owned native retention proof retained',root);
}
