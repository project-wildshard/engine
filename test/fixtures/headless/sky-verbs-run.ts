// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Read exact admitted native product and physics bytes.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Assertions describe actual current input execution, never golden output.
import assert from 'node:assert/strict';
import {openFolderSession} from './folderSession';
import {builtFolder} from '../builtFolder';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {createNativeProofResident} from '../headless-native';
import {installWalkRopeBodies} from './ropeBodies';
import {installNativeWalkBounds} from './nativeBounds';
import {prepareHeadlessRuntime} from '../sky-verbs';
import {SkyTape} from '../../proof/far-reach/tape';
import type {HeadlessCommand,HeadlessEffect} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import {WINCH} from '../../../src/shards/far-reach/generators/layout';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const mode=process.argv[2]??'priority';
if(mode!=='priority'&&mode!=='gust')throw new Error('Unknown Sky verb tape');
const session=await openFolderSession('far-reach','sky-verbs'),{product}=session;
let resident:Awaited<ReturnType<typeof createNativeProofResident>>|undefined,releaseRopes=()=>{};
/** Version-one camera-relative stick input feeds the shared page foot law.
 * Board motion still consumes its ordinary native axes and HOVER presses. */
function controls(command:HeadlessCommand):HeadlessCommand {
  if(command.kind!=='player')return command;
  const {moveX:x,moveZ:z,yaw}=command,c=Math.cos(yaw),s=Math.sin(yaw);
  const clamp=(n:number)=>Math.max(-1,Math.min(1,n));
  return {...command,commandVersion:1,steer:{keyX:0,keyY:0,stickX:clamp(x*c-z*s),stickY:clamp(-x*s-z*c)}};
}
try{
  const descriptor=outputDescriptor(product.shardfile);assert.ok(descriptor);
  const directory=builtFolder('far-reach'),assets=new Map(descriptor.index.files.map(file=>[
    file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`)),
  ]));
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  resident=await createNativeProofResident({shard:product.shardfile,assets,product,rapier},prepareHeadlessRuntime);
  const active=resident,{host}=active;releaseRopes=installWalkRopeBodies(host,product);installNativeWalkBounds(host);
  const quest=host.quests.find(row=>row.def.id==='far.quest');assert.ok(quest);
  const controller=new SkyTape(undefined,mode==='priority'),segments:HeadlessTapeSegment[]=[];
  const expected:{id:string;flags:string[];current:string|null;position:number[];effects:HeadlessEffect[]}[]=[];
  let frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[],total=0,commandCount=0,logged=0,boardTicks=0;
  const flush=(id:string)=>{
    if(frames.length===0)return;
    segments.push({id,ticks:frames.length,commands:[],frames});frames=[];
    expected.push({id,flags:[...host.flags.all],current:quest.current?.id??null,position:leadPlayer(host).position.toArray(),effects});effects=[];
  };
  const step=(commands:HeadlessCommand[])=>{
    total++;commandCount+=commands.length;
    if(total>30_000||commandCount>60_000)throw new Error('Sky verbs exceed the admitted command allowance');
    active.step(commands);frames.push(commands);effects.push(...structuredClone(active.effects));
    if(leadPlayer(host).board.on)boardTicks++;
    if(frames.length===18_000)flush(`slice-${total}`);
  };
  step([{kind:'script',actorId:'far.interact',value:0},controls({kind:'player',moveX:0,moveZ:0,yaw:0})]);
  assert.equal(host.flags.has('far.notes'),false);flush('keeper-out-of-reach');
  while(total<30_000){
    const commands=controller.next(host).map(controls);
    while(logged<controller.log.length){const mark=controller.log[logged++];assert.ok(mark);flush(`leg-${mark.leg}-${mark.kind}`);}
    if(mode==='priority'&&controller.finished)break;
    step(commands);
    if(mode==='gust'&&host.flags.has('far.vane.grove')){flush('gust-grove');break;}
  }
  flush('terminal');
  assert.ok(host.flags.has('far.notes'),'real keeper talk earns notes');
  assert.equal(quest.current?.id,'roost');assert.equal(quest.isComplete,false);
  for(const flag of ['far.roost','far.vanes','far.bridge','far.complete','far.roc.down'])assert.equal(host.flags.has(flag),false,flag);
  if(mode==='priority'){
    assert.ok(controller.finished,JSON.stringify({position:leadPlayer(host).position,tape:controller.state}));
    assert.ok(boardTicks>0,'actual HOVER input must ride the updraft');
    assert.ok(Math.hypot(leadPlayer(host).position.x-WINCH.x,leadPlayer(host).position.z-WINCH.z)<3,'the locked winch is actually in reach');
    assert.ok(host.flags.has('seen:far.windmill'),'real bridge walk discovers the windmill');
    // The native prompt owner guards progression; its toast belongs to page presentation.
    const winch=expected.find(row=>row.id==='leg-8-act');assert.ok(winch,'actual in-reach winch interaction committed');
    assert.equal(winch.flags.includes('far.bridge'),false);assert.equal(winch.current,'roost');
  }else{
    assert.ok(host.flags.has('far.vane.grove'),'actual GUST must turn the reachable vane');
    assert.ok(host.flags.has('seen:far.grove'),'actual rope bridge walk discovers the grove');
  }
  const report=await session.sim.verbTape({version:1,observe:[],segments});
  assert.equal(report.ticks,total);
  for(const wanted of expected){
    const actual=report.observations.find(row=>row.id===wanted.id);assert.ok(actual);
    assert.deepEqual(actual.flags,wanted.flags,'fresh command replay earns the same flags');
    assert.deepEqual(actual.position,wanted.position,'fresh native inputs retain actual feet');
    assert.deepEqual(actual.effects,wanted.effects,'fresh native inputs retain actual hints and grants');
    assert.equal(actual.quests.find(row=>row.id==='far.quest')?.currentId,wanted.current);
  }
  assert.equal(session.sim.quarantined,false);
  console.info(JSON.stringify({phase:'replayed',slug:'far-reach',mode,ticks:total,segments:report.observations.length,boardTicks,flags:[...host.flags.all]}));
}finally{releaseRopes();resident?.dispose();await session.sim.dispose();}
