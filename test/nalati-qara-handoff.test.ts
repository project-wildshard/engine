import {expect,test} from 'vitest';
import {checkQaraLedger,qaraCommandHash,qaraObservationHash,type QaraPart} from './fixtures/headless/qaraHandoff';

function parts(count:number,ticks=1,commands=0,ownerBytes=0):QaraPart[]{
  return Array.from({length:count},(_,index)=>({plan:{version:1,observe:['nalati.patrol','nalati.qara','nalati.weapons'],
    segments:[{id:`fight-${index}`,ticks,commands:[],frames:Array.from({length:ticks},()=>Array.from({length:commands},()=>({kind:'script' as const,actorId:'input',value:1})))}]},
    expected:{version:1,ticks,observations:[{id:`fight-${index}`,tick:900+(index+1)*ticks,position:[0,0,0],peakY:0,grounded:true,flags:[],quests:[],effects:[],
      adapters:[{id:'native',state:'x'.repeat(ownerBytes)}]}]}}));
}
function entry<T>(rows:readonly T[],index:number):T{
  const row=rows[index];if(row===undefined)throw new Error('Missing input');return row;
}
test('earned children retain one combined part, tick, command and byte allowance',()=>{
  expect(()=>checkQaraLedger([],900,0)).not.toThrow();
  expect(()=>checkQaraLedger(parts(128),900,128)).not.toThrow();
  expect(()=>checkQaraLedger(parts(129),900,129)).toThrow('part allowance');
  expect(()=>checkQaraLedger(parts(64,1,512),900,64)).not.toThrow();
  expect(()=>checkQaraLedger(parts(128,1,512),900,128)).toThrow('aggregate tape');
  expect(()=>checkQaraLedger(parts(118,512),900,118*512)).toThrow('aggregate tape');
  expect(()=>checkQaraLedger(parts(9,1,0,500_000),900,9)).not.toThrow();
  expect(()=>checkQaraLedger(parts(18,1,0,500_000),900,18)).toThrow('aggregate tape');
});
test('the combined handoff cannot omit, reorder or relabel an interval',()=>{
  const gap=parts(2);entry(entry(gap,1).expected.observations,0).tick++;
  expect(()=>checkQaraLedger(gap,900,2)).toThrow('skipped');
  expect(()=>checkQaraLedger(parts(2).reverse(),900,2)).toThrow('ordered');
  const selection=parts(2);entry(selection,1).plan.observe.pop();
  expect(()=>checkQaraLedger(selection,900,2)).toThrow('ordered');
  const missing=parts(2);entry(entry(missing,1).plan.segments,0).frames?.pop();
  expect(()=>checkQaraLedger(missing,900,2)).toThrow('ordered');
  expect(()=>checkQaraLedger(parts(2),900,1)).toThrow('captured ticks');
});

test('an additional earned boundary retains every original observation, ordered effect and peak',()=>{
  const original=entry(entry(parts(1,512),0).expected.observations,0);
  const effect={kind:'hint' as const,text:'earned'};
  original.effects=[effect];original.peakY=8;
  const prefix={...original,id:'unlock',tick:1000,peakY:8,effects:[effect]},suffix={...original,id:'continued',peakY:2,effects:[]};
  expect(qaraObservationHash([prefix,suffix],900)).toBe(qaraObservationHash([original],900));
  expect(qaraObservationHash([prefix,{...suffix,position:[1,0,0]}],900)).not.toBe(qaraObservationHash([original],900));
});

test('input equivalence distinguishes negative zero at an earned boundary',()=>{
  const original=parts(1,1,1),changed=structuredClone(original),command=entry(entry(entry(changed,0).plan.segments,0).frames??[],0)[0];
  if(command?.kind!=='script')throw new Error('Missing actual input');
  command.value=-0;
  const positive=structuredClone(changed),same=entry(entry(entry(positive,0).plan.segments,0).frames??[],0)[0];
  if(same?.kind!=='script')throw new Error('Missing positive input');
  same.value=0;
  expect(qaraCommandHash(changed)).not.toBe(qaraCommandHash(positive));
});
