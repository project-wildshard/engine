import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installBrowserAdmission} from './browser-launch-admission.mjs';

/** @typedef {{options:unknown[],close:(...args:unknown[])=>Promise<unknown>,once:(name:string,handler:()=>void)=>void,emit:(name:string)=>boolean}} FakeHandle */
/** @typedef {Record<'launch'|'launchPersistentContext'|'launchServer',(...args:unknown[])=>Promise<FakeHandle>>} FakeType */
function deferred(){
 /** @type {()=>void} */let complete=()=>{throw new Error('uninitialized deferred');};
 /** @type {Promise<void>} */const promise=new Promise(resolve=>{complete=resolve;});
 return{promise,resolve:()=>{complete();}};
}
/** @returns {FakeHandle} */
function fakeHandle(){const events=new EventTarget();return{options:[],close:()=>Promise.resolve(),once:(name,handler)=>events.addEventListener(name,handler,{once:true}),emit:name=>events.dispatchEvent(new Event(name))};}
/** @returns {Promise<void>} */
const never=()=>new Promise(_resolve=>{/* Kept live until the control injects a loss. */});
function fixture(){
 const admission=deferred(),drain=deferred(),lost=deferred();let acquired=0,launched=0,released=0,closed=0;
 const handle=fakeHandle();handle.close=async(...args)=>{closed++;await drain.promise;return args[0];};
 /** @type {FakeType} */
 const type={launch(...args){return launch(this,args);},launchPersistentContext(...args){return launch(this,args);},launchServer(...args){return launch(this,args);}};
 /** @param {FakeType} receiver @param {unknown[]} args */
 function launch(receiver,args){assert.equal(receiver,type);launched++;handle.options=args;return Promise.resolve(handle);}
 const lease={lost:lost.promise,release:()=>{released++;return Promise.resolve();}};
 return{type,handle,admission,drain,lost,lease,acquire:async()=>{acquired++;await admission.promise;return lease;},counts:()=>({acquired,launched,released,closed})};
}
const methods=/** @type {const} */(['launch','launchPersistentContext','launchServer']);
for(const method of methods)await test(`${method}: admission precedes launch and release follows actual close`,async()=>{
 const f=fixture();installBrowserAdmission(f.type,f.acquire);const options={headless:true,args:['--mute-audio']};
 const started=method==='launchPersistentContext'?f.type[method]('profile',options):f.type[method](options);
 await Promise.resolve();assert.equal(f.counts().launched,0);f.admission.resolve();
 const handle=await started;assert.equal(handle,f.handle);assert.equal(handle.options.at(-1),options);
 const closing=handle.close('result');await Promise.resolve();assert.equal(f.counts().released,0);f.drain.resolve();assert.equal(await closing,'result');
 await handle.close();assert.deepEqual(f.counts(),{acquired:1,launched:1,released:1,closed:1});
});
await test('nested installers do not charge a second slot',async()=>{
 const f=fixture();installBrowserAdmission(f.type,f.acquire);installBrowserAdmission(f.type,()=>{throw new Error('double charge');});
 f.admission.resolve();const handle=await f.type.launch();f.drain.resolve();await handle.close();assert.equal(f.counts().acquired,1);
});
await test('launch rejection returns the unused lease',async()=>{
 let released=0;const reason=new Error('launch failed');const type={launch:()=>Promise.reject(reason)};
 installBrowserAdmission(type,()=>Promise.resolve({lost:never(),release:()=>{released++;return Promise.resolve();}}));
 await assert.rejects(type.launch(),error=>error===reason);assert.equal(released,1);
});
await test('admission rejection starts no browser',async()=>{
 const f=fixture();installBrowserAdmission(f.type,()=>Promise.reject(new Error('admission refused')));
 await assert.rejects(f.type.launch(),/admission refused/);assert.equal(f.counts().launched,0);
});
await test('disconnect and lease loss drain the handle before release',async()=>{
 for(const event of ['disconnected','close','lost']){
  const f=fixture();installBrowserAdmission(f.type,f.acquire);f.admission.resolve();const handle=await f.type.launch();
  if(event==='lost')f.lost.resolve();else handle.emit(event);
  await Promise.resolve();await Promise.resolve();assert.equal(f.counts().released,0);
  f.drain.resolve();await(event==='lost'?assert.rejects(handle.close(),/admission.*lost/u):handle.close());assert.equal(f.counts().released,1);
 }
});
await test('failed drain keeps the lease charged and preserves the close failure',async()=>{
 const f=fixture();const reason=new Error('drain failed');f.handle.close=()=>Promise.reject(reason);
 installBrowserAdmission(f.type,f.acquire);f.admission.resolve();const handle=await f.type.launch();
 await assert.rejects(handle.close(),error=>error===reason);assert.equal(f.counts().released,0);
});
await test('concurrent launches hold independent leases through separate drains',async()=>{
 let acquisitions=0,releases=0;
 /** @type {{handle:FakeHandle,drain:ReturnType<typeof deferred>}[]} */const handles=[];
 const type={launch:()=>{const handle=fakeHandle(),drain=deferred();handle.close=async()=>{await drain.promise;};handles.push({handle,drain});return Promise.resolve(handle);}};
 installBrowserAdmission(type,()=>{acquisitions++;return Promise.resolve({lost:never(),release:()=>{releases++;return Promise.resolve();}});});
 const [a,b]=await Promise.all([type.launch(),type.launch()]);assert.equal(acquisitions,2);assert.notEqual(a,b);
 const first=a.close();handles[0].drain.resolve();await first;assert.equal(releases,1);
 const second=b.close();await Promise.resolve();assert.equal(releases,1);handles[1].drain.resolve();await second;assert.equal(releases,2);
});
await test('a lease already lost starts no browser',async()=>{
 const f=fixture();installBrowserAdmission(f.type,()=>Promise.resolve({lost:Promise.resolve(),release:()=>Promise.resolve()}));
 await assert.rejects(f.type.launch(),/lost/);assert.equal(f.counts().launched,0);
});
await test('loss during pending launch drains the returned browser and refuses it',async()=>{
 const f=fixture(),launch=deferred();f.type.launch=async()=>{await launch.promise;return f.handle;};installBrowserAdmission(f.type,f.acquire);
 f.admission.resolve();const started=f.type.launch();await Promise.resolve();await Promise.resolve();f.lost.resolve();launch.resolve();
 f.drain.resolve();await assert.rejects(started,/lost/);assert.equal(f.counts().released,1);
});
await test('lost admission drains first and then reports failed ownership',async()=>{
 const f=fixture();
 /** @type {unknown[]} */const failures=[];
 installBrowserAdmission(f.type,f.acquire,error=>{failures.push(error);});f.admission.resolve();const handle=await f.type.launch();
 f.lost.resolve();await Promise.resolve();await Promise.resolve();assert.equal(failures.length,0);
 f.drain.resolve();await assert.rejects(handle.close(),/admission.*lost/u);await Promise.resolve();assert.equal(failures.length,1);assert.match(String(failures[0]),/admission.*lost/u);
});
