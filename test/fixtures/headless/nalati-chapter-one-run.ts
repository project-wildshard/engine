// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Require earned native state and exact independent input replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixed child uses the admitted physics bytes and its owned continuation file.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import * as v from 'valibot';
import {beginProductSession} from './productSession';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-chapter-native';
import {prepareHeadlessRuntime as prepareKing} from '../nalati-king-native';
import {nativeKingOf} from '../nalati-king-host';
import {readNalatiKingData} from '../nalati-king-data';
import {kingEntryInputs,kingPhaseInputs,kingHomeInputs,kingCheckpointSettleInputs} from '../../proof/nalati-grasslands/king';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {parseCarriedQuest} from '@wildshard/format/questSteps';
import {parseHeldSlots} from '@wildshard/format/heldArms';
import {HeldBowFileSchema} from '@wildshard/format/weaponProfiles';
import {heldBowBase} from '../../../src/shared/game/weapons/heldBowBase';
import {decodeSimSnapshot,decodeSimSnapshotBytes,snapshotSimHostBytes,serializeSimSnapshot,type SimSnapshotBytes} from '../../../src/shared/engine/sim/snapshot';
import {physicsState,sameBytes} from '../../fake/simState';
import {chapterCampInputs,chapterApproachInputs,chapterBondInputs,chapterGoatInputs,chapterReturnInputs,chapterHomeInputs} from '../../proof/nalati-grasslands/chapterOne';
import {chapterCarvingRoadInputs,chapterCarvingArrivalInputs,chapterCarvingInputs} from '../../proof/nalati-grasslands/chapterTwo';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import {ChapterHandoffSchema,chapterObserved,chapterTwoObserved,chapterWire,chapterRead,chapterWireHash,chapterSnapshotDigest,
  chapterInputHash,checkChapterLedger,type ChapterPart,type ChapterHandoff} from './chapterHandoff';
