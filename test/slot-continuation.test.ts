import {expect,test} from 'vitest';
import * as v from 'valibot';
import {SlotViewSchema} from '@wildshard/format/encounterRows';
import {Rng} from '../src/shared/engine/core/rng';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {SlotEncounterLaw,type SlotActor} from '../src/shared/game/boss/slotLaw';
import {NALATI_NIGHT as nightInput} from './fixtures/nalati-night';
import {withWeatherWitness} from './fixtures/weatherInlineWitness';

const night=withWeatherWitness(nightInput);
const view=v.parse(SlotViewSchema,night.view);
interface Body extends SlotActor {alive:boolean;hidden:boolean;attackPhase:number;variant:string}
/** Unplayed lifecycle bodies; real chapter damage still belongs to weapons. */
function world(){
  const bodies=new Map<string,Body>(),events:unknown[][]=[],rng=new Rng(65);
  const sites=Array.from({length:12},(_,i)=>({x:i*3,z:i+2,yaw:i*.1,variant:i%2}));
  const law=new SlotEncounterLaw<Body,{hide:()=>void;wedge:(...values:number[])=>void}>(night.slots,view,ReturnProgram.page(night.program),{
    sites,guest:ReturnProgram.page(night.program),ground:(x,z)=>x-z,cosmetic:()=>rng.next(),
    cues:{cue:(id,point,normal)=>{events.push([id,point.toArray(),normal.toArray()]);}},
    wedges:Array.from({length:view.tell.pool},(_,i)=>({hide:()=>{events.push(['hide',i]);},wedge:(...values:number[])=>{events.push(['wedge',i,...values]);}})),
  });
  law.attachActors({factory:{model:()=>undefined},spawn:(_kind,x,z,yaw,variant)=>{
    const a:Body={entityId:`body-${bodies.size}`,position:{x,y:4,z},yaw,variant,alive:true,hidden:false,hp:220,scale:1.18,
      mem:{},herd:-1,yOffset:0,attackPhase:-1};bodies.set(a.entityId,a);return a;
  },retire:a=>{a.hidden=true;events.push(['retire',a.entityId]);}});
  const step=(tick:number):void=>{
    for(const a of bodies.values()){a.attackPhase=tick%12===0?.5:-1;a.mem['rise']=tick%3===0?.5:1;}
    law.update(.05,{kind:Number(tick<45||tick>=70)});
  };
  return {law,bodies,rng,events,step,save:()=>law.snapshot(a=>a.entityId)};
}

test.each(['alive','broken','home'])('slot %s continuation retains partial clocks and exact roster/cue/RNG suffix',mode=>{
  const first=world();first.law.update(.05,{kind:1});first.law.update(.05,{kind:1});
  const body=first.law.awake[0]?.a,actors=night.slots.actors;
  if(body===undefined||actors===undefined)throw new Error('Missing original slot actor');
  if(mode==='broken')body.alive=false;
  if(mode==='home')body.mem[actors.gone]=1;
  first.law.update(.1,{kind:1});first.law.update(.03,{kind:1});
  const saved=first.save(),random=first.rng.snapshot(),second=world();
  for(const [id,a]of first.bodies)second.bodies.set(id,structuredClone(a));second.rng.restore(random);
  second.law.restore(saved,id=>second.bodies.get(id)??null);
  expect(second.save()).toEqual(saved);expect(second.events).toEqual([]);expect(second.rng.snapshot()).toEqual(random);
  first.events.length=0;
  for(let tick=0;tick<100;tick++){
    first.step(tick);second.step(tick);expect(second.save()).toEqual(first.save());
    expect([...second.bodies]).toEqual([...first.bodies]);expect(second.rng.snapshot()).toEqual(first.rng.snapshot());
    expect(second.events).toEqual(first.events);first.events.length=0;second.events.length=0;
  }
});

test('slot restoration rejects foreign recipes, clocks and owners without effects or partial publication',()=>{
  const owner=world();owner.law.wake([0,1]);const saved=owner.save(),random=owner.rng.snapshot(),first=saved.awake[0];
  if(first===undefined)throw new Error('Missing original awake body');owner.events.length=0;
  const find=(id:string):Body|null=>owner.bodies.get(id)??null;
  for(const bad of [
    {...saved,recipe:'foreign'}, {...saved,cycle:{...saved.cycle,elapsed:-1}},
    {...saved,awake:[...saved.awake,first]}, {...saved,awake:[{...first,id:'missing'}]},
    {...saved,awake:[{...first,site:256}]}, {...saved,awake:[{...first,wedge:256}]},
    {...saved,awake:[{...first,law:{...first.law,state:{foreign:1}}}]}, {...saved,retired:[256]},
  ]){expect(()=>owner.law.restore(bad,find)).toThrow();expect(owner.save()).toEqual(saved);expect(owner.events).toEqual([]);expect(owner.rng.snapshot()).toEqual(random);}
  const body=find(first.id);if(body===null)throw new Error('Missing actual body');
  expect(()=>owner.law.restore(saved,()=>body)).toThrow(/Aliased/u);expect(owner.save()).toEqual(saved);
  const detached=owner.save();Reflect.set(detached.cycle.state,'phase',27);expect(owner.save()).toEqual(saved);
});
