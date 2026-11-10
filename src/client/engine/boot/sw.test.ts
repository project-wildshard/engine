// @vitest-environment happy-dom
import {afterEach,expect,test,vi} from 'vitest';

function buildPort(value:unknown):value is {postMessage:(message:unknown)=>void}{
  return typeof value==='object'&&value!==null&&'postMessage' in value&&typeof value.postMessage==='function';
}
class WorkerHandle extends EventTarget implements ServiceWorker {
  onerror:ServiceWorker['onerror']=null;
  onstatechange:ServiceWorker['onstatechange']=null;
  readonly scriptURL='https://example.com/sw.js';
  state:ServiceWorkerState='installed';
  readonly messages:unknown[]=[];
  refuse=false;
  build:string|undefined='after-build-stamp';
  precached=true;
  postMessage(message:unknown,transfer?:Transferable[]|StructuredSerializeOptions):void{
    if(this.refuse)throw new Error('Worker retired');this.messages.push(message);
    const port=Array.isArray(transfer)?transfer[0]:undefined;
    if(buildPort(port)&&this.build!==undefined){port.postMessage({type:'VERSION',build:this.build,ok:this.precached});}
  }
}

afterEach(async()=>{
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  Reflect.deleteProperty(window,'__ws_sw');
  vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();
});

