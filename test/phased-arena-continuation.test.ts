import {expect,test} from 'vitest';
import {Vector3} from 'three';
import {Rng} from '@wildshard/format/seededRng';
import {parseBossProfile} from '@wildshard/format/bossProfiles';
import {bossFight,type PhasedBossBody} from '../src/server/game/plugin/bossPhase';
import {parse,object,unknown} from 'valibot';
import { liveGoldenKing } from './fixtures/liveNalati';

const king=parse(object({page:object({profile:unknown()})}),liveGoldenKing);

const profile=(()=>{const value=parseBossProfile(king.page.profile);if(value.pattern!=='arena')throw new Error('Missing original fixed arena');return value;})();
const row=profile.fight;

/** Unplayed numeric bodies for kernel continuation controls. Native chapter
 * inputs still have to earn all actual bodies, damage and encounter states. */
class Body implements PhasedBossBody {
  readonly position=new Vector3();readonly lookTarget=new Vector3();readonly mem:Record<string,number>={};
  yaw=0;hp=1000;readonly maxHp=1000;hidden=false;readonly scale=1;lookWeight=0;
  attackT=-1;attackLength=1;speed=0;turn=0;
  readonly id: string;
  constructor(id:string){
    this.id = id;}
  get alive():boolean{return this.hp>0;}
  get attackPhase():number{return this.attackT<0?-1:this.attackT/this.attackLength;}
  startAttack(seconds:number):void{this.attackT=0;this.attackLength=seconds;}
  cancelAttack():void{this.attackT=-1;}
  setMotion(yaw:number,speed:number,turn=1):void{this.yaw=yaw;this.speed=speed;this.turn=turn;}
  place(x:number,z:number,yaw:number):void{this.position.set(x,row.origin.y,z);this.yaw=yaw;}
  headWorld(out:Vector3):Vector3{return out.copy(this.position).add(new Vector3(0,2,0));}
  applyDamage(amount:number):boolean{this.hp=Math.max(0,this.hp-amount);return !this.alive;}
  snapshot(){return {id:this.id,position:this.position.toArray(),look:this.lookTarget.toArray(),mem:{...this.mem},
    yaw:this.yaw,hp:this.hp,hidden:this.hidden,lookWeight:this.lookWeight,attackT:this.attackT,attackLength:this.attackLength,speed:this.speed,turn:this.turn};}
  static restore(saved:ReturnType<Body['snapshot']>):Body {
    const body=new Body(saved.id);body.position.fromArray(saved.position);body.lookTarget.fromArray(saved.look);Object.assign(body.mem,saved.mem);
    body.yaw=saved.yaw;body.hp=saved.hp;body.hidden=saved.hidden;body.lookWeight=saved.lookWeight;
    body.attackT=saved.attackT;body.attackLength=saved.attackLength;body.speed=saved.speed;body.turn=saved.turn;return body;
  }
}
function world(removeRetired=false){
  const bodies=new Map<string,Body>(),rng=new Rng(357),events:unknown[][]=[],player=new Vector3(row.origin.x+4,row.origin.y,row.origin.z+3);
  let nextBody=0;
  const spawn=(x:number,z:number):Body=>{while(bodies.has(`body-${nextBody}`))nextBody++;const body=new Body(`body-${nextBody++}`);body.place(x,z,0);bodies.set(body.id,body);return body;};
  const fight=bossFight<Body>(profile,{
    arena:{floorAt:()=>row.origin.y,pile:(...values)=>{events.push(['pile',...values]);},clear:()=>{events.push(['clear']);},
      drain:(...values)=>{events.push(['drain',...values]);},inArena:()=>true,seal:on=>{events.push(['seal',on]);}},
    body:{spawn,retire:body=>{body.hidden=true;if(removeRetired)bodies.delete(body.id);events.push(['retire',body.id]);},bind:()=>{events.push(['bind']);},
      ready:(body,floor)=>{body.position.y=floor;events.push(['ready',body.id,floor]);}},
    spawnAdd:(_index,x,z,yaw)=>{const body=spawn(x,z);body.yaw=yaw;return body;},player:{position:player,dash:(...values)=>{events.push(['dash',...values]);}},
    hurt:(...values)=>{events.push(['hurt',...values]);},cut:(_index,_body,hit)=>{hit();return true;},hazard:(_id,_from,hit)=>{hit();},
    rng:()=>rng.next(),feed:line=>{events.push(['feed',line]);},views:Object.fromEntries(row.views.map(name=>[name,(...values:number[])=>{events.push([name,...values]);}])),
    rewardPoint:()=>new Vector3(),respawnPoint:()=>({pos:new Vector3(),yaw:0}),
  });
  const step=(tick:number):void=>{
    const boss=fight.body();if(boss===null)throw new Error('Missing actual kernel body');
    for(const body of bodies.values()){
      if(body.attackT>=0)body.attackT+=1/60;
      body.position.x+=Math.sin(body.yaw)*body.speed/60;body.position.z+=Math.cos(body.yaw)*body.speed/60;
    }
    if(tick%6===0)fight.brain.think(boss,{dt:.1,player});
    fight.brain.act(boss,{player});fight.script.update(1/60,tick/60,true);
    if(tick%71===0)boss.applyDamage(fight.brain.damageMul(boss,boss.position.clone())*.25);
  };
  return {fight,bodies,rng,events,step,allocator:()=>nextBody,restoreAllocator:(next:number)=>{nextBody=next;},save:()=>fight.continuation(body=>body.id)};
}

