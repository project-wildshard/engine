import {expect,test} from 'vitest';
import * as v from 'valibot';
import {ChapterHandoffSchema,ChapterPartSchema,chapterObserved,chapterTwoObserved,chapterWire,chapterRead,chapterWireHash,chapterInputHash,checkChapterLedger,type ChapterPart} from './fixtures/headless/chapterHandoff';
import {PACKED_CHAPTER_TAMING,packChapterTaming} from './fixtures/headless/chapterObservation';
import {packChapterReport,unpackChapterReport,chapterReportUsesCodec} from './fixtures/headless/chapterReportCodec';
import type {HeadlessCommand} from '../src/shared/host/tickProtocol';

const idle:HeadlessCommand={kind:'player',moveX:0,moveZ:0,yaw:0};
/** Data-only admission controls; these invented intervals are never played. */
function part(index:number,ticks=1,commands:HeadlessCommand[]=[]):ChapterPart {
  return {plan:{version:1,observe:[...chapterObserved],segments:[{id:`chapter-${index}`,ticks,commands:[],frames:Array.from({length:ticks},()=>commands)}]},
    expected:{version:1,ticks,observations:[{id:`chapter-${index}`,tick:(index+1)*ticks,position:[0,0,0],peakY:0,grounded:true,
      flags:[],quests:[],effects:[],adapters:[]}]},digest:chapterWireHash('unplayed unit interval')};
}

test('chapter handoffs retain signed-zero commands without accepting a foreign numeric marker',()=>{
  const original=part(0,1,[{...idle,moveX:-0}]),decoded=v.parse(v.array(ChapterPartSchema),chapterRead(chapterWire([original])));
  expect(chapterInputHash(decoded)).toBe(chapterInputHash([original]));
  expect(chapterInputHash(decoded)).not.toBe(chapterInputHash([part(0,1,[idle])]));
  expect(()=>v.parse(v.number(),chapterRead('{"chapter.number":"-0","foreign":1}'))).toThrow();
});
test('an approach continuation retains the original bond start instead of a new input allowance',()=>{
  const row={version:1,stage:'approach',source:chapterWireHash('unplayed'),tick:2,bondStart:1,snapshot:'unplayed',digest:chapterWireHash('unplayed'),parts:[part(0),part(1)]};
  expect(v.safeParse(ChapterHandoffSchema,row).success).toBe(true);
  for(const bondStart of [undefined,0,2,3])expect(v.safeParse(ChapterHandoffSchema,{...row,bondStart}).success).toBe(false);
  for(const stage of ['bond','return','home'])expect(v.safeParse(ChapterHandoffSchema,{...row,stage}).success).toBe(false);
});
test('an earned boundary must retain its exact interval and original observation owners',()=>{
  expect(()=>checkChapterLedger([part(0),part(1)],2)).not.toThrow();
  expect(()=>checkChapterLedger([part(0),part(1)],3)).toThrow(/actual tick/u);
  const skipped=part(0),observation=skipped.expected.observations[0];
  if(observation===undefined)throw new Error('Missing unplayed observation');observation.tick=2;
  expect(()=>checkChapterLedger([skipped],2)).toThrow(/skipped/u);
  const foreign=part(0);foreign.plan.observe=['foreign'];
  expect(()=>checkChapterLedger([foreign],1)).toThrow(/ordered input/u);
});
test('splitting across new workers never resets the combined command or tick allowance',()=>{
  const commands=Array.from({length:60},(_,index)=>part(index,512,[idle,idle,idle]));
  expect(()=>checkChapterLedger(commands.slice(0,30),30*512)).not.toThrow();
  expect(()=>checkChapterLedger(commands,60*512)).toThrow(/aggregate tape/u);
  expect(()=>checkChapterLedger(Array.from({length:128},(_,index)=>part(index,512)),128*512)).toThrow(/aggregate tape/u);
});
test('the combined part and serialized observation allowances remain bounded',()=>{
  expect(()=>checkChapterLedger(Array.from({length:129},(_,index)=>part(index)),129)).toThrow(/part allowance/u);
  const rows=Array.from({length:100},(_,index)=>{
    const row=part(index),observation=row.expected.observations[0];if(observation===undefined)throw new Error('Missing unplayed observation');
    observation.adapters=[{id:chapterObserved[0]??'missing',state:'x'.repeat(125_000)}];return row;
  });
  expect(()=>checkChapterLedger(rows,100)).toThrow(/aggregate tape/u);
});
test('later complete packed observations require the earned prefix and preserve one-way selection and all caps',()=>{
  const prefix=part(0),next=part(1),first=prefix.expected.observations[0],second=next.expected.observations[0];
  if(first===undefined||second===undefined)throw new Error('Missing unplayed boundary');
  next.plan.observe=[...chapterTwoObserved];second.adapters=[{id:PACKED_CHAPTER_TAMING,state:packChapterTaming({phase:'bonded',pose:[-0,1,2]})}];
  expect(()=>checkChapterLedger([prefix,next],2)).toThrow('earned');
  first.flags.push('quest:tulpar');second.flags.push('quest:tulpar');expect(()=>checkChapterLedger([prefix,next],2)).not.toThrow();
  expect(()=>checkChapterLedger([prefix,next,part(2)],3)).toThrow('observation selection');
  second.adapters[0]={id:PACKED_CHAPTER_TAMING,state:'bad'};expect(()=>checkChapterLedger([prefix,next],2)).toThrow();
});


