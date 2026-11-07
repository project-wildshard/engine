import * as v from 'valibot';
import type {SimHost} from '../../src/server/engine/sim';
import type {PrepareHeadlessRuntime,HeadlessRuntimeInstallation} from '../../src/server/host/headlessRuntime';
import {ChapterViewSchema,type ChapterViewRows} from '@wildshard/format/questPageComposition';
import {parseChapterStoryPresentation} from '@wildshard/format/questStory';
import {parseCarriedQuest} from '@wildshard/format/questSteps';
import {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import {chapterDecide} from '../../src/shared/game/quest/chapterDecision';
import {questObservation} from '../../src/shared/game/quest/questObservation';
import {commitQuestEffects} from '../../src/shared/game/quest/effects';
import {nativeTamingOf} from '../../src/server/game/riding/nativeTaming';
import {nalatiTitanOf} from './nalati-titan-native';
import {prepareNalatiBalbals} from './nalati-balbal-native';
import type {NativeEliteBindings} from '../../src/server/engine/ai/eliteRoster';
import {readNalatiKingData} from './nalati-king-data';
import {installNativeKing} from './nalati-king-host';
import {chapterWire,chapterRead} from './headless/chapterHandoff';
import {installNalatiReadings} from './nalati-verbs';
import {installNalatiMountInputs} from './nalati-mount-inputs';
import {installNalatiKokpar} from './nalati-kokpar-native';
import {installNalatiChapterObservation} from './nalati-chapter-observation';
import type {ChapterRecords as NalatiChapterRecords} from '../../src/server/game/quest/chapterRecords';
import {installPackedChapterTaming} from './headless/chapterObservation';
import {createNalatiChapterPresentation} from './nalati-chapter-presentation';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

interface ChapterLoans {
  /** These methods must read their original entered encounters, or an explicit
   * closed loan which refuses entry before returning its closed observation. */
  readonly check:()=>void;readonly inside:()=>boolean;readonly tied:()=>boolean;
  readonly records:NalatiChapterRecords;
}
const clock=v.strictObject({now:v.pipe(v.number(),v.finite(),v.minValue(0)),slowT:v.pipe(v.number(),v.finite()),pulseT:v.pipe(v.number(),v.finite()),presentation:v.optional(v.unknown())});

/** The page's poll/project/commit order and clocks, over native owners. A
 * missing observation is an error; no unbound arena or save becomes zero. */
export function installNalatiChapterPoll(host:SimHost,content:ChapterViewRows,story:ReturnType<typeof parseChapterStoryPresentation>,loans:ChapterLoans,context:Pick<HeadlessRuntimeInstallation,'commands'|'emit'>):void {
  const taming=nativeTamingOf(host),quest=host.quests.find(row=>row.def.id===story.chapters[0]);
  if(taming===undefined||quest===undefined||host.hasStep('nalati.chapter-poll'))throw new Error('Native chapter requires unique entered owners');
  const brain=ReturnProgram.native(host,content.program),rows=content.view;
  let now=0,slowT=0,pulseT=-1e9;
  const live=():void=>{
    if(host.scope.disposed||host.scope.disposing||nativeTamingOf(host)!==taming||!host.quests.includes(quest))throw new Error('Native chapter owners retired');
    loans.check();
  };
  const observe=(ref:Parameters<typeof questObservation>[0]):number=>questObservation(ref,{
    flags:()=>host.flags,quest:id=>{const state=host.quests.find(row=>row.def.id===id);if(state===undefined)throw new Error('Missing declared chapter');return state;},
    active:()=>host.quests.find(row=>!row.isComplete)??null,saved:()=>loans.records,
  });
  const presentation=createNalatiChapterPresentation(host,context,observe);
  const project=(signal:string,values:Readonly<Record<string,number>>):void=>{
    live();chapterDecide(brain,story.decision,signal,values,observe,effects=>{commitQuestEffects(host,quest.def.id,effects,presentation.ports);});
  };
  // The entered page projects a carving only for the actual body's death.
  // Reuse its record-before-projection order, never an interaction grant.
  host.events.on('actor.died',({actor})=>{
    live();const body=[...host.entities.values()].find(candidate=>candidate.combatActor()===actor);
    if(body===undefined)return;
    loans.records.outcomes.kill(body.kind,body.variant);
    if(body.kind===rows.death.kind)project(rows.death.signal,{[rows.timeField]:now});
  },host.scope);
  const poll=():void=>{
    live();const observed={'taming.bonded':Number(taming.phase==='bonded'),'taming.upgraded':Number(taming.upgraded),
      'arena.inside':Number(loans.inside()),'arena.tied':Number(loans.tied())};
    project(rows.signal,{[rows.timeField]:now,...Object.fromEntries(Object.entries(rows.observations).map(([field,source])=>[field,observed[source]]))});
    if(now-pulseT>rows.pulse.interval){pulseT=now;project(rows.pulse.signal,{[rows.timeField]:now});}
  };
  poll();
  host.onStep('nalati.chapter-poll',dt=>{live();now+=dt;if(now-slowT>rows.interval){slowT=now;poll();}},
    {snapshot:()=>{live();const saved=presentation.snapshot();return {now,slowT,pulseT,...(saved===undefined?{}:{presentation:saved})};},restore:value=>{const saved=v.parse(clock,value);live();if(saved.now!==host.clock.now||saved.slowT>saved.now||saved.pulseT>saved.now)throw new Error('Chapter clock differs from its restored host');now=saved.now;slowT=saved.slowT;pulseT=saved.pulseT;presentation.restore(saved.presentation);}});
}

/** Chapter one keeps its closed King loan. The opt-in continuation borrows
 * the actual room, population and original boss clocks after earned clues. */
export async function prepareNalatiChapter(preparation:Parameters<PrepareHeadlessRuntime>[0],enterKing=false):Promise<Awaited<ReturnType<PrepareHeadlessRuntime>>>{
  const product=preparation.product,kingData=enterKing?await readNalatiKingData(product):undefined;
  const kingBindings=new WeakMap<SimHost,NativeEliteBindings>();
  const kingInputs=new WeakMap<SimHost,()=>void>();
  const base=await prepareNalatiBalbals(preparation,kingData===undefined?undefined:{intake:{...kingData.intake,borrowedKinds:[kingData.declared.kind],alwaysKinds:[kingData.declared.kind]},
    bindings:(host,bindings)=>{kingBindings.set(host,bindings);},closedInputOwner:host=>{
      const check=kingInputs.get(host);if(check===undefined)throw new Error('King input loan lost its entered owner');check();
    }});
  const content=v.parse(ChapterViewSchema,await product.json('quests/content.json'));
  const story=parseChapterStoryPresentation(await product.json('quests/chapters.json'));
  const carried=parseCarriedQuest(await product.json('quests/carried.json'));
  const finite=v.pipe(v.number(),v.finite()),point=v.object({x:finite,y:finite,z:finite});
  const {room}=v.parse(v.object({room:v.object({origin:point,halfWidth:v.pipe(finite,v.minValue(Number.MIN_VALUE)),corridorEnd:finite})}),await product.json('combat/room-entry.json'));
  const king=product.shardfile.quests.quests.find(row=>row.id==='golden-king'),door=king?.steps.find(row=>row.id==='door')?.markers?.[0]?.at;
  if(door===undefined)throw new Error('Closed King loan requires its admitted doorway');
  return {...base,install:(host,context)=>{
    base.install(host,context);installNalatiMountInputs(host,context);
    installNalatiReadings(host,context,product.shardfile.quests,content,story);
    installNalatiKokpar(host,context,carried);installNalatiChapterObservation(host,story);
    const titan=nalatiTitanOf(host);if(titan===undefined)throw new Error('Chapter requires its entered Titan and saved records');
    if(kingData!==undefined){
      const bindings=kingBindings.get(host);if(bindings===undefined)throw new Error('King lost its original elite bindings');
      const kingOwner=installNativeKing(host,context,kingData,bindings,titan.records);
      kingInputs.set(host,kingOwner.checkInputs);host.scope.onDispose(()=>{kingInputs.delete(host);});
      host.onStep('nalati.king-closed',dt=>{kingOwner.update(dt);},{snapshot:()=>{
        const value=kingOwner.snapshot();return v.safeParse(v.strictObject({kind:v.literal('closed')}),value).success?{kind:'closed'}:chapterWire(value);
      },restore:value=>{kingOwner.restore(typeof value==='string'?chapterRead(value):value);},physicsRestored:kingOwner.physicsRestored});
      installNalatiChapterPoll(host,content,story,{check:()=>{kingOwner.observe();},inside:()=>kingOwner.observe().inside,tied:()=>titan.fight.tied,records:titan.records},context);
      installPackedChapterTaming(host);return;
    }
    const closed=Object.freeze({kind:'closed' as const});
    const check=():void=>{
      if(nalatiTitanOf(host)!==titan||host.scope.disposed||host.scope.disposing)throw new Error('Chapter encounter loan retired');
      const at=leadPlayer(host).position,r=room.halfWidth;
      if(Math.hypot(at.x-door.x,at.z-door.z)<r||Math.abs(at.x-room.origin.x)<r+1&&Math.abs(at.z-room.origin.z)<room.corridorEnd+1&&Math.abs(at.y-room.origin.y)<8)
        throw new Error('Closed King loan cannot enter its doorway or room');
      const saved=titan.records.bosses.read()['golden-king'];
      if(saved!==undefined&&(saved.defeated||saved.rewardTaken||saved.kills!==0))throw new Error('Closed King loan cannot restore an encounter outcome');
    };
    host.onStep('nalati.king-closed',check,{snapshot:()=>{check();return {...closed};},restore:value=>{v.parse(v.strictObject({kind:v.literal('closed')}),value);check();}});
    installNalatiChapterPoll(host,content,story,{check,inside:()=>{check();return closed.kind!=='closed';},tied:()=>titan.fight.tied,records:titan.records},context);
    installPackedChapterTaming(host);
  }};
}
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=preparation=>prepareNalatiChapter(preparation);
