import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Scope} from '../../../../shared/engine/app/scope';
import {scopeEnvironment,installScopeEnvironment} from '../../../../shared/engine/app/scopeEnvironment';
import {PresentationState} from './presentation';
import {PresentationLoop} from './presentationLoop';

const frames=new Map<number,FrameRequestCallback>(),owners:Scope[]=[];
const original=scopeEnvironment();let serial=0;
beforeEach(()=>{serial=0;frames.clear();installScopeEnvironment({...original,sharedFrames:false,frame:render=>{const id=++serial;frames.set(id,render);return id;},cancelFrame:id=>{frames.delete(id);}});});
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();installScopeEnvironment(original);});
function fixture(){
  const scope=new Scope('loop-test');owners.push(scope);const view=new PresentationState();
  const draw=vi.fn<(now:number|undefined,forced:boolean)=>void>(),parked=vi.fn<()=>void>();
  const loop=new PresentationLoop(scope,view,{draw,parked});return {scope,view,draw,loop,parked};
}
function frame(){const batch=[...frames.values()];frames.clear();for(const render of batch)render(serial*16);}
test('covered has zero callbacks; play schedules exactly one; cover cancels it',async()=>{
  const f=fixture();expect(frames.size).toBe(0);f.view.setCoverage('play');expect(frames.size).toBe(1);
  for(let n=0;n<20;n++){frame();expect(frames.size).toBe(1);}expect(f.draw).toHaveBeenCalledTimes(20);
  f.view.setCoverage('covered');expect(frames.size).toBe(0);f.loop.primeFrame();await Promise.resolve();expect(frames.size).toBe(0);expect(f.draw).toHaveBeenCalledTimes(20);
  f.view.setCoverage('play');frame();expect(f.draw).toHaveBeenLastCalledWith(expect.any(Number),true);
});
test('explicit loader frames do not start a chain and hidden overrides even explicit work',()=>{
  const f=fixture();f.loop.hiddenFrame();f.loop.hiddenFrame();expect(f.draw).toHaveBeenCalledTimes(2);expect(frames.size).toBe(0);
  f.view.setVisible(false);f.loop.hiddenFrame();expect(f.draw).toHaveBeenCalledTimes(2);expect(frames.size).toBe(0);
});
test('glass gets one requested still then no world requests, returning resumes',async()=>{
  const f=fixture();f.view.setCoverage('play');frame();f.loop.stillFrame();f.view.setCoverage('still');await Promise.resolve();expect(f.draw).toHaveBeenCalledTimes(2);expect(frames.size).toBe(0);
  f.view.setCoverage('play');expect(frames.size).toBe(1);frame();expect(f.draw).toHaveBeenCalledTimes(3);
});
test('wake samples pause changes after layer disposal and coalesces wake requests',async()=>{
  const f=fixture();let entered=false;f.view.bindGate(f.scope,()=>entered);f.view.setCoverage('play');
  f.loop.wake();f.loop.wake();entered=true;await Promise.resolve();expect(frames.size).toBe(1);frame();expect(f.draw).toHaveBeenCalledOnce();
});
test('uncover resumes frames when asynchronous gameplay becomes ready after the UI wake',async()=>{
  const scope=new Scope('crossing-loop');owners.push(scope);const view=new PresentationState();
  let ready=true,drawn=0;
  // The old Game binding cached this asynchronous predicate as coverage.
  view.bindGate(scope,()=>ready);
  const loop=new PresentationLoop(scope,view,{draw:()=>{if(ready)drawn++;},parked:vi.fn<()=>void>()});
  view.setCoverage('play');frame();expect(drawn).toBe(1);
  view.setCoverage('covered');ready=false;expect(frames.size).toBe(0);
  view.setCoverage('play');loop.wake();await Promise.resolve();
  frame();expect(drawn).toBe(1);expect(frames.size).toBe(1);
  // The entered hooks settle later, with no further layer/input event.
  ready=true;frame();expect(drawn).toBe(2);expect(frames.size).toBe(1);
  view.setVisible(false);expect(frames.size).toBe(0);
  view.setVisible(true);frame();expect(drawn).toBe(3);
  view.setCoverage('covered');expect(frames.size).toBe(0);
});
test('a gate closing between frames cancels the chain without drawing',()=>{
  const f=fixture();let ready=true;f.view.bindGate(f.scope,()=>ready);f.view.setCoverage('play');ready=false;frame();expect(f.draw).not.toHaveBeenCalled();expect(frames.size).toBe(0);
});
test('retirement blocks queued wakes, stills and explicit frames',async()=>{
  const f=fixture();f.loop.wake();f.loop.stillFrame();f.scope.dispose();f.loop.hiddenFrame();await Promise.resolve();expect(f.draw).not.toHaveBeenCalled();expect(frames.size).toBe(0);
});


test('a parked clock rebases once on return without resetting the live frame cap',()=>{
  const f=fixture();f.view.setCoverage('play');expect(f.parked).toHaveBeenCalledTimes(1);
  for(let n=0;n<30;n++)frame();expect(f.parked).toHaveBeenCalledTimes(1);
  f.view.setCoverage('covered');expect(f.parked).toHaveBeenCalledTimes(2);
  f.view.setCoverage('play');expect(f.parked).toHaveBeenCalledTimes(3);frame();expect(f.parked).toHaveBeenCalledTimes(3);
});
