import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {installMachineBrowserAdmission} from './browser-machine-loader.mjs';

const context={path:'/config/browser-admission.json',uid:501,read:()=>Promise.resolve({bytes:JSON.stringify({version:1,module:'/canonical/browser-policy.mjs'}),uid:501,mode:0o100600,regular:true}),load:()=>Promise.resolve({install:()=>Promise.resolve()})};
await test('absent policy leaves portable authors unchanged',async()=>{
 const absent=Object.assign(new Error('missing'),{code:'ENOENT'});let loads=0;
 const enabled=await installMachineBrowserAdmission({}, {...context,read:()=>Promise.reject(absent),load:()=>{loads++;return Promise.resolve();}});
 assert.equal(enabled,false);assert.equal(loads,0);
});
await test('owned private policy loads the single machine provider exactly once',async()=>{
 const playwright={};let calls=0;
 assert.equal(await installMachineBrowserAdmission(playwright,{...context,load:path=>{assert.equal(path,'file:///canonical/browser-policy.mjs');return Promise.resolve({install:(/** @type {object} */value)=>{assert.equal(value,playwright);calls++;return Promise.resolve();}});}}),true);
 assert.equal(calls,1);
});
for(const change of [{uid:502},{mode:0o100666},{regular:false},{bytes:'{}'},{bytes:'{"version":2,"module":"/canonical/browser-policy.mjs"}'},{bytes:'{"version":1,"module":"relative.mjs"}'},{bytes:'{"version":1,"module":"https://host/policy.mjs"}'},{bytes:'not json'}])await test(`unsafe or malformed policy refuses ${JSON.stringify(change)}`,async()=>{
 const valid=await context.read();let loaded=false;
 await assert.rejects(installMachineBrowserAdmission({},{...context,read:()=>Promise.resolve({...valid,...change}),load:()=>{loaded=true;return Promise.resolve();}}));assert.equal(loaded,false);
});
await test('present unreadable policy and provider failure propagate instead of bypassing admission',async()=>{
 const denied=Object.assign(new Error('denied'),{code:'EACCES'});await assert.rejects(installMachineBrowserAdmission({},{...context,read:()=>Promise.reject(denied)}),error=>error===denied);
 const unavailable=new Error('provider unavailable');await assert.rejects(installMachineBrowserAdmission({},{...context,load:()=>Promise.reject(unavailable)}),error=>error===unavailable);
 await assert.rejects(installMachineBrowserAdmission({},{...context,load:()=>Promise.resolve({})}),/provider/);
});

await test('actual private policy loads; unsafe mode, oversize and symlink refuse',async()=>{
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/browser-policy-proof','browser-policy');mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'owned-')),path=join(directory,'policy.json'),module=join(directory,'provider.mjs');
 try{
  writeFileSync(module,'export function install(value){value.installed=true;}');
  writeFileSync(path,JSON.stringify({version:1,module}),{mode:0o600});
  const playwright={installed:false};assert.equal(await installMachineBrowserAdmission(playwright,{path}),true);assert.equal(playwright.installed,true);
  chmodSync(path,0o666);await assert.rejects(installMachineBrowserAdmission({}, {path}),/private owned/);
  chmodSync(path,0o600);writeFileSync(path,' '.repeat(4097));await assert.rejects(installMachineBrowserAdmission({}, {path}),/size limit/);
  unlinkSync(path);symlinkSync(module,path);await assert.rejects(installMachineBrowserAdmission({}, {path}));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
