import { expect,test } from 'vitest';
import { prepareV2Observations,type V2BindingInput,type V2ObservationBatch } from './observationsV2';
import { layoutV2,writeV2Frame,validateV2Frame } from '@wildshard/format/scriptWireV2';

const tick = 2**30+3, layout = layoutV2(1024,1,new Map([[1,2],[2,4],[3,4],[4,4],[5,2],[6,4],[7,2],[8,3],[9,3]]));
function binding(identity: string,handle: number): V2BindingInput {
  return { identity,handle,self: 10,player: 11,observed: new Set([10,11]),enabled: true,due: true,divisor: 6,fuel: 1000,previousTick: tick-6,currentTick: tick,
    state: [2**40+.125,-0],parameters: [{ name: 'z',value: 2 },{ name: 'a',value: 1 }],fields: [{ name: 'z',id: 2 },{ name: 'a',id: 1,value: -0 }],
    sample: { atTick: tick-1,target: 0,pose: { x: 1,y: 2,z: 3,yaw: .2 },hpShare: .5,groundY: -2,walk: { x: 3,z: 4 },lineOfSight: false },
  };
}
function batch(): V2ObservationBatch {
  return { bindings: [binding('b',2),{ ...binding('a',7),state: [],parameters: [],fields: [],due: false }],
    players: [{ identity: 'z',handle: 11,atTick: tick-1,pose: { x: 5,y: 6,z: 7,yaw: 8 },hpShare: 1,forward: { x: 0,z: 1 },walkIntent: .5 },{ identity: 'a',handle: 12,atTick: tick-2 }],
    actions: new Set([2]),eventKinds: new Set([3]),edges: [
      { player: 11,action: 2,atTick: tick-1,sequence: 1,phase: 2,x: -0,y: 0 },{ player: 11,action: 2,atTick: tick-4,sequence: 2,phase: 1,x: 1,y: -1 },
    ],events: [
      { binding: 'b',kind: 3,subject: 10,player: 11,atTick: tick-1,sequence: 1,values: [1,2,3,4] },{ binding: 'a',kind: 3,subject: 10,player: 0,atTick: tick-1,sequence: 1,values: [5,6,7,8] },
    ],
  };
}
function at(kind: number,index = 0): number { const region = layout.regions[kind-1];if (region === undefined) throw new Error('Missing fixture region');return 1024+region.offset+index*region.stride; }

