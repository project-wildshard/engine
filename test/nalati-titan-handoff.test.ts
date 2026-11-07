import {expect,test} from 'vitest';
import * as v from 'valibot';
import {checkTitanLedger,TitanHandoffSchema,TitanBowCursorSchema,titanInputDigest,titanObservationDigest,type TitanPart} from './fixtures/headless/titanHandoff';

function parts(count:number,ticks=1,commands=0,ownerBytes=0):TitanPart[]{
  return Array.from({length:count},(_,index)=>({plan:{version:1,observe:['nalati.titan','nalati.weapons','nalati.chapter-records'],
    segments:[{id:`titan-${index}`,ticks,commands:[],frames:Array.from({length:ticks},()=>Array.from({length:commands},()=>({kind:'script' as const,actorId:'input',value:1})))}]},
    expected:{version:1,ticks,observations:[{id:`titan-${index}`,tick:900+(index+1)*ticks,position:[0,0,0],peakY:0,grounded:true,flags:[],quests:[],effects:[],
      adapters:[{id:'native',state:'x'.repeat(ownerBytes)}]}]},digest:'a'.repeat(64)}));
}

test('the earned prefix remains charged when a second case continues it',()=>{
  const prefix=parts(64),whole=parts(128);
  expect(()=>checkTitanLedger(prefix,900)).not.toThrow();
  expect(()=>checkTitanLedger(whole,900)).not.toThrow();
  expect(()=>checkTitanLedger(parts(129),900)).toThrow('part allowance');
  // Each half alone fits. Their combined commands, fixed ticks and actual
  // observation bytes must fit the original single tape, not two budgets.
  expect(()=>checkTitanLedger(parts(64,1,512),900)).not.toThrow();
  expect(()=>checkTitanLedger(parts(128,1,512),900)).toThrow('aggregate tape');
  expect(()=>checkTitanLedger(parts(118,512),900)).toThrow('aggregate tape');
  expect(()=>checkTitanLedger(parts(9,1,0,500_000),900)).not.toThrow();
  expect(()=>checkTitanLedger(parts(18,1,0,500_000),900)).toThrow('aggregate tape');
});

function entry<T>(rows:readonly T[],index:number):T{
  const value=rows[index];if(value===undefined)throw new Error('Missing test input');return value;
}

test('a handoff cannot omit, reorder or relabel the checked input intervals',()=>{
  const gap=parts(2);entry(entry(gap,1).expected.observations,0).tick++;
  expect(()=>checkTitanLedger(gap,900)).toThrow('skipped');
  const reordered=parts(2).reverse();
  expect(()=>checkTitanLedger(reordered,900)).toThrow('ordered');
  const selection=parts(2);entry(selection,1).plan.observe.pop();
  expect(()=>checkTitanLedger(selection,900)).toThrow('ordered');
  const truncated=parts(2);entry(entry(truncated,1).plan.segments,0).frames?.pop();
  expect(()=>checkTitanLedger(truncated,900)).toThrow('ordered');
});

test('only the checked pre-combat storm handoff may have an empty combat ledger',()=>{
  const common={version:1,source:'a'.repeat(64),snapshot:'actual-wire',digest:'b'.repeat(64),checkpointTick:900,captureTicks:900,initialKills:0,deaths:[]};
  expect(()=>v.parse(TitanHandoffSchema,{...common,stage:'storm',parts:[]})).not.toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...common,stage:'storm',captureTicks:901,parts:[]})).toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...common,stage:'storm',captureTicks:901,parts:parts(1)})).toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...common,stage:'fire',parts:[]})).toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...common,stage:'fire',captureTicks:901,parts:parts(1)})).not.toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...common,stage:'fire',captureTicks:902,parts:parts(1)})).toThrow();
});

test('the retry carries an earned death and the unreset bounded controller cursor',()=>{
  const cursor={tick:241,lastShots:24,lastDodge:true,currentAim:{yaw:.2,pitch:.3,flight:1.5}};
  expect(v.parse(TitanBowCursorSchema,cursor)).toEqual(cursor);
  for(const tick of [0,240,9601])expect(()=>v.parse(TitanBowCursorSchema,{...cursor,tick})).toThrow();
  const handoff={version:1,source:'a'.repeat(64),snapshot:'actual-wire',digest:'b'.repeat(64),checkpointTick:900,captureTicks:1924,initialKills:0,
    stage:'retry',fireTick:1412,parts:parts(2,512),deaths:[{tick:1924,phase:2,checkpoint:true}],cursor};
  expect(()=>v.parse(TitanHandoffSchema,handoff)).not.toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...handoff,deaths:[]})).toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...handoff,deaths:[{tick:1924,phase:1,checkpoint:true}]})).toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...handoff,cursor:undefined})).toThrow();
  expect(()=>v.parse(TitanHandoffSchema,{...handoff,deaths:[{tick:1925,phase:2,checkpoint:true}]})).toThrow();
});

test('a checked extra handoff preserves the original input and observation fences',()=>{
  const whole=parts(1,512),split=parts(2,256);
  const first=entry(entry(split,0).expected.observations,0),last=entry(entry(split,1).expected.observations,0),end=entry(entry(whole,0).expected.observations,0);
  first.peakY=12;first.effects=[{kind:'hint',text:'before'}];
  last.peakY=4;last.effects=[{kind:'hint',text:'after'}];
  end.peakY=12;end.effects=[...first.effects,...last.effects];
  expect(titanInputDigest(split,900)).toBe(titanInputDigest(whole,900));
  expect(titanObservationDigest(split,900)).toBe(titanObservationDigest(whole,900));
  last.effects.reverse();last.flags.push('different');
  expect(titanObservationDigest(split,900)).not.toBe(titanObservationDigest(whole,900));
});

test('input integrity uses the worker command codec, preserving values and array order',()=>{
  const first=parts(1),second=parts(1);
  const a=entry(entry(first,0).plan.segments,0),b=entry(entry(second,0).plan.segments,0);
  a.frames=[[{kind:'script',actorId:'input',value:1}]];
  b.frames=[[{value:1,actorId:'input',kind:'script'}]];
  expect(titanInputDigest(first,900)).toBe(titanInputDigest(second,900));
  b.frames=[[{value:2,actorId:'input',kind:'script'}]];
  expect(titanInputDigest(first,900)).not.toBe(titanInputDigest(second,900));
  a.frames=[[{kind:'script',actorId:'input',value:1},{kind:'script',actorId:'input',value:2}]];
  b.frames=[[{kind:'script',actorId:'input',value:2},{kind:'script',actorId:'input',value:1}]];
  expect(titanInputDigest(first,900)).not.toBe(titanInputDigest(second,900));
});