test.each([0,1,2])('fixed arena phase %i restores every clock, body and add before an exact suffix',phase=>{
  const first=world();first.fight.script.reset(phase);first.fight.script.begin(phase);
  for(let tick=0;tick<240;tick++)first.step(tick);
  const saved=first.save(),actors=[...first.bodies.values()].map(body=>body.snapshot()),random=first.rng.snapshot();
  if(phase===1)expect(saved.adds.length).toBeGreaterThan(0);
  const second=world();for(const actor of actors)second.bodies.set(actor.id,Body.restore(actor));second.restoreAllocator(first.allocator());second.rng.restore(random);
  second.fight.restore(saved,id=>second.bodies.get(id)??null);
  expect(second.save()).toEqual(saved);expect(second.rng.snapshot()).toEqual(random);expect(second.events).toEqual([['bind']]);
  first.events.length=0;second.events.length=0;
  for(let tick=240;tick<960;tick++){
    first.step(tick);second.step(tick);expect(second.save()).toEqual(first.save());
    expect([...second.bodies.values()].map(body=>body.snapshot())).toEqual([...first.bodies.values()].map(body=>body.snapshot()));
    expect(second.rng.snapshot()).toEqual(first.rng.snapshot());expect(second.events).toEqual(first.events);
    first.events.length=0;second.events.length=0;
  }
});

test('fixed arena restore validates the whole continuation before adopting bodies or mutating state',()=>{
  const owner=world();owner.fight.script.reset(1);owner.fight.script.begin(1);
  const saved=owner.save(),random=owner.rng.snapshot();owner.events.length=0;
  const find=(id:string):Body|null=>owner.bodies.get(id)??null;
  for(const malformed of [
    {...saved,state:{...saved.state,mode:'foreign'}}, {...saved,state:{...saved.state,phase:row.phases.length}},
    {...saved,state:{...saved.state,rings:[]}}, {...saved,state:{...saved.state,glow:Number.NaN}},
    {...saved,king:'missing'}, {...saved,adds:[...saved.adds,...saved.adds]},
    {...saved,adds:saved.adds.map(add=>({...add,niche:row.adds.spots.length}))},
  ]){expect(()=>owner.fight.restore(malformed,find)).toThrow();expect(owner.save()).toEqual(saved);expect(owner.rng.snapshot()).toEqual(random);expect(owner.events).toEqual([]);}
  const body=owner.fight.body();if(body===null)throw new Error('Missing original body');
  expect(()=>owner.fight.restore(saved,()=>body)).toThrow(/Aliased/u);expect(owner.save()).toEqual(saved);
  const detached=owner.save();detached.state.rings.length=0;expect(owner.save()).toEqual(saved);
});

