// oxlint-disable-next-line import/no-nodejs-modules -- The native restore guard uses the original checked-in physics bytes.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {TradeHandoffSchema,tradeWire,tradeRead,tradeHash,checkTradeLedger,checkTradeHandoff,type TradePart,type TradeHandoff} from './fixtures/headless/tradeHandoff';
import {retainRestoredWalkBodies} from './fixtures/headless/ropeBodies';
import {createSimHost} from '../src/server/engine/sim';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import * as v from 'valibot';

function part(tick=1):TradePart {
  return {plan:{version:1,observe:[],segments:[{id:`part-${tick}`,ticks:1,commands:[],frames:[[]]}]},
    expected:{version:1,ticks:1,observations:[{id:`part-${tick}`,tick,position:[0,0,0],peakY:0,grounded:true,flags:[],quests:[],effects:[],adapters:[]}]},
    metadata:'a'.repeat(64),physics:'b'.repeat(64),positive:tradeHash('positive'),negative:tradeHash('negative')};
}
function saved():TradeHandoff {return {version:1,stage:'counter',source:'c'.repeat(64),tick:1,snapshot:'recorder',positive:'positive',negative:'negative',omitted:2,identicalPhysics:2,canonicalPhysics:0,parts:[part()]};}

test('earned handoffs bind the product, preceding stage, checked saves and complete ordered intervals',()=>{
  const original=saved(),wire=tradeWire(original),parsed=v.parse(TradeHandoffSchema,tradeRead(wire));
  checkTradeHandoff(parsed,original.source,'counter');expect(tradeHash(tradeWire(parsed,true))).toBe(tradeHash(tradeWire(original,true)));
  expect(()=>checkTradeHandoff(parsed,'d'.repeat(64),'counter')).toThrow('product');
  expect(()=>checkTradeHandoff(parsed,original.source,'purse')).toThrow('stage');
  expect(()=>checkTradeHandoff({...parsed,positive:'edited'},original.source,'counter')).toThrow('checked saves');
  expect(()=>checkTradeHandoff({...parsed,identicalPhysics:0},original.source,'counter')).toThrow('native comparisons');
  const ordered=[part(1),part(2)];checkTradeLedger(ordered,2);
  expect(()=>checkTradeLedger([...ordered].reverse(),2)).toThrow('interval');
  expect(()=>checkTradeLedger(ordered.slice(1),2)).toThrow('interval');
  expect(()=>checkTradeLedger(ordered,1)).toThrow('tick');
});

test('a child grants no new tick, command, part or observation allowance',()=>{
  expect(()=>checkTradeLedger(Array.from({length:129},(_,i)=>part(i+1)),129)).toThrow('part allowance');
  const large=part();const segment=large.plan.segments[0],observation=large.expected.observations[0];
  if(segment===undefined||observation===undefined)throw new Error('Missing control interval');
  segment.ticks=512;segment.frames=Array.from({length:512},()=>[]);large.expected.ticks=512;observation.tick=512;
  const commands=Array.from({length:512},()=>Array.from({length:118},()=>({kind:'script' as const,actorId:'real-owner',value:0})));
  segment.frames=commands;expect(()=>checkTradeLedger([large],512)).toThrow('aggregate');
  segment.frames=Array.from({length:512},()=>[]);
  const heavy=Array.from({length:1024},()=>({kind:'hint' as const,text:'x'.repeat(4096)}));
  const a=part(1),b=part(2);const left=a.expected.observations[0],right=b.expected.observations[0];
  if(left===undefined||right===undefined)throw new Error('Missing observation control');
  left.effects=heavy;right.effects=heavy;expect(()=>checkTradeLedger([a,b],2)).toThrow('aggregate');
  const intervals=Array.from({length:59},(_,i)=>({...large,expected:{...large.expected,observations:[{...observation,tick:(i+1)*512}]}}));
  expect(()=>checkTradeLedger(intervals,59*512)).toThrow('aggregate');
  segment.ticks=513;expect(()=>checkTradeLedger([large],513)).toThrow('interval');
});

test('the ledger preserves every signed-zero command and refuses reserved number markers',()=>{
  const commands=[{kind:'player',moveX:-0,moveZ:0,yaw:-0}],wire=tradeWire({commands,values:[Infinity,-Infinity]});
  expect(tradeRead(wire)).toEqual({commands,values:[Infinity,-Infinity]});
  expect(tradeHash(tradeWire(commands,true))).not.toBe(tradeHash(tradeWire([{...commands[0],moveX:0}],true)));
  expect(()=>tradeWire({'trade.number':'-0'})).toThrow('Reserved');
  expect(()=>tradeRead('{"trade.number":"NaN"}')).toThrow('Invalid');
});

test('retaining existing walk bodies requires the actual native restore transaction',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm')),first=createSimHost(SIM_LEVEL,{rapier});
  let restored:ReturnType<typeof createSimHost>|undefined;
  try{
    expect(()=>retainRestoredWalkBodies(first)).toThrow('restore transaction');
    restored=restoreSimHost(SIM_LEVEL,{rapier},snapshotSimHostBytes(first),host=>{retainRestoredWalkBodies(host);});
    expect(()=>{if(restored===undefined)throw new Error('Missing restore');retainRestoredWalkBodies(restored);}).toThrow('restore transaction');
  }finally{restored?.dispose();first.dispose();}
});
