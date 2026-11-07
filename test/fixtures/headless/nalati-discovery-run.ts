// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof checks real arrival and independent replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the original native physics bytes.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {beginProductSession} from './productSession';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-world-verbs';
import {ChapterViewSchema} from '@wildshard/format/questPageComposition';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import type {HeadlessTapeObservation} from '../../../src/shared/host/headlessTape';
import {PhysicsRouteCursor} from '../../../src/shared/host/headlessJourney';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const session=await beginProductSession('nalati-grasslands','nalati-world');
let first:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
let stopReplay:(()=>Promise<void>)|undefined;
try{
  const product=session.product,shard=product.shardfile;
  const rows=v.parse(ChapterViewSchema,await product.json('quests/content.json')).places;
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  first=await createNativeProofResident({shard,assets:session.assets,rapier,product},prepareHeadlessRuntime);
  const active=first,{host}=active,frames:HeadlessCommand[][]=[];
  const replay=await session.ready(),recordStarted=performance.now(),replayStarted=performance.now();
  let alignmentTicks=0;
  const owner=host.adapters.get('nalati.world');assert.ok(owner);
  interface Mark {tick:number;position:number[];flags:string[];state:string}
  const marks:Mark[]=[];
  let end:HeadlessTapeObservation|undefined,replayed=0,maxPartMs=0,partCount=0,offset=0,backpressureMs=0;
  const pipeline=checkedReplayPipeline<{chunk:HeadlessCommand[][];expected:Mark;index:number}>(async({chunk,expected,index})=>{
    const started=performance.now(),part=await replay.verbTapePart({version:1,observe:['nalati.world'],segments:[{
      id:`discovery-part-${index}`,ticks:chunk.length,commands:[],frames:chunk,
    }]});
    const elapsed=performance.now()-started;maxPartMs=Math.max(maxPartMs,elapsed);partCount++;
    end=part.report.observations.at(-1);assert.ok(end);
    assert.equal(part.report.ticks,chunk.length);replayed+=part.report.ticks;
    assert.equal(part.commit.tick,expected.tick,'only a complete native checkpoint advances the tape');
    assert.equal(end.tick,expected.tick);assert.deepEqual(end.position,expected.position);assert.deepEqual(end.flags,expected.flags);
    const state=end.adapters.find(row=>row.id==='nalati.world');assert.ok(state);
    assert.equal(state.state,expected.state,'each bounded request retains exact native motor, water and discovery state');
    console.info(JSON.stringify({phase:'replay-part',part:partCount,tick:part.commit.tick,milliseconds:elapsed}));
  });
  stopReplay=pipeline.stop;
  const mark=async():Promise<void>=>{
    if(marks.at(-1)?.tick===frames.length)return;
    assert.equal(host.adapters.get('nalati.world'),owner,'the recorder retains its actual observation owner');
    const state=owner.snapshot();if(typeof state!=='string')throw new Error('Discovery owner requires its actual JSON wire');
    const expected={tick:frames.length,position:leadPlayer(host).position.toArray(),flags:[...host.flags.all],state};
    const chunk=frames.slice(offset);assert.ok(chunk.length>0&&chunk.length<=512);
    assert.equal(expected.tick,offset+chunk.length,'every recorded boundary is consumed once, in order');
    const index=marks.length;marks.push(expected);
    // The preceding checked request must settle before this one is offered.
    // After offer returns, the worker runs this part beside the next capture.
    const started=performance.now();await pipeline.offer({chunk,expected,index});
    backpressureMs+=performance.now()-started;offset=frames.length;
  };
  const arrived=new Map<string,{tick:number;position:number[]}>(),notices=new Map<string,number>();
  const step=async(commands:readonly HeadlessCommand[]):Promise<void>=>{
    pipeline.check();
    assert.ok(frames.length<60_000,'outdoor discoveries keep the original finite native tape allowance');
    const input=commands.map(command=>{
      if(command.kind!=='player'||command.commandVersion===1)return command;
      const c=Math.cos(command.yaw),s=Math.sin(command.yaw),clamp=(n:number)=>Math.max(-1,Math.min(1,n));
      return {...command,commandVersion:1 as const,steer:{keyX:0,keyY:0,
        stickX:clamp(command.moveX*c-command.moveZ*s),stickY:clamp(-command.moveX*s-command.moveZ*c)}};
    });
    const prior=host.state.tick;frames.push(structuredClone(input));active.step(input);
    assert.equal(host.state.tick,prior+1,'each recorded input commits exactly one native tick');
    assert.equal(leadPlayer(host).health.alive,true,'discovery input must keep the real traveller alive');
    const p=leadPlayer(host).position;
    assert.ok([p.x,p.y,p.z].every(Number.isFinite),'native feet stay finite');
    for(const row of rows)if(host.flags.has(`seen:${row.id}`)&&!arrived.has(row.id)){
      assert.ok((p.x-row.x)**2+(p.z-row.z)**2<row.r**2,`only actual arrival discovers ${row.id}`);
      arrived.set(row.id,{tick:frames.length,position:p.toArray()});
    }
    for(const effect of active.effects){
      assert.equal(effect.kind,'hint','discovery cannot grant quest facts, inventory or damage');
      if(effect.kind==='hint')notices.set(effect.text,(notices.get(effect.text)??0)+1);
    }
    if(frames.length%512===0)await mark();
  };
  await step([]);
  assert.equal(arrived.size,0,'the entry cannot pre-discover distant places');
  // First walk the real camp road, then use the player's own hover toggle.
  // The board's motor still resolves every wall, trunk and jump. Discovery
  // requires actual feet inside each circle regardless of locomotion mode.
  const camp=new PhysicsRouteCursor([{x:0,z:216},{x:20,z:216},{x:40,z:218},{x:60,z:214}],{once:true});
  let campEffects=0;
  for(let tick=0;tick<3600;tick++){
    const p=leadPlayer(host).position,command=camp.command([p.x,p.y,p.z],tick);
    if(camp.complete)break;
    assert.equal(camp.stuck.length,0,'the unchanged native camp route must progress');
    await step([command]);campEffects+=active.effects.length;assert.ok(campEffects<=1024,'the original route effect allowance stays bounded');
  }
  if(!camp.complete){const p=leadPlayer(host).position;camp.command([p.x,p.y,p.z],3600);}
  assert.equal(camp.complete,true,'the original 3600-tick camp route must complete');
  await step([{kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,hover:true,
    steer:{keyX:0,keyY:0,stickX:0,stickY:0}}]);
  for(let tick=0;tick<30;tick++)await step([]);
  assert.equal(leadPlayer(host).board.on,true,'the ordinary input must engage the real board');
  const discover=async(place:typeof rows[number]):Promise<void>=>{
    if(arrived.has(place.id))return;
    // Keep driving instead of waiting for a full coast to rest at every
    // place. When momentum points away, the player's ordinary stick brakes
    // and turns it before the next unchanged waypoint progress window.
    for(let turn=0;turn<120&&!arrived.has(place.id);turn++){
      const at=leadPlayer(host).position,dx=place.x-at.x,dz=place.z-at.z,distance=Math.hypot(dx,dz);
      if(leadPlayer(host).velocity.x*dx+leadPlayer(host).velocity.z*dz>=0)break;
      assert.ok(distance>0);
      await step([{kind:'player',moveX:dx/distance,moveZ:dz/distance,yaw:Math.atan2(-dx,-dz)}]);alignmentTicks++;
    }
    {const at=leadPlayer(host).position;assert.ok(arrived.has(place.id)||leadPlayer(host).velocity.x*(place.x-at.x)+leadPlayer(host).velocity.z*(place.z-at.z)>=0,
      'ordinary steering must turn momentum within the original 120-tick progress allowance');}
    if(arrived.has(place.id))return;
    const origin=leadPlayer(host).position,distance=Math.hypot(place.x-origin.x,place.z-origin.z);
    // The west crag wall is solid; approach its real discovery circle from
    // the open east side instead of repeatedly jumping into that wall.
    const detour=place.id==='the-crags'?[{x:-140,z:-20},{x:-140,z:-115}]:[];
    const points=[{x:origin.x,z:origin.z},...detour,{x:place.x,z:place.z}];
    try{
      const cursor=new PhysicsRouteCursor(points,{once:true}),limit=Math.min(18_000,Math.max(1200,Math.ceil(distance*90)));
      const previous=leadPlayer(host).position.clone();let stopped=0;
      for(let tick=0;tick<limit&&!arrived.has(place.id);tick++){
        const p=leadPlayer(host).position,command=cursor.command([p.x,p.y,p.z],tick);
        assert.equal(cursor.stuck.length,0,'the unchanged native route must progress until actual discovery');
        if(cursor.complete)break;
        stopped=p.distanceToSquared(previous)<.0004?stopped+1:0;previous.copy(p);
        const jump=stopped>=45&&stopped%30===15;
        await step([jump?{...command,jump:true}:command]);
      }
    }catch(error){throw new Error(`Native discovery approach ${place.id} at ${JSON.stringify({feet:leadPlayer(host).position,board:leadPlayer(host).board,velocity:leadPlayer(host).velocity,ground:host.groundHeightAt(leadPlayer(host).position.x,leadPlayer(host).position.z),motor:leadPlayer(host).motor.snapshot().result})} via ${JSON.stringify(points)}`,{cause:error});}
    await step([]);assert.ok(arrived.has(place.id),`the real approach must discover ${place.id}`);
    console.error(JSON.stringify({place:place.id,tick:frames.length,at:leadPlayer(host).position}));
  }
  // Visit the pasture along the north bank before touring the plateau.
  const pasture=rows.find(row=>row.id==='sheep-pasture');assert.ok(pasture);await discover(pasture);
  while(arrived.size<rows.length){
    const pending=rows.filter(row=>!arrived.has(row.id)).sort((a,b)=>
      Math.hypot(a.x-leadPlayer(host).position.x,a.z-leadPlayer(host).position.z)-Math.hypot(b.x-leadPlayer(host).position.x,b.z-leadPlayer(host).position.z));
    const place=pending[0];assert.ok(place);await discover(place);
  }
  for(const row of rows)assert.equal(notices.get(`Discovered · ${row.label}`)??0,row.quiet===true?0:1,`one original notice for ${row.id}`);
  assert.equal(host.quests.some(quest=>quest.isComplete),false);
  await mark();
  const captureWallMs=performance.now()-recordStarted,recordMs=captureWallMs-backpressureMs;
  console.info(JSON.stringify({phase:'capture-done',ticks:frames.length,recordMs,captureWallMs,backpressureMs,parts:marks.length}));
  try{
    await pipeline.finish();
    assert.equal(partCount,marks.length);assert.equal(replayed,frames.length);assert.ok(end);
    assert.equal(end.tick,host.state.tick,'replay commits every original movement tick');
    assert.deepEqual(end.position,leadPlayer(host).position.toArray(),'replay retains the exact final native feet');
    assert.deepEqual(end.flags,[...host.flags.all],'fresh native input replay preserves every earned discovery');
    const observed=end.adapters.find(row=>row.id==='nalati.world');assert.ok(observed);
    assert.equal(observed.state,owner.snapshot(),'replay retains the actual motor, water and discovery observations');
    assert.equal(replay.quarantined,false);
    console.info(JSON.stringify({story:'nalati-discoveries',ticks:frames.length,alignmentTicks,recordMs,captureWallMs,backpressureMs,partCount,maxPartMs,replayMs:performance.now()-replayStarted,places:[...arrived.keys()],notices:[...notices]}));
  }finally{await replay.dispose();}
}catch(error){await stopReplay?.();const ready=await session.ready().then(sim=>({sim}),()=>null);if(ready!==null)await ready.sim.dispose();throw error;}
finally{first?.dispose();}
