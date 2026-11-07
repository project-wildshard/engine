import {expect,test} from 'vitest';
import {Flags} from '@wildshard/engine/world/interact/flags';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import type {SimHost} from '@wildshard/engine/sim';
import {presentQuestEffect,type QuestPresentationPorts} from '../src/shared/game/quest/effectPresentation';
import {commitQuestEffects} from '../src/shared/game/quest/effects';

function fixture(){
  const flags=new Flags('unplayed-presentation',false),events:unknown[]=[];
  const ports:QuestPresentationPorts={observe:source=>'flag' in source?Number(flags.has(source.flag)):0,
    toast:text=>{events.push(text);},sting:name=>{events.push({sting:name});},reading:row=>{events.push(structuredClone(row));}};
  return {flags,events,ports};
}
test('presentation retains original conditional reads, progress, counters and complete reading rows',()=>{
  const {flags,events,ports}=fixture();
  presentQuestEffect({kind:'toast',text:'hidden',when:{flag:'ready'}},flags,ports);expect(events).toEqual([]);
  flags.set('ready');flags.set('clue:1');
  presentQuestEffect({kind:'toast',text:'Carving',when:{flag:'ready'},progress:{flags:['clue:1','clue:2'],complete:'Complete'}},flags,ports);
  flags.set('clue:2');presentQuestEffect({kind:'toast',text:'Carving',progress:{flags:['clue:1','clue:2'],complete:'Complete'}},flags,ports);
  presentQuestEffect({kind:'toast',text:'Found',counter:{prefix:'clue:',of:3}},flags,ports);
  const reading={kind:'reading' as const,title:'Carving',lines:['one','two']};presentQuestEffect(reading,flags,ports);
  expect(events).toEqual(['Carving · 1/2','Complete','Found · 2 / 3',reading]);expect(flags.all).toEqual(['ready','clue:1','clue:2']);
});
test('native presentation is opt-in and preserves the original effect order and default refusal',()=>{
  const {flags,events,ports}=fixture(),host=legacyDouble<SimHost>({flags});
  expect(()=>commitQuestEffects(host,'unplayed',[{kind:'toast',text:'Carving'},{kind:'flag',flag:'clue:1'}])).toThrow('page host');
  expect(flags.has('clue:1')).toBe(false);
  const original=ports.toast;
  const entered={...ports,toast:(text:string)=>{events.push({before:flags.has('clue:1')});original(text);}};
  commitQuestEffects(host,'unplayed',[{kind:'toast',text:'Carving'},{kind:'reading',title:'Stone',lines:['all original text']},{kind:'flag',flag:'clue:1'}],entered);
  expect(events).toEqual([{before:false},'Carving',{kind:'reading',title:'Stone',lines:['all original text']}]);expect(flags.has('clue:1')).toBe(true);
  expect(()=>commitQuestEffects(host,'unplayed',[{kind:'toast',text:'refused'},{kind:'flag',flag:'after-failed'}],
    {...ports,toast:()=>{throw new Error('entered presentation refused');}})).toThrow('entered presentation refused');
  expect(flags.has('after-failed')).toBe(false);
});
