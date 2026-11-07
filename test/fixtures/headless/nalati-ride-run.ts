// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the admitted product and shipped physics bytes.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Native behavior assertions run in this bounded child.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {createNativeProofResident} from '../headless-native';
import {createNativeProofWorker} from '../headless-worker';
import {productHeadlessSections} from '../../../src/shared/host/headlessSections';
import {runTrustedHeadlessTape,type HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {prepareHeadlessRuntime} from '../nalati-verbs';
import {nalatiCampTalkTape} from '../../proof/nalati-grasslands/verbTape';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),source=product.shardfile;
const descriptor=outputDescriptor(source);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
  Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const resident=await createNativeProofResident({shard:source,assets,rapier,product},prepareHeadlessRuntime);
const frames:HeadlessCommand[][]=[],marks:{id:string;tick:number;mounted:boolean;speed:number;gait:string;state:string}[]=[];
try{
  const mounted=mountedPlayerOf(resident.host);assert.ok(mounted);
  const step=(commands:readonly HeadlessCommand[]):void=>{frames.push(structuredClone([...commands]));resident.step(commands);};
  const mark=(id:string):void=>{const state=resident.host.adapters.get('nalati.mounted');assert.ok(state);
    marks.push({id,tick:frames.length,mounted:mounted.mounted,speed:mounted.body.speed,gait:mounted.body.gait,state:JSON.stringify(state.snapshot())});};
  step([{kind:'script',actorId:'nalati.ride',value:1}]);assert.equal(mounted.mounted,false);mark('mount-out-of-reach');
  const camp=nalatiCampTalkTape(source.spawn),end=camp.segments.findIndex(row=>row.id==='walk-to-herderRail')+1;
  assert.ok(end>0);
  runTrustedHeadlessTape(resident.host,step,()=>resident.effects,{...camp,segments:camp.segments.slice(0,end)});
  runTrustedHeadlessTape(resident.host,step,()=>resident.effects,{version:1,observe:[],segments:[{
    id:'walk-west-of-camp-horse',ticks:1200,commands:[],route:[{x:72.4,z:212.9},{x:72,z:210},
      {x:68,z:210},{x:66,z:211.5},{x:66.8,z:213.4}],
  }]});
  step([{kind:'script',actorId:'nalati.ride',value:1}]);assert.equal(mounted.mounted,true);mark('mount-camp-horse');
  const reins=(forward:number,turn:number,sprint=false):HeadlessCommand=>({kind:'player',moveX:0,moveZ:0,
    yaw:leadPlayer(resident.host).yaw,commandVersion:1,steer:{keyX:0,keyY:forward,stickX:turn,stickY:0},sprint});
  // Back clear of the actual hitching rail, then turn with the native reins.
  for(let tick=0;tick<90;tick++)step([reins(-1,0)]);assert.ok(mounted.body.speed<0);mark('back-clear-of-rail');
  for(let tick=0;tick<240;tick++){
    const delta=Math.atan2(Math.sin(mounted.body.heading+Math.PI/2),Math.cos(mounted.body.heading+Math.PI/2));
    step([reins(0,Math.max(-1,Math.min(1,delta*2)))]);
  }
  mark('turn-west');
  for(let tick=0;tick<1200&&mounted.body.gait!=='gallop';tick++)step([reins(1,0,true)]);
  assert.equal(mounted.body.gait,'gallop','held native reins must reach an actual gallop');mark('ride-west');
  step([{kind:'script',actorId:'nalati.ride',value:2}]);assert.equal(mounted.mounted,false);mark('dismount');
}finally{resident.dispose();}

const replay=await createNativeProofWorker(source,assets,'nalati-verbs',undefined,productHeadlessSections(product),directory);
try{
  const segments:HeadlessTapeSegment[]=[];let start=0;
  for(const mark of marks){segments.push({id:mark.id,ticks:mark.tick-start,commands:[],frames:frames.slice(start,mark.tick)});start=mark.tick;}
  const report=await replay.verbTape({version:1,observe:['nalati.mounted'],segments});
  for(const mark of marks){
    const observation=report.observations.find(row=>row.id===mark.id);assert.ok(observation);
    const state=observation.adapters.find(row=>row.id==='nalati.mounted');assert.ok(state);
    assert.deepEqual(JSON.parse(state.state),JSON.parse(mark.state),'fresh inputs reproduce the actual native rider and motor');
    const rider=v.parse(v.object({horse:v.nullable(v.string())}),JSON.parse(state.state));
    assert.equal(rider.horse!==null,mark.mounted);
    for(const flag of ['tamed:horse','won:kokpar','quest:tulpar'])assert.equal(observation.flags.includes(flag),false);
  }
  assert.equal(report.ticks,frames.length);assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'camp-ride',ticks:report.ticks,marks:marks.map(mark=>({id:mark.id,tick:mark.tick,
    mounted:mark.mounted,speed:mark.speed,gait:mark.gait}))}));
}finally{await replay.dispose();}
