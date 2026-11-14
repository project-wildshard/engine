// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Only current admitted product files and the shipped native physics module.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Actual native command record/replay behavior, never stored goldens.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {openFolderSession} from './folderSession';
import {builtFolder} from '../builtFolder';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {folderHeadlessSections} from '../../../src/shared/host/headlessSections';
import {createTrustedHeadlessResident} from '../../../src/server/host/headlessRuntime';
import type {HeadlessCommand,HeadlessEffect} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeObservation,HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {installAppIdentity} from '../../../src/shared/engine/app/identity';
import {WILDSHARD_IDENTITY} from '../../../src/client/game/identity';
import {MATRIARCH_ID} from '../../../src/shards/sunscar-dunes/generators/rows/matriarchEncounter';
import {MATRIARCH_BOSS_PROFILE} from '../../../src/shards/sunscar-dunes/generators/rows/matriarchBoss';

const encounterSchema=v.object({boss:v.object({state:v.string(),phase:v.number(),checkpoint:v.number(),attempts:v.number(),
  saved:v.object({defeated:v.boolean(),rewardTaken:v.boolean(),kills:v.number()})})});
const bossState=(value:unknown)=>v.parse(encounterSchema,typeof value==='string'?JSON.parse(value):value).boss;

installAppIdentity(WILDSHARD_IDENTITY);
const slug='sunscar-dunes',session=await openFolderSession(slug),{product}=session;
let resident:Awaited<ReturnType<typeof createTrustedHeadlessResident>>|undefined;
try{
  const descriptor=outputDescriptor(product.shardfile);assert.ok(descriptor);
  const directory=builtFolder(slug),assets=new Map(descriptor.index.files.map(file=>[
    file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`)),
  ]));
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  resident=await createTrustedHeadlessResident({shard:product.shardfile,assets,product,rapier,sections:folderHeadlessSections(product)});
  const {SignalTape}=await import('../../proof/sunscar-dunes/witness');
  const controller=new SignalTape(),{host}=resident,quest=host.quests[0];assert.ok(quest);
  const bossOwner=host.adapters.get(MATRIARCH_ID);assert.ok(bossOwner);
  const retryPhases:number[]=[];
  host.events.on('boss.attempt',event=>{
    if(event.boss===MATRIARCH_ID&&event.outcome==='died')retryPhases.push(bossState(bossOwner.snapshot()).phase);
  },host.scope);
  const segments:HeadlessTapeSegment[]=[],expected:{id:string;flags:string[];current:string|null;complete:boolean;effects:HeadlessEffect[];boss:ReturnType<typeof bossState>}[]=[];
  let frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[],commandsCount=0,last=quest.current?.id,seenRetries=0,maxRetryRadius=0;
  const flush=()=>{
    if(frames.length===0)return;
    const id=`stage-${segments.length}`;segments.push({id,ticks:frames.length,commands:[],frames});frames=[];
    expected.push({id,flags:[...host.flags.all],current:quest.current?.id??null,complete:quest.isComplete,effects,boss:bossState(bossOwner.snapshot())});effects=[];
  };
  for(let tick=0;tick<40_000;tick++){
    const commands=structuredClone(controller.next(host));commandsCount+=commands.length;
    if(commandsCount>60_000)throw new Error('Story exceeds canonical declared command allowance');
    resident.step(commands);frames.push(commands);effects.push(...resident.effects);
    const matriarch=host.entities.get(MATRIARCH_ID),arena=MATRIARCH_BOSS_PROFILE.fight.arena;
    if(retryPhases.length>0&&matriarch?.alive===true){
      const radius=Math.hypot(matriarch.position.x-arena.x,matriarch.position.z-arena.z);
      maxRetryRadius=Math.max(maxRetryRadius,radius);
      assert.ok(radius<=arena.r,'retried Matriarch must keep moving inside her declared arena');
    }
    const current=quest.current?.id;if(current!==last||retryPhases.length!==seenRetries||frames.length===18_000){flush();last=current;seenRetries=retryPhases.length;}
    if(controller.walked&&quest.isComplete){flush();break;}
  }
  flush();
  assert.equal(controller.walked,true);assert.equal(quest.isComplete,true);
  assert.ok(retryPhases.includes(1),'the real storm phase must kill the player and earn a retry');
  const finalBoss=bossState(bossOwner.snapshot());
  assert.equal(finalBoss.attempts,retryPhases.length+1);assert.equal(finalBoss.state,'victory');assert.equal(finalBoss.saved.defeated,true);
  for(const flag of ['sunscar.scout','sunscar.logbook','sunscar.oil','sunscar.brazier.0','sunscar.brazier.1',
    'sunscar.brazier.2','sunscar.lit','sunscar.matriarch.down','sunscar.complete'])assert.ok(host.flags.has(flag),flag);
  const report=await session.sim.verbTape({version:1,observe:[MATRIARCH_ID],segments});
  for(const wanted of expected){
    const actual=report.observations.find(row=>row.id===wanted.id);assert.ok(actual);
    assert.deepEqual(actual.flags,wanted.flags,'fresh actual commands must earn the same transitions');
    assert.deepEqual(actual.effects,wanted.effects,'a worker replay must neither lose nor duplicate earned effects');
    const replayed:HeadlessTapeObservation['quests'][number]|undefined=actual.quests.find(row=>row.id===quest.def.id);assert.ok(replayed);
    assert.equal(replayed.currentId,wanted.current);assert.equal(replayed.complete,wanted.complete);
    const actualBoss=actual.adapters.find(row=>row.id===MATRIARCH_ID);assert.ok(actualBoss);
    assert.deepEqual(bossState(actualBoss.state),wanted.boss,'fresh replay must earn the same retry, checkpoint and victory');
  }
  const reward=product.shardfile.quests.quests.find(row=>row.id===quest.def.id)?.onComplete;
  assert.ok(reward);
  const earned=report.observations.flatMap(row=>row.effects);
  if(reward.fact!==undefined)assert.equal(earned.filter(effect=>effect.kind==='fact'&&effect.name===reward.fact).length,1);
  if(reward.coins!==undefined)assert.ok(earned.reduce((sum,effect)=>sum+(effect.kind==='coins'?effect.amount:0),0)>=reward.coins);
  assert.equal(report.ticks,host.state.tick);assert.equal(session.sim.quarantined,false);
  console.info(JSON.stringify({phase:'replayed',slug,ticks:report.ticks,quest:quest.def.id,complete:true,segments:report.observations.length,
    retries:retryPhases.length,stormRetry:true,arenaBounded:true,maxRetryRadius}));
}finally{resident?.dispose();await session.sim.dispose();}
