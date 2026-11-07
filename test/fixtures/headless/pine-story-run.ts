// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
import { sceneLivingBytes } from '@wildshard/format/worldScenePages';
// oxlint-disable-next-line import/no-nodejs-modules -- Read only declared paths in the admitted native product.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Assertions concern actual execution in the bounded Node runner.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {beginProductSession} from './productSession';
import {productHeadlessSections} from '../../../src/shared/host/headlessSections';
import type {HeadlessRuntimePlan} from '../../../src/server/host/headlessRuntime';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeObservation,HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import {createNativeProofResident} from '../headless-native';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {installWalkRopeBodies} from './ropeBodies';
import {installNativeWalkBounds} from './nativeBounds';
import {installAppIdentity} from '../../../src/shared/engine/app/identity';
import {WILDSHARD_IDENTITY} from '../../../src/client/game/identity';
import {ForestPageSchema} from '@wildshard/format/forestPage';
import {prepareHeadlessRuntime} from '../pine-verbs';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const started=performance.now();let phaseStart=started;
const measured=(phase:string)=>{const now=performance.now();console.info(JSON.stringify({phase:'timing',stage:phase,milliseconds:now-phaseStart}));phaseStart=now;};
installAppIdentity(WILDSHARD_IDENTITY);
const slug='pine-hollow',session=await beginProductSession(slug,'pine-verbs'),{product}=session;
measured('product-session');
let resident:Awaited<ReturnType<typeof createNativeProofResident>>|undefined,retireRopes=()=>{ /* Nothing is installed until the resident is ready. */ };
try{
  const {assets}=session;
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  // Retain the actual plan once so the controller reads its real nav/ground ports.
  let plan:HeadlessRuntimePlan|undefined;
  resident=await createNativeProofResident({shard:product.shardfile,assets,product,rapier,sections:productHeadlessSections(product)},async preparation=>{
    plan=await prepareHeadlessRuntime(preparation);return plan;
  });
  assert.ok(plan);const active=resident;measured('resident');
  const {pineTape,kingRow,kingSnapshotRow}=await import('../../proof/pine-hollow/controller');
  const navBytes=await product.file('server/navmesh.bin');
  const controller=pineTape(plan,navBytes),{host}=resident;measured('controller');
  retireRopes=installWalkRopeBodies(host,product);installNativeWalkBounds(host);
  const page=v.parse(ForestPageSchema,await product.json('world/forest-page.json'));
  const variant=page.buildings.variants.find(row=>row.tier==='phone'&&!row.shadow&&!row.shared);assert.ok(variant);
  const doors=sceneLivingBytes(await product.file(variant.file),variant).life.doors;
  const door=doors[0];assert.ok(door);
  const statesSchema=v.array(v.object({open:v.boolean()}));
  const loadoutInput=product.shardfile.items.loadout.native?.input;assert.ok(loadoutInput);
  const loadoutSchema=v.object({held:v.number()});
  const held=()=>v.parse(loadoutSchema,host.adapters.get(loadoutInput.step)?.snapshot()).held;
  const heldSlots:number[]=[held()],requestedSlots=new Set<number>();
  const quest=host.quests[0];assert.ok(quest,'actual story owner');
  const expected:{id:string;flags:string[];current:string|null;complete:boolean;held:number}[]=[];
  // Small transport parts keep both complete simulations busy without changing a tick input.
  const partTicks=512;
  let frames:HeadlessCommand[][]=[],commandsCount=0,last=quest.current?.id;
  const flush=():HeadlessTapeSegment|undefined=>{
    if(frames.length===0)return undefined;
    const id=`stage-${expected.length}`,segment:HeadlessTapeSegment={id,ticks:frames.length,commands:[],frames};frames=[];
    assert.deepEqual(kingRow(host),kingSnapshotRow(host),'native boss observations retain the complete continuation facts');
    console.info(JSON.stringify({phase:'record-stage',id,ticks:segment.ticks,current:quest.current?.id??null,at:host.state.tick,milliseconds:performance.now()-started}));
    expected.push({id,flags:[...host.flags.all],current:quest.current?.id??null,complete:quest.isComplete,held:held()});
    return segment;
  };
  const recording=async function* recording():AsyncGenerator<HeadlessTapeSegment>{
  measured('recorder-setup');
  for(let tick=0;tick<60_000;tick++){
    const commands=structuredClone(controller.next(host));
    const [x,y,z]=door.at,p=leadPlayer(host).position;
    if(Math.hypot(p.x-x,p.y+1.68-y,p.z-z)<door.reach){
      const first=v.parse(statesSchema,host.adapters.get('pine.doors')?.snapshot())[0];assert.ok(first);
      if(!first.open)commands.push({kind:'script',actorId:'pine.door',value:0});
    }
    for(const command of commands)if(command.kind==='script'&&command.actorId===loadoutInput.command)requestedSlots.add(command.value);
    commandsCount+=commands.length;
    if(commandsCount>60_000)throw new Error('Story exceeds canonical declared command allowance');
    active.step(commands);frames.push(commands);
    const current=quest.current?.id;
    const selected=held(),swapped=selected!==heldSlots.at(-1);if(swapped)heldSlots.push(selected);
    if(current!==last||swapped||frames.length===partTicks){const segment=flush();last=current;if(segment!==undefined)yield await Promise.resolve(segment);}
    if(controller.walked&&quest.isComplete){const segment=flush();if(segment!==undefined)yield await Promise.resolve(segment);break;}
  }
  const final=flush();if(final!==undefined)yield await Promise.resolve(final);
  assert.equal(controller.walked,true,JSON.stringify({current:quest.current?.id,position:leadPlayer(host).position,tape:controller.state}));
  assert.equal(quest.isComplete,true);
  for(const flag of ['talked:ranger','owned:lever-rifle','open:dam-sluice','taken:pond-glass','lit:pond','taken:ridge-flint',
    'lit:ridge','used:ph-zip','lit:den','followed:stag','dead:king','seen:dawn','quest:warden-done'])assert.ok(host.flags.has(flag),flag);
  const slot=(id:string)=>{const row=product.shardfile.items.rows.find(item=>item.id===id);assert.ok(row?.kind==='weapon'&&row.ranged!==undefined);return row.ranged.slot;};
  const crossbow=slot('weapon.crossbow'),lever=slot('weapon.lever'),firstLever=heldSlots.indexOf(lever),backToCrossbow=heldSlots.indexOf(crossbow,firstLever+1);
  assert.ok(firstLever!==-1&&backToCrossbow>firstLever&&heldSlots.indexOf(lever,backToCrossbow+1)>backToCrossbow,JSON.stringify(heldSlots));
  assert.ok(requestedSlots.has(crossbow)&&requestedSlots.has(lever),'the real controller must request both selections');
  measured('record-source-complete');
  };
  const sim=await session.ready();measured('replay-ready');
  const pipelineStarted=performance.now();
  const report=await sim.streamVerbTape([loadoutInput.step],recording());
  measured('replay-tail');
  for(const wanted of expected){
    const actual=report.observations.find(row=>row.id===wanted.id);assert.ok(actual);
    assert.deepEqual(actual.flags,wanted.flags,'fresh current input replay must earn the same transitions');
    const replayed:HeadlessTapeObservation['quests'][number]|undefined=actual.quests.find(row=>row.id===quest.def.id);assert.ok(replayed);
    assert.equal(replayed.currentId,wanted.current);assert.equal(replayed.complete,wanted.complete);
    const equipment=actual.adapters[0];assert.ok(equipment);assert.equal(v.parse(loadoutSchema,JSON.parse(equipment.state)).held,wanted.held);
  }
  assert.equal(report.ticks,host.state.tick);assert.equal(sim.quarantined,false);
  console.info(JSON.stringify({phase:'replayed',slug,ticks:report.ticks,quest:quest.def.id,complete:true,segments:report.observations.length,heldSlots,pipelineMs:performance.now()-pipelineStarted}));
}catch(error){
  console.error(JSON.stringify({phase:'pine-story-failed',milliseconds:performance.now()-started,tick:resident?.host.state.tick,
    error:error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error)}));
  throw error;
}finally{retireRopes();resident?.dispose();await (await session.ready()).dispose();}
