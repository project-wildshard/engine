import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBrowserAdmissions} from './browser-file-admission.mjs';

function fixture(){
 let acquired=0,released=0;
 const lost=new Promise(_resolve=>{/* No provider loss unless a control injects it. */});
 const admissions=createBrowserAdmissions(()=>{acquired++;return Promise.resolve({proof:{lease:`fixture-${acquired}`,slots:4,capacity:16,queueSeconds:0},pid:undefined,lost,release:()=>{released++;return Promise.resolve();}});});
 return{admissions,counts:()=>({acquired,released})};
}
await test('unreserved physical launches retain independent actual grants',async()=>{
 const f=fixture(),a=await f.admissions.forLaunch(),b=await f.admissions.forLaunch();assert.equal(f.counts().acquired,2);
 await a.release();await b.release();assert.equal(f.counts().released,2);
});
await test('pre-case admission supplies sequential launches without charging twice',async()=>{
 const f=fixture(),file=await f.admissions.holdForFile();assert.equal(file.proof.slots,4);
 for(let count=0;count<3;count++){const launch=await f.admissions.forLaunch();assert.equal(launch.lost,file.lost);await launch.release();await launch.release();assert.equal(f.counts().released,0);}
 await file.release();await file.release();assert.deepEqual(f.counts(),{acquired:1,released:1});
 const next=await f.admissions.holdForFile();await next.release();assert.deepEqual(f.counts(),{acquired:2,released:2});
});
await test('a live browser prevents file teardown and a second physical launch',async()=>{
 const f=fixture(),file=await f.admissions.holdForFile(),launch=await f.admissions.forLaunch();
 await assert.rejects(file.release(),/browser.*close/iu);await assert.rejects(f.admissions.forLaunch(),/already owns/iu);assert.equal(f.counts().released,0);
 await launch.release();await file.release();assert.equal(f.counts().released,1);
});
await test('concurrent reservations refuse and pending admission precedes launch',async()=>{
 /** @type {(()=>void)|undefined} */let finish;
 const f=fixture();const first=await f.admissions.forLaunch();
 const admissions=createBrowserAdmissions(()=>new Promise(resolve=>{finish=()=>{resolve({...first,proof:{lease:'fixture',slots:4,capacity:16,queueSeconds:0},pid:undefined});};}));
 const file=admissions.holdForFile();await assert.rejects(admissions.holdForFile(),/already/iu);let launched=false;
 const pending=admissions.forLaunch().then(value=>{launched=true;return value;});await Promise.resolve();assert.equal(launched,false);
 assert.ok(finish);finish();const grant=await file,launch=await pending;await launch.release();await grant.release();
});
await test('failed acquisition permits a fresh request; failed release permits no new work',async()=>{
 let tries=0;const f=fixture(),actual=await f.admissions.forLaunch(),reason=new Error('provider failed');
 const admissions=createBrowserAdmissions(()=>++tries===1?Promise.reject(reason):Promise.resolve({...actual,proof:{lease:'fixture',slots:4,capacity:16,queueSeconds:0},pid:undefined,release:()=>Promise.reject(reason)}));
 await assert.rejects(admissions.holdForFile(),error=>error===reason);const file=await admissions.holdForFile();
 await assert.rejects(file.release(),error=>error===reason);await assert.rejects(admissions.forLaunch(),/closing/iu);
});
