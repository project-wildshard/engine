import {expect,test} from 'vitest';
import {TickScheduler} from '../app/scheduler';
import {BodyBandClocks} from './bands';
import {Rng} from '../core/rng';

const actor=(index:number)=>({entityId:`animal:${index}`,position:{x:100,y:0,z:0}});
test('fresh half-body wakes split work without changing decisions or their shared stream',()=>{
 const phased=new TickScheduler(),original=new TickScheduler(),a=Array.from({length:15},(_,i)=>actor(i));
 const plain=Array.from({length:15},()=>({position:{x:100,y:0,z:0}}));
 const random=new Rng(90),before=new Rng(90),counts:number[]=[],oldCounts:number[]=[];
 let bodies=0,thinks=0;
 for(let frame=0;frame<600;frame++){
  phased.beginFrame(1/60);original.beginFrame(1/60);let count=0,oldCount=0;
  for(const body of a){
   // Stable original subjects; only the optional body identity differs.
   const index=a.indexOf(body),prior=plain[index];if(prior===undefined)throw new Error('Missing subject');
   prior.position=body.position;
   const dt=phased.takeBrainDt('ai',body),previous=original.takeBrainDt('ai',prior);
   expect(dt).toBe(previous);if(dt>0){thinks++;expect(random.next()).toBe(before.next());}
   if(phased.bodyDt('ai',body)>0){count++;bodies++;}if(original.bodyDt('ai',prior)>0)oldCount++;
  }
  counts.push(count);oldCounts.push(oldCount);
 }
 expect(thinks).toBe(1500);expect(bodies).toBe(4500);expect(new Set(counts)).toEqual(new Set([7,8]));
 expect(Math.max(...oldCounts)).toBe(15);expect(random.snapshot()).toEqual(before.snapshot());
});
test('zero-time warm-up does not collapse the two fresh body phases',()=>{
 const scheduler=new TickScheduler(),a=Array.from({length:16},(_,i)=>actor(i));
 for(let frame=0;frame<4;frame++){scheduler.beginFrame(0);for(const body of a)expect(scheduler.bodyDt('ai',body)).toBe(0);}
 const counts:number[]=[];
 for(let frame=0;frame<8;frame++){scheduler.beginFrame(1/60);counts.push(a.filter(body=>scheduler.bodyDt('ai',body)>0).length);}
 expect(counts).toEqual(Array.from({length:8},()=>8));
});
test('page and native body clocks replay the same fresh, paused and near phases',()=>{
 const page=new TickScheduler(),native=new BodyBandClocks(),a=Array.from({length:6},(_,i)=>actor(i));
 for(let frame=0;frame<150;frame++){
  const dt=frame<4?0:1/60;page.beginFrame(dt);native.beginTick(dt);
  const distance=frame<45?100:frame<60?300:frame<100?100:20;
  for(const body of a){body.position.x=distance;
   expect(page.takeBrainDt('ai',body)).toBe(native.takeBrainDt(body.entityId,'ai',distance,false));
   expect(page.bodyDt('ai',body)).toBe(native.bodyDt(body.entityId,'ai',distance));
  }
 }
});
test('saved body phases and the rate fingerprint survive exact restore without new fields',()=>{
 const current=new BodyBandClocks(),a=Array.from({length:6},(_,i)=>actor(i)),ids=new Set(a.map(body=>body.entityId));
 for(let frame=0;frame<37;frame++){current.beginTick(1/60);for(const body of a)current.bodyDt(body.entityId,'ai',100);}
 const saved=current.snapshot(),restored=new BodyBandClocks();restored.restore(saved,ids);
 expect(restored.snapshot()).toEqual(saved);expect(new BodyBandClocks().snapshot().rates).toBe(saved.rates);
 expect(Object.keys(saved.rows[0]?.body??{})).toEqual(['elapsed','credit','frame','dt','last','due','tickFrame']);
 for(let frame=0;frame<60;frame++){
  current.beginTick(1/60);restored.beginTick(1/60);
  for(const body of a)expect(restored.bodyDt(body.entityId,'ai',100)).toBe(current.bodyDt(body.entityId,'ai',100));
  expect(restored.snapshot()).toEqual(current.snapshot());
 }
});