function victoryReportParts():{parts:ChapterPart[];raw:ChapterPart} {
  const first=part(0),before=part(1),raw=part(2),a=first.expected.observations[0],b=before.expected.observations[0],c=raw.expected.observations[0];
  if(a===undefined||b===undefined||c===undefined)throw new Error('Missing unplayed report interval');
  a.flags=['quest:tulpar'];b.flags=['quest:tulpar','clue:1','clue:2','clue:3','entered:kurgan'];c.flags=[...b.flags];
  before.plan.observe=[...chapterTwoObserved];raw.plan.observe=[...chapterTwoObserved];
  const king={kind:'entered',core:{boss:{state:'beat',phase:2,checkpoint:2,saved:{defeated:false,rewardTaken:false,kills:0}}},pad:'unplayed'.repeat(1000),clock:0};
  b.adapters=[{id:PACKED_CHAPTER_TAMING,state:packChapterTaming({phase:'bonded',pose:[-0,1]})},{id:'nalati.king-closed',state:chapterWire(king)}];
  c.adapters=[structuredClone(b.adapters[0]),{id:'nalati.king-closed',state:chapterWire({...king,clock:1})}].filter(adapter=>adapter!==undefined);
  const next={...raw,expected:packChapterReport(raw.expected,before.expected)};
  if(!chapterReportUsesCodec(next.expected))throw new Error('Unplayed control did not exercise the codec');
  return {parts:[first,before,next],raw};
}

test('report deltas begin only after an actually earned raw King checkpoint',()=>{
  const {parts,raw}=victoryReportParts(),prefix=chapterWire(parts.slice(0,2)),inputs=chapterInputHash(parts);
  expect(()=>checkChapterLedger(parts,3)).toThrow('raw earned prefix');
  expect(()=>checkChapterLedger(parts,3,2)).not.toThrow();
  expect(chapterWire(parts.slice(0,2))).toBe(prefix);expect(chapterInputHash(parts)).toBe(inputs);
  expect(parts[2]?.expected).not.toEqual(raw.expected);
  for(const boundary of [0,3,4,Number.NaN,1.5])expect(()=>checkChapterLedger(parts,3,boundary)).toThrow();
});
test('report codec metadata cannot authorize an earlier stage or a missing King outcome',()=>{
  const {parts}=victoryReportParts();
  const value={version:1,stage:'king-victory',source:chapterWireHash('unplayed'),tick:3,snapshot:'unplayed',digest:chapterWireHash('unplayed'),reportStart:2,parts};
  expect(v.safeParse(ChapterHandoffSchema,value).success).toBe(true);
  expect(v.safeParse(ChapterHandoffSchema,{...value,stage:'king-home'}).success).toBe(true);
  for(const stage of ['home','carvings','king-entry','king-phase-one','king-phase-two'])expect(v.safeParse(ChapterHandoffSchema,{...value,stage}).success).toBe(false);
  const before=parts[1]?.expected.observations[0];if(before===undefined)throw new Error('Missing unplayed boundary');
  before.flags=before.flags.filter(flag=>flag!=='clue:3');expect(()=>checkChapterLedger(parts,3,2)).toThrow('earned King checkpoint');
});
test('an encoded prefix refuses even if a later report boundary is claimed',()=>{
  const {parts}=victoryReportParts(),before=parts[1],coded=parts[2];
  if(before===undefined||coded===undefined)throw new Error('Missing unplayed prefix');
  before.expected=structuredClone(coded.expected);expect(()=>checkChapterLedger(parts,3,2)).toThrow('raw earned prefix');
});

test('an elder continuation inherits the same raw prefix and expanded codec basis',()=>{
  const {parts,raw}=victoryReportParts(),prior=parts.at(-1);if(prior===undefined)throw new Error('Missing victory report');
  const previous=unpackChapterReport(prior.expected,parts[1]?.expected),next=structuredClone(raw);
  const segment=next.plan.segments[0];if(segment===undefined)throw new Error('Missing elder input interval');segment.id='chapter-3';
  const observation=next.expected.observations[0];if(observation===undefined)throw new Error('Missing elder report');
  observation.id='chapter-3';observation.tick=4;observation.flags.push('told:king');
  next.expected=packChapterReport(next.expected,previous);
  expect(()=>checkChapterLedger([...parts,next],4,2)).not.toThrow();
  expect(()=>unpackChapterReport(next.expected,prior.expected)).toThrow();
});
