// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real loan and selection authority and independent replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the original shipped physics bytes.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-practice-native';
import {beginFolderSession} from './folderSession';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const State=v.object({state:v.object({open:v.boolean(),pitch:v.number(),current:v.string(),available:v.array(v.string()),swapping:v.boolean(),rifle:v.string(),
  at:v.object({x:v.number(),y:v.number(),z:v.number()}),board:v.boolean()})});
const session=await beginFolderSession('nalati-grasslands','nalati-practice'),{product,assets}=session;
// The independent worker is already admitting its inputs. Build the existing
// direct owner alongside it, then join both before recording or replaying.
// Observe both failures immediately and retire either successful peer.
const residentReady=(async()=>{
  try{
    const resident=await createNativeProofResident({product,assets,shard:product.shardfile,
      rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))},prepareHeadlessRuntime);
    return {ok:true as const,resident};
  }catch(error:unknown){return {ok:false as const,error};}
})();
let replay:Awaited<ReturnType<typeof session.ready>>;
try{replay=await session.ready();}
catch(error:unknown){const direct=await residentReady;if(direct.ok)direct.resident.dispose();throw error;}
const direct=await residentReady;
if(!direct.ok){await replay.dispose();throw direct.error;}
const resident=direct.resident;
const frames:HeadlessCommand[][]=[],marks:{id:string;tick:number;state:string;position:number[]}[]=[];
const step=(commands:readonly HeadlessCommand[]):void=>{frames.push(structuredClone([...commands]));resident.step(commands);};
const press=(name:'enter'|'exit'|'swap'|'rifle'):void=>{step([{kind:'script',actorId:`nalati.practice.${name}`,value:1}]);};
const advance=(ticks:number):void=>{for(let tick=0;tick<ticks;tick++)step([]);};
const mark=(id:string)=>{
  const owner=resident.host.adapters.get('nalati.practice');assert.ok(owner);const raw=owner.snapshot();assert.equal(typeof raw,'string');
  if(typeof raw!=='string')throw new Error('Missing actual practice loan state');
  marks.push({id,tick:frames.length,state:raw,position:leadPlayer(resident.host).position.toArray()});return v.parse(State,JSON.parse(raw)).state;
};
try{
  step([]);const initial=mark('world-loadout'),owned=[...initial.available];
  assert.equal(initial.open,false);assert.equal(owned.includes(initial.rifle),false);
  press('rifle');advance(40);assert.equal(mark('unowned-rifle-refused').current,initial.current);
  press('swap');advance(40);const ordinary=mark('ordinary-swap');
  assert.notEqual(ordinary.current,initial.current);assert.deepEqual(ordinary.available,owned);
  step([{kind:'player',moveX:0,moveZ:0,yaw:0,hover:true}]);assert.equal(mark('board-before-entry').board,true);
  press('enter');const entered=mark('practice-entry');
  assert.equal(entered.open,true);assert.equal(entered.board,false);assert.equal(entered.pitch,-.1);
  assert.equal(entered.available.includes(entered.rifle),true);
  assert.deepEqual(leadPlayer(resident.host).position.toArray(),[entered.at.x,entered.at.y,entered.at.z],'the shared entry kernel owns the actual room spawn');
  press('rifle');advance(40);const selected=mark('borrowed-rifle-selected');
  assert.equal(selected.current,selected.rifle);assert.equal(selected.swapping,false);
  const checkpoint=serializeSimSnapshot(snapshotSimHost(resident.host)),checkpointTick=frames.length;
  press('exit');const exited=mark('loan-revoked');
  assert.equal(exited.open,false);assert.deepEqual(exited.available,owned);assert.notEqual(exited.current,exited.rifle);
  const returned=exited.current;press('rifle');advance(40);assert.equal(mark('returned-rifle-refused').current,returned);
  press('enter');press('enter');const again=mark('reentered-loan');assert.equal(again.open,true);assert.equal(again.available.includes(again.rifle),true);
  press('rifle');advance(40);assert.equal(mark('second-loan-rifle').current,again.rifle);
  press('exit');advance(40);const final=mark('world-ownership-retained');
  assert.equal(final.open,false);assert.deepEqual(final.available,owned);assert.notEqual(final.current,final.rifle);
  assert.equal(leadPlayer(resident.host).health.alive,true);
  const segments:HeadlessTapeSegment[]=[];let start=0;
  for(const row of marks){segments.push({id:row.id,ticks:row.tick-start,commands:[],frames:frames.slice(start,row.tick)});start=row.tick;}
  const repeated=await replay.verbTape({version:1,observe:['nalati.practice'],segments});
  for(const row of marks){const observation=repeated.observations.find(value=>value.id===row.id);assert.ok(observation);
    assert.deepEqual(observation.position,row.position);assert.equal(observation.adapters.find(value=>value.id==='nalati.practice')?.state,row.state,
      'fresh input replay matches actual ownership, selected identity, animation and loan history');}
  assert.equal(repeated.ticks,frames.length);assert.equal(replay.quarantined,false);await replay.dispose();
  const restored=await beginFolderSession('nalati-grasslands','nalati-practice',checkpoint);replay=await restored.ready();
  const continuation=await replay.verbTape({version:1,observe:['nalati.practice'],segments:[
    {id:'restore-selected-loan',ticks:frames.length-checkpointTick,commands:[],frames:frames.slice(checkpointTick)},
  ]});
  assert.deepEqual(continuation.observations[0]?.position,leadPlayer(resident.host).position.toArray());
  assert.equal(continuation.observations[0]?.adapters.find(value=>value.id==='nalati.practice')?.state,marks.at(-1)?.state,
    'an earned selected-rifle checkpoint revokes and relends exactly the same inventory');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-practice-loan',ticks:frames.length,checkpointTick,rifle:initial.rifle,owned,marks:marks.map(row=>row.id)}));
}finally{resident.dispose();await replay.dispose();}