test('adoption skips stale workers, fences its controller and retires unavailable navigation callbacks',async()=>{
  vi.useFakeTimers();vi.stubGlobal('__BUILD_ID__','before-build');
  vi.stubGlobal('fetch',()=>Promise.resolve(Response.json({build:'after-build'})));
  const reload=vi.fn<()=>void>(),replace=vi.fn<(url:string)=>void>();
  vi.stubGlobal('location',Object.assign(new URL('https://example.com/?sw=1'),{reload,replace}));
  const original=new WorkerHandle();original.state='activated';
  const installing=new WorkerHandle();installing.state='installing';installing.build='before-build-stamp';
  const registration:EventTarget&{waiting:ServiceWorker|null;installing:ServiceWorker|null;update:()=>Promise<void>}=Object.assign(new EventTarget(),{waiting:null,installing,update:()=>Promise.resolve()});
  const container=Object.assign(new EventTarget(),{controller:original,getRegistration:()=>Promise.resolve(registration),register:()=>Promise.resolve(registration)});
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:container});
  const {wsSw,swAdopt,refreshWorkerForChunkRecovery}=await import('./sw');await wsSw.ready;
  const initial=vi.getTimerCount(),originalMessages=[...original.messages];
  await swAdopt();expect(vi.getTimerCount()).toBe(initial);
  for(const state of ['installing','activated','redundant'] as const){
    const stale=new WorkerHandle();stale.state=state;wsSw.waiting=registration.waiting=stale;
    await swAdopt();expect(stale.messages).toEqual([]);expect(vi.getTimerCount()).toBe(initial);
  }
  wsSw.waiting=registration.waiting=original;await swAdopt();expect(original.messages).toEqual(originalMessages);
  // Discovery can be blocked or stale; a tap must read the registration itself.
  const announced=new WorkerHandle();wsSw.waiting=null;registration.waiting=announced;
  const adoption=swAdopt('/resume','fixture');
  await vi.waitFor(()=>{expect(announced.messages).toContainEqual({type:'SKIP_WAITING'});});
  container.controller=new WorkerHandle();container.dispatchEvent(new Event('controllerchange'));
  expect(replace).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
  container.controller=announced;container.dispatchEvent(new Event('controllerchange'));
  await vi.advanceTimersByTimeAsync(0);expect(replace).not.toHaveBeenCalled();
  announced.state='activating';announced.dispatchEvent(new Event('statechange'));container.dispatchEvent(new Event('controllerchange'));
  await vi.advanceTimersByTimeAsync(0);expect(replace).not.toHaveBeenCalled();
  announced.state='activated';announced.dispatchEvent(new Event('statechange'));await adoption;
  // RL3: the page leaves one painted frame later (leaveAfterPaint), never in the turn the hand-over lands in
  expect(replace).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(100);
  expect(replace).toHaveBeenCalledExactlyOnceWith('/resume');
  // DL1: an update installs shell-only; one whose code cannot be precached is never activated.
  const unheld=new WorkerHandle();unheld.precached=false;wsSw.waiting=registration.waiting=unheld;
  expect(await swAdopt('/unheld')).toBe(false);expect(unheld.messages).toEqual([{type:'BUILD'},{type:'PRECACHE'}]);
  expect(replace).toHaveBeenCalledOnce();
  const boundary=new WorkerHandle();wsSw.waiting=registration.waiting=boundary;
  const boundaryAttempt=swAdopt('/boundary');await vi.waitFor(()=>{expect(boundary.messages).toContainEqual({type:'SKIP_WAITING'});});
  expect(boundary.messages).toEqual([{type:'BUILD'},{type:'PRECACHE'},{type:'SKIP_WAITING'}]);
  let boundaryFinished = false;
  void boundaryAttempt.then(() => { boundaryFinished = true; return undefined; });
  await vi.advanceTimersByTimeAsync(180_000); expect(boundaryFinished).toBe(false);
  boundary.state='redundant'; boundary.dispatchEvent(new Event('statechange')); expect(await boundaryAttempt).toBe(false);
  container.controller=boundary;container.dispatchEvent(new Event('controllerchange'));
  expect(replace).toHaveBeenCalledTimes(1);
  const claimed=new WorkerHandle();wsSw.waiting=registration.waiting=claimed;const claim=swAdopt('/claimed');await vi.waitFor(()=>{expect(claimed.messages).toContainEqual({type:'SKIP_WAITING'});});
  container.controller=claimed;container.dispatchEvent(new Event('controllerchange'));
  claimed.state='activated';claimed.dispatchEvent(new Event('statechange'));
  expect(await claim).toBe(true);expect(wsSw.waiting).toBeNull();await vi.advanceTimersByTimeAsync(100);
  expect(replace).toHaveBeenLastCalledWith('/claimed');
  expect(replace).toHaveBeenCalledTimes(2);
  const expired=new WorkerHandle();wsSw.waiting=registration.waiting=expired;
  const pending=swAdopt('/late');await vi.advanceTimersByTimeAsync(180_000);
  expect(replace).toHaveBeenCalledTimes(2);
  expired.state='redundant';expired.dispatchEvent(new Event('statechange'));await pending;
  container.controller=expired;container.dispatchEvent(new Event('controllerchange'));
  expect(replace).toHaveBeenCalledTimes(2);
  const retired=new WorkerHandle();wsSw.waiting=registration.waiting=retired;
  const refused=swAdopt('/retired');await vi.waitFor(()=>{expect(retired.messages).toContainEqual({type:'SKIP_WAITING'});});retired.state='redundant';retired.dispatchEvent(new Event('statechange'));await refused;
  await vi.advanceTimersByTimeAsync(2500);
  expect(replace).toHaveBeenCalledTimes(2);expect(reload).not.toHaveBeenCalled();
  const unavailable=new WorkerHandle();unavailable.refuse=true;wsSw.waiting=registration.waiting=unavailable;
  await swAdopt('/unavailable');expect(vi.getTimerCount()).toBe(initial);
  const nextDocument=new WorkerHandle();wsSw.waiting=registration.waiting=nextDocument;
  const nextAdoption=swAdopt('/title','next document');await vi.waitFor(()=>{expect(nextDocument.messages).toContainEqual({type:'SKIP_WAITING'});});
  nextDocument.state='activated';nextDocument.dispatchEvent(new Event('statechange'));
  expect(await nextAdoption).toBe(true);await vi.advanceTimersByTimeAsync(100);expect(replace).toHaveBeenLastCalledWith('/title');
  expect(container.controller).not.toBe(nextDocument);
  container.controller.build='old-build-stamp';
  const recovered=new WorkerHandle();recovered.build='new-build-stamp';
  Object.assign(container,{getRegistration:()=>Promise.resolve(Object.assign(new EventTarget(),{
    waiting:recovered,installing:null,update:()=>Promise.resolve(),
  }))});
  const recovery=refreshWorkerForChunkRecovery('new-build');
  await vi.waitFor(()=>{expect(recovered.messages).toContainEqual({type:'SKIP_WAITING'});});
  recovered.state='activated';recovered.dispatchEvent(new Event('statechange'));
  expect(await recovery).toBe(true);expect(container.controller).not.toBe(recovered);
  installing.state='installed';installing.dispatchEvent(new Event('statechange'));
  await vi.waitFor(()=>{expect(vi.getTimerCount()).toBe(initial);});
  expect(installing.messages).toEqual([{type:'BUILD'}]);
  document.dispatchEvent(new Event('ws:ready'));
  expect(installing.messages).toEqual([{type:'BUILD'}]);
  expect(expired.messages).not.toContainEqual({type:'WARM_CODE'});
  document.dispatchEvent(new Event('ws:control-ready'));
  expect(expired.messages).not.toContainEqual({type:'WARM_CODE'});
  expect(expired.messages).not.toContainEqual({type:'GC'});
  expect(installing.messages).toEqual([{type:'BUILD'}]);
  window.dispatchEvent(new Event('pagehide'));
  expect(installing.messages).toEqual([{type:'BUILD'}]);
  const active=new WorkerHandle();active.state='activated';container.controller=active;
  active.build='held-build';
  expect(await wsSw.version()).toMatchObject({type:'VERSION',build:'held-build'});
  active.build=undefined;
  let replied=false;
  const reply=wsSw.version().then(value=>{replied=true;return value;});
  await vi.advanceTimersByTimeAsync(180_000);expect(replied).toBe(false);
  active.state='redundant';active.dispatchEvent(new Event('statechange'));
  expect(await reply).toBeNull();expect(vi.getTimerCount()).toBe(initial);
});