test('host observations sort stable identities and 60 Hz stamps independently of transient handles', () => {
  const input = batch(), prepared = prepareV2Observations(layout,tick,input), view = new DataView(new ArrayBuffer(65536));
  expect(prepared.bindings).toEqual([{ identity: 'a',handle: 7 },{ identity: 'b',handle: 2 }]);expect(prepared.due).toBe(1);
  const authority = writeV2Frame(view,layout,{ lane: 1,module: 1,sequence: 1,tick,due: prepared.due },prepared.counts);prepared.write(view);expect(() => validateV2Frame(view,layout,authority)).not.toThrow();
  expect(view.getUint32(at(1),true)).toBe(7);expect(view.getUint32(at(1,1),true)).toBe(2);expect(view.getInt32(at(1)+48,true)).toBe(-3);expect(view.getInt32(at(1)+52,true)).toBe(3);
  expect(view.getUint32(at(1,1)+16,true)).toBe(0);expect(view.getUint32(at(1,1)+20,true)).toBe(2);expect(view.getFloat64(at(2),true)).toBe(2**40+.125);expect(Object.is(view.getFloat64(at(2,1),true),-0)).toBe(true);
  expect([view.getFloat64(at(4),true),view.getFloat64(at(4,1),true)]).toEqual([1,2]);expect(view.getUint32(at(6),true)).toBe(1);expect(Object.is(view.getFloat64(at(6)+8,true),-0)).toBe(true);expect(view.getUint32(at(6,1)+4,true)).toBe(0);expect(view.getFloat64(at(6,1)+8,true)).toBe(0);
  expect(view.getUint32(at(5)+12,true)).toBe(31);expect(view.getUint32(at(5)+20,true)).toBe(0);expect(view.getFloat64(at(5)+88,true)).toBe(0);
  expect(view.getUint32(at(7),true)).toBe(12);expect(view.getUint32(at(7)+4,true)).toBe(0);expect(view.getFloat64(at(7)+16,true)).toBe(0);expect(view.getUint32(at(7)+12,true)).toBe(0);
  expect(view.getInt32(at(8)+8,true)).toBe(-1);expect(view.getInt32(at(8,1)+8,true)).toBe(2);expect(view.getUint32(at(9)+4,true)).toBe(7);expect(view.getUint32(at(9,1)+4,true)).toBe(2);
});
test('a prepared observation block is an immutable snapshot reusable after a rejected module call', () => {
  const values = [4,-0], pose = { x: 1,y: 2,z: 3,yaw: 4 }, input = { ...batch(),events: [],bindings: [{ ...binding('b',2),state: values,sample: { atTick: tick,target: 10,pose } }] };
  const prepared = prepareV2Observations(layout,tick,input);values[0] = 99;pose.x = 99;
  const view = new DataView(new ArrayBuffer(65536));prepared.write(view);expect(view.getFloat64(at(2),true)).toBe(4);expect(view.getFloat64(at(5)+24,true)).toBe(1);
  new Uint8Array(view.buffer).fill(0xa5);prepared.write(view);expect(Object.is(view.getFloat64(at(2,1),true),-0)).toBe(true);expect(view.getFloat64(at(5)+24,true)).toBe(1);
});
test('invalid observations refuse before touching guest memory, including stale players, domains and ring overflow', () => {
  const base = batch(), row = binding('b',2), view = new DataView(new ArrayBuffer(65536)), sentinel = new Uint8Array(view.buffer);sentinel.fill(0xa5);
  const invalid: V2ObservationBatch[] = [
    { ...base,bindings: [row,row] },{ ...base,bindings: [row,{ ...row,identity: 'c' }] },{ ...base,bindings: [{ ...row,self: 99 }] },{ ...base,bindings: [{ ...row,player: 10 }] },
    { ...base,bindings: [{ ...row,due: true,enabled: false }] },{ ...base,bindings: [{ ...row,currentTick: tick-7 }] },{ ...base,bindings: [{ ...row,sample: { ...row.sample,atTick: tick+1 } }] },
    { ...base,bindings: [{ ...row,state: [Number.NaN] }] },{ ...base,bindings: [{ ...row,sample: { ...row.sample,hpShare: 2 } }] },{ ...base,bindings: [{ ...row,parameters: [{ name: 'a',value: 1 },{ name: 'a',value: 2 }] }] },
    { ...base,bindings: [{ ...row,fields: [{ name: 'a',id: 1 },{ name: 'b',id: 1 }] }] },{ ...base,bindings: [{ ...row,state: [1,2,3,4,5] }] },
    { ...base,players: [{ identity: 'z',handle: 11,atTick: tick+1 }] },{ ...base,players: [{ identity: 'z',handle: 11,atTick: tick,walkIntent: Infinity }] },
    { ...base,edges: [{ player: 99,action: 2,atTick: tick,sequence: 1,phase: 1,x: 0,y: 0 }] },{ ...base,edges: [{ player: 11,action: 3,atTick: tick,sequence: 1,phase: 1,x: 0,y: 0 }] },
    { ...base,edges: Array.from({ length: 4 },(_,sequence) => ({ player: 11,action: 2,atTick: tick,sequence,phase: 1 as const,x: 0,y: 0 })) },
    { ...base,events: [{ binding: 'unknown',kind: 3,subject: 10,player: 0,atTick: tick,sequence: 1,values: [0,0,0,0] }] },{ ...base,events: [{ binding: 'b',kind: 3,subject: 99,player: 0,atTick: tick,sequence: 1,values: [0,0,0,0] }] },
  ];
  for (const input of invalid) { expect(() => prepareV2Observations(layout,tick,input).write(view)).toThrow();expect(sentinel.every(value => value === 0xa5)).toBe(true); }
});