test('a crumbled King stays retired after restore and the next reset allocates new adds',()=>{
  const first=world();first.fight.script.reset(2);first.fight.script.begin(2);first.fight.script.victory();
  const until=Math.ceil((row.victory.crumble+.2)*60);
  for(let tick=0;tick<until;tick++)first.step(tick);
  const saved=first.save(),actors=[...first.bodies.values()].map(actor=>actor.snapshot()),second=world();
  for(const actor of actors){const restored=Body.restore(actor);restored.hidden=false;second.bodies.set(actor.id,restored);}
  second.restoreAllocator(first.allocator());second.rng.restore(first.rng.snapshot());second.fight.restore(saved,id=>second.bodies.get(id)??null);
  expect(second.fight.body()?.hidden).toBe(true);first.events.length=0;second.events.length=0;
  for(let tick=until;tick<until+5;tick++){
    first.step(tick);second.step(tick);expect(second.save()).toEqual(first.save());expect(second.events).toEqual(first.events);
    expect([...second.bodies.values()].map(actor=>actor.snapshot())).toEqual([...first.bodies.values()].map(actor=>actor.snapshot()));
  }
  expect(second.events.some(event=>event[0]==='victory.heap'||event[0]==='retire')).toBe(false);
  first.events.length=0;second.events.length=0;
  first.fight.script.reset(1);second.fight.script.reset(1);first.fight.script.begin(1);second.fight.script.begin(1);
  expect(second.save()).toEqual(first.save());expect(second.events).toEqual(first.events);
  expect([...second.bodies.values()].map(actor=>actor.snapshot())).toEqual([...first.bodies.values()].map(actor=>actor.snapshot()));
});

test('an unopened fixed arena restores quietly without manufacturing a body',()=>{
  const first=world(),second=world(),saved=first.save(),random=second.rng.snapshot();
  expect(saved.king).toBeNull();expect(saved.adds).toEqual([]);
  second.fight.restore(saved,()=>{throw new Error('An unopened room must not resolve a body');});
  expect(second.save()).toEqual(saved);expect(second.bodies.size).toBe(0);
  expect(second.events).toEqual([]);expect(second.rng.snapshot()).toEqual(random);
});

test.each([false,true])('native add retirement continues exactly with the shield %s cleared',cleared=>{
  const first=world(true);first.fight.script.reset(1);first.fight.script.begin(1);
  const raised=first.save().adds;expect(raised.length).toBeGreaterThan(1);
  for(const entry of cleared?raised:raised.slice(0,1)){
    const actor=first.bodies.get(entry.id);if(actor===undefined)throw new Error('Missing raised add');actor.applyDamage(actor.maxHp);
  }
  const at=Math.floor(row.adds.retireAfter*60)-2;
  for(let tick=0;tick<at;tick++)first.step(tick);
  const saved=first.save(),second=world(true);for(const actor of first.bodies.values())second.bodies.set(actor.id,Body.restore(actor.snapshot()));
  second.restoreAllocator(first.allocator());second.rng.restore(first.rng.snapshot());second.fight.restore(saved,id=>second.bodies.get(id)??null);expect(second.save()).toEqual(saved);
  first.events.length=0;second.events.length=0;
  for(let tick=at;tick<at+6;tick++){
    first.step(tick);second.step(tick);expect(second.save()).toEqual(first.save());expect(second.events).toEqual(first.events);
    expect([...second.bodies.values()].map(actor=>actor.snapshot())).toEqual([...first.bodies.values()].map(actor=>actor.snapshot()));
    first.events.length=0;second.events.length=0;
  }
  const retired=raised[0];if(retired===undefined)throw new Error('Missing retired add');
  expect(first.bodies.has(retired.id)).toBe(false);expect(first.save().adds.some(entry=>entry.id===retired.id)).toBe(false);
  expect(first.save().adds.length).toBe(cleared?0:raised.length-1);
  const third=world(true);for(const actor of first.bodies.values())third.bodies.set(actor.id,Body.restore(actor.snapshot()));
  third.restoreAllocator(first.allocator());third.rng.restore(first.rng.snapshot());third.fight.restore(first.save(),id=>third.bodies.get(id)??null);expect(third.save()).toEqual(first.save());
  third.events.length=0;
  for(let tick=at+6;tick<at+11;tick++){
    first.step(tick);third.step(tick);expect(third.save()).toEqual(first.save());expect(third.events).toEqual(first.events);
    first.events.length=0;third.events.length=0;
  }
  first.fight.script.reset(1);third.fight.script.reset(1);first.fight.script.begin(1);third.fight.script.begin(1);
  expect(third.save()).toEqual(first.save());expect(third.events).toEqual(first.events);
  expect([...third.bodies.values()].map(actor=>actor.snapshot())).toEqual([...first.bodies.values()].map(actor=>actor.snapshot()));
});
