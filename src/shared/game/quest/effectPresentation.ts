import type {Flags} from '@wildshard/engine/world/interact/flags';
import type {ObservationRef} from '@wildshard/format/sceneRefs';
import type {QuestStepEffect} from './steps';

export type QuestPresentationEffect=Extract<QuestStepEffect,{kind:'toast'|'sting'|'reading'}>;
/** Entered presentation loans; only the quest commit owns gameplay effects. */
export interface QuestPresentationPorts {
  readonly observe:(source:ObservationRef)=>number;
  readonly toast:(text:string)=>void;
  readonly sting:(name:Extract<QuestPresentationEffect,{kind:'sting'}>['name'])=>void;
  readonly reading:(effect:Extract<QuestPresentationEffect,{kind:'reading'}>)=>void;
}
/** The page's original ordered formatting and conditional reads, shared by
 * renderer-free native presentation. No flag, inventory or clock is written. */
export function presentQuestEffect(effect:QuestPresentationEffect,flags:Pick<Flags,'has'|'count'>,ports:QuestPresentationPorts):void {
  if(effect.kind==='toast'&&effect.when!==undefined&&ports.observe(effect.when)===0)return;
  if(effect.kind==='reading')ports.reading(effect);
  else if(effect.kind==='sting')ports.sting(effect.name);
  else if(effect.progress!==undefined){
    const progress=effect.progress,count=progress.flags.filter(flag=>flags.has(flag)).length;
    ports.toast(count===progress.flags.length?progress.complete:`${effect.text} · ${String(count)}/${String(progress.flags.length)}`);
  }else ports.toast(effect.counter===undefined?effect.text:`${effect.text} · ${String(flags.count(effect.counter.prefix))} / ${String(effect.counter.of)}`);
}
