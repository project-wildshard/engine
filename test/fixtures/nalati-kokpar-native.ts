import * as v from 'valibot';
import type {SimHost} from '../../src/server/engine/sim';
import type {HeadlessRuntimeInstallation,PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {parseCarriedQuest,type CarriedQuestRows} from '@wildshard/format/questSteps';
import {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import {commitQuestEffects} from '../../src/shared/game/quest/effects';
import {mountedPlayerOf} from '../../src/server/game/riding/native';
import {practiceRoomState} from '../../src/shared/engine/core/practiceRoomState';
import {carriedRound,carriedRoundDue,carriedRoundFrame,carriedRoundOutputs,carriedRoundHome,
  carriedRoundGoal,carriedRoundCarrying} from '../../src/shared/game/quest/carriedRound';
import {prepareHeadlessRuntime as prepareNalati} from './nalati-verbs';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Dedicated proof variant: ordinary camp/taming consumers keep their installs. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=async preparation=>{
  const base=await prepareNalati(preparation),rows=parseCarriedQuest(await preparation.product.json('quests/carried.json'));
  return {...base,install:(host,context)=>{base.install(host,context);installNalatiKokpar(host,context,rows);}};
};

const finite=v.pipe(v.number(),v.finite());
const Saved=v.strictObject({state:v.record(v.string(),finite),at:v.strictObject({x:finite,z:finite}),
  pending:v.pipe(finite,v.minValue(0)),events:v.pipe(v.array(v.number()),v.maxLength(1024)),
  stings:v.pipe(v.array(v.string()),v.maxLength(1024))});

/** The admitted round reads the actual rider and commits only its own selected
 * event rows. There is deliberately no input for win, carry, score or flags. */
export function installNalatiKokpar(host:SimHost,context:Pick<HeadlessRuntimeInstallation,'emit'>,rows:CarriedQuestRows):void {
  const mount=mountedPlayerOf(host);
  if(mount===undefined||rows.carrier?.kind==='player')throw new Error('Nalati Kokpar requires its native mounted owner');
  if(!host.quests.some(quest=>quest.def.id===rows.quest))throw new Error('Kokpar requires its actual chapter owner');
  for(const effect of [...rows.warning,...rows.events.flatMap(row=>row.effects)]){
    if(effect.kind!=='flag'&&effect.kind!=='sting'&&effect.kind!=='toast')throw new Error('Unsupported native Kokpar service');
    if(effect.kind==='toast'&&(effect.when!==undefined||effect.counter!==undefined||effect.progress!==undefined))
      throw new Error('Kokpar notice requires an unbound presentation service');
  }
  const brain=ReturnProgram.native(host,rows.program),round=carriedRound(rows),events:number[]=[],stings:string[]=[];
  const commit=(effects:CarriedQuestRows['warning']):void=>{
    for(const effect of effects){
      if(effect.kind==='flag')commitQuestEffects(host,rows.quest,[effect]);
      else if(effect.kind==='toast')context.emit({kind:'hint',text:effect.text});
      else if(effect.kind==='sting')stings.push(effect.name);
      else throw new Error('Unbound native Kokpar effect');
    }
    if(stings.length>1024)throw new Error('Kokpar sting observations exceed the native bound');
  };
  host.onStep('nalati.kokpar',dt=>{
    if(mountedPlayerOf(host)!==mount)throw new Error('Kokpar mounted owner changed');
    const elapsed=carriedRoundDue(rows,round,dt);if(elapsed===null)return;
    const player=leadPlayer(host).position,carrier=mount.horse;
    const output=brain.project(rows.signals.step,carriedRoundFrame(rows,round,elapsed,{
      playerX:player.x,playerZ:player.z,mounted:mount.mounted,carrier:carrier!==null,
      fast:mount.body.gait==='canter'||mount.body.gait==='gallop',practice:practiceRoomState.open,
      carrierX:carrier?.position.x??0,carrierZ:carrier?.position.z??0,
    }));
    const step=carriedRoundOutputs(rows,round,output);
    if(step.warning)commit(rows.warning);
    if(step.reset)carriedRoundHome(rows,round);
    if(step.event>0){
      const action=rows.events.find(row=>row.value===step.event);if(action===undefined)throw new Error('Missing actual Kokpar event');
      events.push(step.event);if(events.length>1024)throw new Error('Kokpar events exceed the native bound');commit(action.effects);
    }
    carriedRoundGoal(rows,round,output);
  },{snapshot:()=>({state:{...round.state},at:{...round.at},pending:round.pending,events:[...events],stings:[...stings],
    carrying:carriedRoundCarrying(rows,round)}),restore:value=>{
    const saved=v.parse(v.object({...Saved.entries,carrying:v.boolean()}),value);
    if(Object.keys(saved.state).sort().join('\0')!==Object.keys(round.state).sort().join('\0')
      ||saved.events.some(event=>!rows.events.some(row=>row.value===event))
      ||saved.carrying!==((saved.state[rows.outputs.carrying]??0)!==0))throw new Error('Kokpar continuation differs from admitted round');
    Object.assign(round.state,saved.state);Object.assign(round.at,saved.at);round.pending=saved.pending;
    events.splice(0,events.length,...saved.events);stings.splice(0,stings.length,...saved.stings);
  }},'afterBodies');
}