import type {HeadlessCommand,HeadlessEffect,HeadlessTickCommit} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeObservation,HeadlessTapeReport} from '../../../src/shared/host/headlessTape';
import {packChapterReport,unpackChapterReport} from './chapterReportCodec';
import {PACKED_CHAPTER_TAMING,unpackChapterTaming} from './chapterObservation';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const [stage,outputPath,inputPath,inputHash]=process.argv.slice(2);assert.ok(stage==='plains'||stage==='approach'||stage==='bond'||stage==='goat'||stage==='return'||stage==='home'||stage==='carving-road'||stage==='carving-arrival'||stage==='carvings'||stage==='king-entry'||stage==='king-phase-one'||stage==='king-phase-two'||stage==='king-victory'||stage==='king-home');
const kingStage=stage==='king-entry'||stage==='king-phase-one'||stage==='king-phase-two'||stage==='king-victory'||stage==='king-home';assert.ok(outputPath);
const observed=stage==='carving-road'||stage==='carving-arrival'||stage==='carvings'||kingStage?chapterTwoObserved:chapterObserved;
let inherited:ChapterHandoff|undefined;
if(stage!=='plains'){
  assert.ok(inputPath);assert.ok(inputHash);assert.ok(statSync(inputPath).size<=36_000_000);
  const wire=readFileSync(inputPath,'utf8');assert.equal(chapterWireHash(wire),inputHash);
  inherited=v.parse(ChapterHandoffSchema,chapterRead(wire));assert.equal(inherited.stage,
    stage==='approach'?'plains':stage==='bond'?'approach':stage==='goat'?'bond':stage==='return'?'goat':stage==='home'?'return':stage==='carving-road'?'home':stage==='carving-arrival'?'carving-road':stage==='carvings'?'carving-arrival':stage==='king-entry'?'carvings':stage==='king-phase-one'?'king-entry':stage==='king-phase-two'?'king-phase-one':stage==='king-victory'?'king-phase-two':'king-victory');checkChapterLedger(inherited.parts,inherited.tick,inherited.reportStart);
}
const started=performance.now();
// The outer child deadline includes static source imports. Keep both clocks
// visible so a late initialization cannot look like a replay/finalization stall.
const phase=(name:string):void=>{console.info(JSON.stringify({stage,phase:name,ms:performance.now()-started,childMs:process.uptime()*1000}));};
phase('imports-ready');
const session=await beginProductSession('nalati-grasslands',kingStage?'nalati-king':'nalati-chapter',inherited?.snapshot),{product,assets}=session;
phase('product-session-started');
// Observe the original readiness promise without moving its admission or
// changing the point where recording/replay must await its complete commit.
void session.ready().then(()=>phase('worker-ready'),()=>phase('worker-refused'));
const descriptor=outputDescriptor(product.shardfile);assert.ok(descriptor?.indexHash);
if(inherited!==undefined)assert.equal(inherited.source,descriptor.indexHash);
const inheritedParts=inherited?.parts.length??0,inheritedPartsHash=inherited===undefined?undefined:chapterWireHash(chapterWire(inherited.parts));
const reportStart=stage==='king-victory'?inheritedParts:inherited?.reportStart;
if(stage==='king-victory'){assert.ok(inherited);assert.equal(inherited.reportStart,undefined);assert.ok(reportStart!==undefined&&reportStart>0);}
if(stage==='king-home')assert.ok(reportStart!==undefined,'the elder inherits the same earned report boundary');
let resident:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
let pipeline:ReturnType<typeof checkedReplayPipeline<ChapterPart>>|undefined;
try{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  phase('physics-loaded');
  resident=await createNativeProofResident({shard:product.shardfile,assets,product,rapier},kingStage?prepareKing:prepareHeadlessRuntime,inherited?.snapshot);
  phase('resident-created');
  // Let the independent owner commit readiness before synchronous recording
  // can occupy this thread; its original request watchdog keeps running.
  await session.ready();
  const active=resident,{host}=active,ready=session.ready(),history:ChapterPart[]=inherited?.parts??[],firstTick=host.state.tick;
  let commandsCount=history.reduce((sum,part)=>sum+(part.plan.segments[0]?.frames??[]).reduce((count,frame)=>count+frame.length,0),0);
  if(inherited!==undefined){
    const restored=snapshotSimHostBytes(host),digest=chapterSnapshotDigest(restored);
    if(digest!==inherited.digest){
      const {physics:actualPhysics,...actual}=restored,{physics:expectedPhysics,...expected}=decodeSimSnapshot(inherited.snapshot);
      assert.deepEqual(actual,expected,'a quiet restore retains every original native field');
      assert.deepEqual(physicsState(actualPhysics),physicsState(expectedPhysics),'a quiet restore retains every original physics field');
    }
    assert.equal(digest,inherited.digest,'the recorder quietly restores the earned arrival');
  }
  const rawReports=new WeakMap<ChapterPart,HeadlessTapeReport>();
  let previousReport:HeadlessTapeReport|undefined=inherited?.parts.at(-1)?.expected;
  if(inherited?.reportStart!==undefined){
    previousReport=inherited.parts[inherited.reportStart-1]?.expected;
    for(const part of inherited.parts.slice(inherited.reportStart))previousReport=unpackChapterReport(part.expected,previousReport);
  }
  let initialized=false;
  // Private replay decode only; no recorder loan or mutable snapshot escapes.
  let finalSnapshot:{wire:string;saved:SimSnapshotBytes}|undefined;
  let final:HeadlessTickCommit|undefined,replayedTicks=0,frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[],peakY=leadPlayer(host).position.y;
  pipeline=checkedReplayPipeline<ChapterPart>(async part=>{
    const worker=await ready;
    if(!initialized&&inherited!==undefined){
      const checkpoint=worker.checkpoint;assert.ok(checkpoint);
      assert.equal(chapterSnapshotDigest(checkpoint.snapshot),inherited.digest,'the fresh worker quietly restores the same earned arrival');
    }
    initialized=true;
    console.info(JSON.stringify({stage,phase:'replay-request',tick:part.expected.observations[0]?.tick,ms:performance.now()-started}));
    const repeated=await worker.verbTapePart(part.plan);
    const raw:HeadlessTapeReport|undefined=rawReports.get(part);assert.ok(raw,'every offered part retains its complete original report');
    assert.deepEqual(repeated.report,raw,'independent inputs retain every observation and ordered effect');
    for(const [index,row]of repeated.report.observations.entries()){
      const packed=row.adapters?.find(adapter=>adapter.id===PACKED_CHAPTER_TAMING);
      if(packed!==undefined){const expectedTaming:HeadlessTapeObservation['adapters'][number]|undefined=raw.observations[index]?.adapters?.find(adapter=>adapter.id===PACKED_CHAPTER_TAMING);assert.ok(expectedTaming);
        assert.deepEqual(unpackChapterTaming(packed.state),unpackChapterTaming(expectedTaming.state),'every original taming field survives the lossless report codec');}
    }
    const saved=decodeSimSnapshotBytes(repeated.commit.snapshot);
    assert.equal(chapterSnapshotDigest(saved),part.digest,'every boundary retains the complete numeric native continuation');
    finalSnapshot={wire:repeated.commit.snapshot,saved};
    final=repeated.commit;replayedTicks+=repeated.report.ticks;
    console.info(JSON.stringify({stage,phase:'replay-checked',tick:repeated.commit.tick,wireChars:repeated.commit.snapshot.length,ms:performance.now()-started}));
  });
  const checked=pipeline;
  const flush=async():Promise<void>=>{
    if(frames.length===0)return;
    const id=`chapter-${history.length}`,observation:HeadlessTapeObservation={id,tick:host.state.tick,position:leadPlayer(host).position.toArray(),peakY,
      grounded:leadPlayer(host).motor.snapshot().result.grounded,flags:[...host.flags.all],
      quests:host.quests.map(quest=>({id:quest.def.id,currentId:quest.current?.id??null,started:quest.snapshot().started,complete:quest.isComplete})),effects,
      adapters:observed.map(identity=>{const adapter=host.adapters.get(identity);assert.ok(adapter);const state=adapter.snapshot();
        return {id:identity,state:typeof state==='string'?state:JSON.stringify(state)};})};
    const raw:HeadlessTapeReport={version:1,ticks:frames.length,observations:[observation]};
    const expectedReport:HeadlessTapeReport=reportStart===undefined?raw:packChapterReport(raw,previousReport,stage==='king-home');
    if(reportStart!==undefined)assert.equal(chapterWire(unpackChapterReport(expectedReport,previousReport)),chapterWire(raw),'the report codec preserves every original byte');
    const part:ChapterPart={plan:{version:1,observe:[...observed],segments:[{id,ticks:frames.length,commands:[],frames}]},
      expected:expectedReport,digest:chapterSnapshotDigest(snapshotSimHostBytes(host))};
    rawReports.set(part,raw);previousReport=raw;
    history.push(part);checkChapterLedger(history,host.state.tick,reportStart);frames=[];effects=[];peakY=leadPlayer(host).position.y;
    await checked.offer(part);
  };
  let bondTicks=0;
  if(stage==='bond'){assert.ok(inherited?.bondStart!==undefined);bondTicks=host.state.tick-inherited.bondStart;}
  const carvingInputs=async():Promise<Generator<readonly HeadlessCommand[]>>=>{
    const slots=parseHeldSlots(await product.json('held/slots.json')),slot=slots.slots.find(row=>row.kind==='bow');assert.ok(slot);
    const definition=v.parse(HeldBowFileSchema,await product.json(slot.file));
    return chapterCarvingInputs(host,slots,heldBowBase({bow:definition.bow,base:definition.base}));
  };
  const kingInputs=async():Promise<Generator<readonly HeadlessCommand[]>>=>{
    const king=nativeKingOf(host);assert.ok(king);const rows=await readNalatiKingData(product);
    if(stage==='king-entry')return kingEntryInputs(host,king.observe,rows);
    if(stage==='king-home')return kingHomeInputs(host,king.observe,rows);
    return kingPhaseInputs(host,king.observe,rows,parseHeldSlots(await product.json('held/slots.json')),stage==='king-phase-one'?1:stage==='king-phase-two'?2:'victory');
  };
  const inputs=stage==='plains'?chapterCampInputs(host,product.shardfile.spawn):stage==='approach'?chapterApproachInputs(host):stage==='bond'?chapterBondInputs(host,bondTicks)
    :stage==='goat'?chapterGoatInputs(host,parseCarriedQuest(await product.json('quests/carried.json'))):stage==='return'?chapterReturnInputs(host):stage==='home'?chapterHomeInputs(host,true)
      :stage==='carving-road'?chapterCarvingRoadInputs(host):stage==='carving-arrival'?chapterCarvingArrivalInputs(host,true):stage==='carvings'?await carvingInputs():await kingInputs();
  const recordInput=(commands:readonly HeadlessCommand[]):void=>{
    checked.check();commandsCount+=commands.length;assert.ok(commandsCount<=90_000&&host.state.tick<60_000);
    frames.push(structuredClone([...commands]));active.step(commands);effects.push(...structuredClone(active.effects));
    assert.ok(leadPlayer(host).health.alive);peakY=Math.max(peakY,leadPlayer(host).position.y);
  };
  for(const commands of inputs){recordInput(commands);if(host.state.tick%512===0)await flush();}
  await flush();
  if(stage==='king-victory'){
    for(const commands of kingCheckpointSettleInputs(()=>{
      const hit=leadPlayer(host).motor.result.groundCollider;
      return hit===null||host.physics.world.colliders.contains(hit.handle)&&host.physics.world.getCollider(hit.handle)?.handle===hit.handle;
    })){recordInput(commands);if(host.state.tick%512===0)await flush();}
    await flush();
  }
  await checked.finish();assert.ok(final);
  assert.equal(replayedTicks,host.state.tick-firstTick);
  assert.ok(finalSnapshot);assert.equal(finalSnapshot.wire,final.snapshot,'the final comparison owns the exact independently decoded replay wire');
  const {physics:a,...actual}=finalSnapshot.saved,{physics:b,...expected}=snapshotSimHostBytes(host);
  assert.deepEqual(actual,expected);if(!sameBytes(a,b))assert.deepEqual(physicsState(a),physicsState(b));
  assert.equal((await ready).quarantined,false);checkChapterLedger(history,host.state.tick,reportStart);
  if(inheritedPartsHash!==undefined)assert.equal(chapterWireHash(chapterWire(history.slice(0,inheritedParts))),inheritedPartsHash,
    'the checked prefix retains every original input, observation, effect and native digest');
  const secondChapter=stage==='carving-road'||stage==='carving-arrival'||stage==='carvings'||kingStage,firstComplete=stage==='home'||secondChapter;
  assert.equal(host.flags.has('tamed:horse'),stage!=='plains'&&stage!=='approach');assert.equal(host.flags.has('won:kokpar'),stage!=='plains'&&stage!=='approach'&&stage!=='bond');
  assert.equal(host.flags.has('told:tulpar'),firstComplete);assert.equal(host.flags.has('quest:tulpar'),firstComplete);
  assert.equal(host.flags.has('talked:elder:2'),secondChapter);
  assert.equal(host.flags.has('entered:kurgan'),kingStage);
  for(const flag of ['quest:father-wind','dead:jel-ata'])assert.equal(host.flags.has(flag),false,flag);
  assert.equal(host.flags.has('quest:golden-king'),stage==='king-home');assert.equal(host.flags.has('told:king'),stage==='king-home');
  assert.equal(host.flags.has('dead:golden-king'),stage==='king-victory'||stage==='king-home');
  for(const flag of ['clue:1','clue:2','clue:3'])assert.equal(host.flags.has(flag),stage==='carvings'||kingStage,flag);
  const quest=product.shardfile.quests.quests.find(row=>row.id==='tulpar');assert.ok(quest?.onComplete?.fact);
  const fact=quest.onComplete.fact,earned=history.flatMap(part=>part.expected.observations.flatMap(row=>row.effects));
  const completionFacts=earned.filter(effect=>effect.kind==='fact'&&effect.name===fact&&effect.actorId===quest.id).length;
  assert.equal(completionFacts,Number(firstComplete));
  if(stage==='king-home'){
    const kingQuest=product.shardfile.quests.quests.find(row=>row.id==='golden-king');assert.ok(kingQuest?.onComplete?.fact);
    assert.equal(earned.filter(effect=>effect.kind==='fact'&&effect.name===kingQuest.onComplete?.fact&&effect.actorId===kingQuest.id).length,1);
    assert.equal(host.quests.find(row=>row.def.id===kingQuest.id)?.isComplete,true);
  }
  const snapshot=snapshotSimHostBytes(host),handoff:ChapterHandoff={version:1,stage,source:descriptor.indexHash,tick:host.state.tick,
    ...(stage==='approach'?{bondStart:firstTick}:{}),...(reportStart===undefined?{}:{reportStart}),snapshot:serializeSimSnapshot(snapshot),digest:chapterSnapshotDigest(snapshot),parts:history};
  assert.equal(chapterSnapshotDigest(handoff.snapshot),handoff.digest,'the saved continuation retains every numeric native field');
  const wire=chapterWire(v.parse(ChapterHandoffSchema,handoff));assert.ok(Buffer.byteLength(wire)<=36_000_000);
  assert.equal(chapterInputHash(v.parse(ChapterHandoffSchema,chapterRead(wire)).parts),chapterInputHash(history),'child handoff retains every signed-zero command');
  writeFileSync(outputPath,wire,{flag:'wx',mode:0o600});
  const current=host.quests.find(row=>row.def.id===quest.id);assert.ok(current);
  console.info(JSON.stringify({story:`chapter-one-${stage}`,hash:chapterWireHash(wire),tick:host.state.tick,parts:history.length,...(reportStart===undefined?{}:{reportStart}),
    current:current.current?.id??null,complete:current.isComplete,completionFacts,flags:[...host.flags.all],
    commands:history.reduce((sum,part)=>sum+(part.plan.segments[0]?.frames??[]).reduce((count,frame)=>count+frame.length,0),0),ms:performance.now()-started}));
}finally{
  try{await pipeline?.stop();}
  finally{resident?.dispose();await(await session.ready()).dispose();}
}
