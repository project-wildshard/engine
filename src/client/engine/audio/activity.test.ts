import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Scope} from '../../../shared/engine/app/scope';
import {PresentationState} from '../app/view/presentation';
import {AudioActivity} from './activity';
import {audioInterval,audioTimeout,audioIdle} from './activityTimers';

class Context extends EventTarget {
  state:AudioContextState='suspended';currentTime=0;resumes=0;suspends=0;
  resume():Promise<void>{this.resumes++;this.set('running');return Promise.resolve();}
  suspend():Promise<void>{this.suspends++;this.set('suspended');return Promise.resolve();}
  set(state:AudioContextState):void{this.state=state;this.dispatchEvent(new Event('statechange'));}
}
const owners:Scope[]=[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);});
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();vi.useRealTimers();});
function fixture(){const scope=new Scope('audio-activity');owners.push(scope);const view=new PresentationState();view.bindGate(scope,()=>true);view.setCoverage('play');const policy=new AudioActivity(scope,view,()=>Date.now()),context=new Context();policy.attach(context);return {scope,view,policy,context};}
const settle=async():Promise<void>=>{await Promise.resolve();await Promise.resolve();};

test('hardware suspends immediately hidden and resumes the same context in place',async()=>{
  const f=fixture();f.context.currentTime=12.5;f.policy.resume();await settle();expect(f.context.resumes).toBe(1);
  f.view.setVisible(false);expect(f.context.suspends).toBe(1);await settle();expect(f.context.state).toBe('suspended');expect(vi.getTimerCount()).toBe(0);
  f.policy.resume();await settle();expect(f.context.resumes).toBe(1);f.view.setVisible(true);await settle();expect(f.context.resumes).toBe(2);expect(f.context.currentTime).toBe(12.5);
});
test('covered/still share one five second grace and returning to play resumes',async()=>{
  const f=fixture();f.policy.resume();await settle();f.view.setCoverage('covered');vi.advanceTimersByTime(3000);f.view.setCoverage('still');vi.advanceTimersByTime(1999);expect(f.context.state).toBe('running');vi.advanceTimersByTime(1);await settle();expect(f.context.state).toBe('suspended');
  f.view.setCoverage('play');await settle();expect(f.context.state).toBe('running');
});
test('showing a long-covered hidden page never briefly resumes its audio',async()=>{
  const f=fixture();f.policy.resume();await settle();f.view.setVisible(false);await settle();f.view.setCoverage('still');vi.advanceTimersByTime(9000);f.view.setVisible(true);await settle();expect(f.context.resumes).toBe(1);expect(f.context.state).toBe('suspended');expect(vi.getTimerCount()).toBe(0);
});
test('no hardware means no grace timer or resume work',()=>{
  const scope=new Scope('no-audio');owners.push(scope);const view=new PresentationState();new AudioActivity(scope,view,()=>Date.now());expect(vi.getTimerCount()).toBe(0);view.setVisible(false);expect(vi.getTimerCount()).toBe(0);
});
test('a denied resume waits for a new gesture rather than spinning',async()=>{
  const f=fixture();const resume=vi.spyOn(f.context,'resume').mockRejectedValueOnce(new Error('gesture required'));
  f.policy.resume();await settle();expect(resume).toHaveBeenCalledOnce();vi.advanceTimersByTime(10000);await settle();expect(resume).toHaveBeenCalledOnce();f.policy.resume();await settle();expect(resume).toHaveBeenCalledTimes(2);
});
test('an unresolved resume cannot override a newer hide',async()=>{
  const f=fixture();let complete:()=>void=()=>undefined;
  vi.spyOn(f.context,'resume').mockImplementationOnce(()=>new Promise<void>(resolve=>{complete=()=>{f.context.set('running');resolve();};}));
  f.policy.resume();f.view.setVisible(false);await settle();complete();await settle();expect(f.context.state).toBe('suspended');expect(f.context.suspends).toBe(2);
});
test('retired owners never resume on show',async()=>{
  const f=fixture();f.policy.resume();await settle();f.view.setVisible(false);await settle();f.scope.dispose();f.view.setVisible(true);await settle();expect(f.context.resumes).toBe(1);
});
test('music/AAC pumps stop on suspension and continue without restarting their source',()=>{
  const f=fixture();f.context.set('running');const pump=vi.fn<()=>void>();audioInterval(f.scope,f.context,50,pump);expect(pump).toHaveBeenCalledOnce();vi.advanceTimersByTime(150);expect(pump).toHaveBeenCalledTimes(4);
  f.context.set('suspended');expect(vi.getTimerCount()).toBe(0);vi.advanceTimersByTime(10000);expect(pump).toHaveBeenCalledTimes(4);f.context.set('running');vi.advanceTimersByTime(50);expect(pump).toHaveBeenCalledTimes(6);
});
test('a fade deadline follows the suspended audio clock, not elapsed page time',()=>{
  const f=fixture();f.context.set('running');const ended=vi.fn<()=>void>();audioTimeout(f.scope,f.context,1000,ended);f.context.currentTime=.25;vi.advanceTimersByTime(250);f.context.set('suspended');vi.advanceTimersByTime(10000);expect(ended).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  f.context.set('running');f.context.currentTime=1;vi.advanceTimersByTime(750);expect(ended).toHaveBeenCalledOnce();
});

test('replacing a context isolates a late resume completion and removes old listeners',async()=>{
  const f=fixture();let finish:()=>void=()=>undefined;
  vi.spyOn(f.context,'resume').mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=()=>{f.context.set('running');resolve();};}));
  f.policy.resume();const next=new Context();f.policy.attach(next);f.view.setVisible(false);finish();await settle();expect(next.resumes).toBe(0);expect(next.state).toBe('suspended');
});


test('idle PCM warm-up cancels on suspend and ignores a late delivery after show',()=>{
  const f=fixture();f.context.set('running');let serial=0;
  const pending=new Map<number,()=>void>(),warm=vi.fn<()=>void>();
  audioIdle(f.scope,f.context,{request:run=>{const id=++serial;pending.set(id,run);return id;},cancel:id=>{pending.delete(id);}},warm);
  const raced=pending.get(1);expect(pending.size).toBe(1);f.context.set('suspended');expect(pending.size).toBe(0);f.context.set('running');raced?.();expect(warm).not.toHaveBeenCalled();pending.get(2)?.();expect(warm).toHaveBeenCalledOnce();expect(f.scope.census.listeners).toBe(1);
});
// QA-FEEDBACK-2026-11-24 row 17 (Jake, ~13:25 Cancún: "if the bag menu is open too long the music stops"): the Bag is the game
// menu (Menu.ts, an opaque gameMenu layer), so the page read covered and the five second grace suspended the audio 5 s in
test('a game menu over play (the Bag) keeps the audio on however long it is open; leaving it for another cover starts the grace',async()=>{
  const f=fixture();f.policy.resume();await settle();
  f.view.setMenuAudible(true);f.view.setCoverage('covered');vi.advanceTimersByTime(10*60_000);await settle();
  expect(f.context.state,'ten minutes in the Bag').toBe('running');expect(f.context.suspends).toBe(0);
  f.view.setMenuAudible(false);vi.advanceTimersByTime(4999);await settle();expect(f.context.state).toBe('running');
  vi.advanceTimersByTime(1);await settle();expect(f.context.state).toBe('suspended');
  f.view.setMenuAudible(true);await settle();expect(f.context.state,'back in a game menu').toBe('running');
  f.view.setVisible(false);await settle();expect(f.context.state,'a hidden page is silent even with the Bag open').toBe('suspended');
});
