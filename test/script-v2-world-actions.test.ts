import { expect,test,vi } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { ScriptModuleV2 } from '../src/shared/engine/script/moduleV2';
import { prepareV2Observations } from '../src/shared/engine/script/observationsV2';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { compileSimV2 } from '../src/sharddev/test/compileSimV2';
import { readV2WorldActions,V2_ACTION_OPS,type V2ActionBinding,type V2WorldAction } from '@wildshard/format/scriptActionsV2';
import { layoutV2,writeV2Frame,validateV2Frame,type V2FrameAuthority } from '@wildshard/format/scriptWireV2';
import { prepareV2WorldActions, type V2WorldActionLoan } from '../src/shared/game/shardfile/worldActionsV2';
import { applyV2WorldActions } from './fixtures/applyWorldActionsV2';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const layout = layoutV2(1024,1,new Map([[1,1],[4,1],[5,1],[10,4]]));
function at(index = 0): number { const region = layout.regions[9];if (region === undefined) throw new Error('Missing fixture action bank');return layout.io+region.offset+index*64; }
function binding(): V2ActionBinding {
  return { identity: 'orchard',handle: 7,targets: new Map([[11,{ identity: 'player',kind: 'player' }],[12,{ identity: 'mount',kind: 'mount' }],[13,{ identity: 'cells',kind: 'cell-field' }]]),
    operations: new Set([V2_ACTION_OPS.dismount,V2_ACTION_OPS.ignite,V2_ACTION_OPS.impulse]),maxCommands: 3,bounds: { coordinate: 2**42,velocity: 5 } };
}
function bindings(row = binding()): ReadonlyMap<number,V2ActionBinding> { return new Map([[7,row]]); }
function frame(view: DataView,iterations = 1): V2FrameAuthority {
  const prepared = prepareV2Observations(layout,6,{ bindings: [{ identity: 'orchard',handle: 7,self: 0,player: 0,observed: new Set(),enabled: true,due: true,divisor: 6,fuel: 100000,previousTick: 0,currentTick: 6,state: [],parameters: [{ name: 'iterations',value: iterations }],fields: [],sample: { atTick: 6,target: 0 } }],players: [],edges: [],events: [],actions: new Set(),eventKinds: new Set() });
  const authority = writeV2Frame(view,layout,{ lane: 1,module: 1,sequence: 1,tick: 6,due: 1 },prepared.counts);prepared.write(view);return authority;
}
function command(view: DataView,index: number,op: number,target: number,values: readonly number[],handle = 7): void {
  const start = at(index);new Uint8Array(view.buffer,start,64).fill(0);
  view.setUint32(start,handle,true);view.setUint32(start+4,op,true);view.setUint32(start+8,target,true);
  values.forEach((value,i) => view.setFloat64(start+16+i*8,value,true));
  view.setUint32(layout.io+128+9*24+16,index+1,true);view.setUint32(layout.io+56,index+1,true);
}
function bank(): DataView {
  const view = new DataView(new ArrayBuffer(65536));frame(view);
  command(view,0,23,12,[1]);command(view,1,24,13,[-0,2**40+.125]);command(view,2,14,11,[3,4,-0]);return view;
}
const expected: readonly V2WorldAction[] = [{ binding: 'orchard',target: 'mount',kind: 'dismount',thrown: true },{ binding: 'orchard',target: 'cells',kind: 'ignite',x: -0,z: 2**40+.125 },{ binding: 'orchard',target: 'player',kind: 'impulse',x: 3,y: 4,z: -0 }];

test('empty actions retain full binding validation and distinct frozen results',()=>{
  const view=new DataView(new ArrayBuffer(65536));
  const first=readV2WorldActions(view,layout,0,new Map()),second=readV2WorldActions(view,layout,0,new Map());
  expect(first).toEqual([]);expect(first).not.toBe(second);expect(Object.isFrozen(first)).toBe(true);
  expect(()=>readV2WorldActions(view,layout,0,bindings({...binding(),maxCommands:0}))).toThrow('binding');
  expect(()=>readV2WorldActions(view,layout,0,new Map([[7,binding()],[8,{...binding(),handle:8}]]))).toThrow('binding');
  let consumed=0;
  const declared=new Set([V2_ACTION_OPS.impulse]);
  Object.defineProperty(declared,Symbol.iterator,{*value(){consumed++;yield V2_ACTION_OPS.impulse;consumed++;yield 999;consumed++;}});
  expect(()=>readV2WorldActions(view,layout,0,bindings({...binding(),operations:declared}))).toThrow('binding');
  expect(consumed).toBe(3);
});
let compiled: Promise<Uint8Array> | undefined;
function bytes(): Promise<Uint8Array> {
  compiled ??= compileSimV2(`import * as ws from './sdk/as/wsV2';
export function onBinding():void{for(let i=0;i<i32(ws.parameter(0));i++){ws.dismount(12,true);ws.ignite(13,-0,1099511627776.125);ws.impulse(11,3,4,-0);}}`,{ io: layout.io,ioBytes: layout.bytes });return compiled;
}
async function guest(): Promise<ScriptModuleV2> { return new ScriptModuleV2(await bytes(),{ seed: [1,2],initFuel: 10000,ioBytes: layout.bytes,output: [] }); }

test('real v2 AS emits the fixed dismount/ignite/impulse bank, preserving order, f64 and signed zero', async () => {
  const code = await bytes();expect(WebAssembly.Module.imports(new WebAssembly.Module(new Uint8Array(code)))).toEqual([{ module: 'env',name: 'memory',kind: 'memory' }]);
  const module = await guest();let authority: V2FrameAuthority;
  const actions = module.step(6,400000,view => { authority = frame(view); },view => {
    const counts = validateV2Frame(view,layout,authority);return readV2WorldActions(view,layout,counts[9] ?? 0,bindings());
  }).value;
  expect(actions).toEqual(expected);expect(Object.is(actions[1]?.kind === 'ignite' ? actions[1].x : 1,-0)).toBe(true);
  expect(Object.isFrozen(actions)).toBe(true);expect(actions.every(Object.isFrozen)).toBe(true);
  const prior = actions[1];module.step(6,400000,view => { frame(view,0); },() => undefined);expect(prior).toEqual(expected[1]);
});

test('a real guest overflowing the action bank traps without publishing a prefix, and a retry is clean', async () => {
  const module = await guest();let read = 0;
  expect(() => module.step(6,400000,view => { frame(view,2); },() => { read++; })).toThrow(WebAssembly.RuntimeError);expect(read).toBe(0);
  expect(module.step(6,400000,view => { frame(view); },view => readV2WorldActions(view,layout,3,bindings())).value).toEqual(expected);
});

test('every malformed suffix refuses the whole bank before an earlier valid effect', () => {
  const scope = new Scope('actions'), effect = vi.fn<(velocity: Vector3) => void>();
  const loan: V2WorldActionLoan = { binding: 'orchard',target: 'player',scope,kind: 'page-player',owner: { impulse: effect } };
  try {
    const corruptions = [
      (view: DataView) => view.setUint32(at(1),99,true),
      (view: DataView) => view.setUint32(at(1)+4,999,true),
      (view: DataView) => view.setUint32(at(1)+8,99,true),
      (view: DataView) => view.setUint32(at(1)+8,11,true),
      (view: DataView) => view.setUint32(at(1)+12,1,true),
      (view: DataView) => view.setFloat64(at(1)+16,2**43,true),
      (view: DataView) => view.setFloat64(at(1)+24,Number.NaN,true),
      (view: DataView) => view.setFloat64(at(1)+32,1,true),
      (view: DataView) => view.setFloat64(at(1)+56,-0,true),
      (view: DataView) => view.setFloat64(at(2)+16,6,true),
      (view: DataView) => view.setFloat64(at(2)+48,1,true),
      (view: DataView) => view.setFloat64(at(0)+16,.5,true),
    ];
    for (const corrupt of corruptions) {
      const view = bank();corrupt(view);
      expect(() => { const actions = readV2WorldActions(view,layout,3,bindings());applyV2WorldActions(actions,[loan]); }).toThrow();
      expect(effect).not.toHaveBeenCalled();
    }
  } finally { scope.dispose(); }
});

test('binding declarations, per-binding quotas, missing capabilities and view-lane commands refuse', () => {
  const view = bank(), declared = binding();
  const invalid: V2ActionBinding[] = [
    { ...declared,maxCommands: 2 },{ ...declared,maxCommands: 33 },{ ...declared,maxCommands: 0 },
    { ...declared,handle: 8 },{ ...declared,identity: '' },{ ...declared,bounds: { coordinate: 1,velocity: 5 } },
    { ...declared,bounds: { coordinate: Infinity,velocity: 5 } },{ ...declared,bounds: { coordinate: 100,velocity: -1 } },
    { ...declared,operations: new Set([V2_ACTION_OPS.ignite]) },{ ...declared,targets: new Map() },
    { ...declared,targets: new Map([[11,{ identity: 'player',kind: 'player' }],[12,{ identity: 'player',kind: 'mount' }]]) },
  ];
  for (const row of invalid) expect(() => readV2WorldActions(view,layout,3,bindings(row))).toThrow();
  expect(() => readV2WorldActions(view,layout,3,new Map([[7,declared],[8,{ ...declared,handle: 8 }]]))).toThrow('binding');
  for (const count of [-1,.5,5,129]) expect(() => readV2WorldActions(view,layout,count,bindings())).toThrow('bank');
  const authority = writeV2Frame(view,layout,{ lane: 3,module: 1,sequence: 1,tick: 6,due: 0,dt: .01,alpha: 0,frame: 1 },new Map());
  command(view,0,23,12,[0]);expect(() => validateV2Frame(view,layout,authority)).toThrow('view cannot');
});

test('all owner loans preflight before effects, then dismount/ignite/impulse apply in emitted order', () => {
  const scope = new Scope('actions'), trace: unknown[] = [];let mounted = true;
  const loans: V2WorldActionLoan[] = [
    { binding: 'orchard',target: 'mount',scope,kind: 'mount',owner: { get mounted() { return mounted; },dismount: thrown => { trace.push(['dismount',thrown]);mounted = false; } } },
    { binding: 'orchard',target: 'cells',scope,kind: 'cell-field',owner: { activate: (x,z) => { trace.push(['ignite',mounted,x,z]); } } },
    { binding: 'orchard',target: 'player',scope,kind: 'page-player',owner: { impulse: vector => { trace.push(['impulse',mounted,...vector]); } } },
  ];
  try {
    expect(() => applyV2WorldActions(expected,loans.slice(0,2))).toThrow('Unowned');expect(trace).toEqual([]);
    const first = loans[0];if (first === undefined) throw new Error('Missing mount fixture');
    expect(() => applyV2WorldActions(expected,[...loans,first])).toThrow('Duplicate');expect(trace).toEqual([]);
    applyV2WorldActions(expected,loans);
    expect(trace).toEqual([['dismount',true],['ignite',false,-0,2**40+.125],['impulse',false,3,4,-0]]);
    const again = expected[0];if (again === undefined) throw new Error('Missing dismount fixture');applyV2WorldActions([again],loans);expect(trace).toHaveLength(3);
    expect(() => applyV2WorldActions([{ binding: 'orchard',target: 'cells',kind: 'impulse',x: 0,y: 0,z: 0 }],loans)).toThrow('Unowned');
    expect(() => applyV2WorldActions([{ binding: 'orchard',target: 'player',kind: 'impulse',x: Number.NaN,y: 0,z: 0 }],loans)).toThrow('Non-finite');
  } finally { scope.dispose(); }
});

test('ancestor retirement refuses all effects, and retirement during an earlier effect fences later effects', () => {
  const root = new Scope('root'), scope = root.child('entry'), blocker = root.child('blocker'), effect = vi.fn<(x: number,z: number) => void>();
  blocker.onDispose(() => undefined);
  const retire = root.disposeSteps();expect(retire.next().done).toBe(false);expect(scope.disposed).toBe(false);expect(scope.disposing).toBe(true);
  const action: V2WorldAction = { binding: 'a',target: 'cells',kind: 'ignite',x: 1,z: 2 };
  expect(() => applyV2WorldActions([action],[{ binding: 'a',target: 'cells',scope,kind: 'cell-field',owner: { activate: effect } }])).toThrow('Retired');expect(effect).not.toHaveBeenCalled();
  for (const _step of retire) { /* Finish the real sliced ancestor retirement. */ }
  const live = new Scope('live');let calls = 0;
  expect(() => applyV2WorldActions([action,action],[{ binding: 'a',target: 'cells',scope: live,kind: 'cell-field',owner: { activate: () => { calls++;live.dispose(); } } }])).toThrow('Retired');expect(calls).toBe(1);
});

test('native impulse uses the same owned SimHost without stepping clocks/RNG or borrowing a page player', async () => {
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const host = createSimHost({ ...SIM_LEVEL,quests: [] },{ rapier }), direct = createSimHost({ ...SIM_LEVEL,quests: [] },{ rapier });
  const foreign = new Scope('foreign'), effect = vi.fn<(x: number,z: number) => void>();
  try {
    const action: V2WorldAction = { binding: 'a',target: 'player',kind: 'impulse',x: 1,y: 2,z: 3 }, rng = host.rng.snapshot(), tick = host.state.tick;
    const loan: V2WorldActionLoan = { binding: 'a',target: 'player',scope: host.scope,kind: 'native-player',owner: host };
    applyV2WorldActions([action,action],[loan]);leadPlayer(direct).addImpulse(new Vector3(1,2,3));leadPlayer(direct).addImpulse(new Vector3(1,2,3));
    expect(leadPlayer(host).impulse).toEqual(leadPlayer(direct).impulse);expect(host.rng.snapshot()).toEqual(rng);expect(host.state.tick).toBe(tick);
    expect(() => applyV2WorldActions([action],[{ ...loan,scope: foreign }])).toThrow('Borrowed');
    const embedded = createSimHost({ ...SIM_LEVEL,entities: [],quests: [] },{ rapier,physics: host.physics,player: leadPlayer(host),events: host.events,clock: host.clock,combat: host.combat });
    try {
      expect(() => applyV2WorldActions([{ binding: 'a',target: 'cells',kind: 'ignite',x: 0,z: 0 },action],[{ binding: 'a',target: 'cells',scope: host.scope,kind: 'cell-field',owner: { activate: effect } },{ ...loan,scope: embedded.scope,owner: embedded }])).toThrow('Borrowed');
      expect(effect).not.toHaveBeenCalled();
    } finally { embedded.dispose(); }
  } finally { foreign.dispose();host.dispose();direct.dispose(); }
});


test('the module accepts exactly 128 commands with at most 32 for each declared binding', () => {
  const full = layoutV2(1024,1,new Map([[10,129]])), region = full.regions[9];
  if (region === undefined) throw new Error('Missing capacity fixture');
  const view = new DataView(new ArrayBuffer(65536)), declared = new Map<number,V2ActionBinding>();
  for (let index = 0; index < 128; index++) {
    const handle = Math.floor(index/32)+1, start = full.io+region.offset+index*64;
    declared.set(handle,{ ...binding(),identity: `binding.${handle}`,handle,maxCommands: 32 });
    view.setUint32(start,handle,true);view.setUint32(start+4,V2_ACTION_OPS.impulse,true);view.setUint32(start+8,11,true);
    view.setFloat64(start+16,3,true);view.setFloat64(start+24,4,true);
  }
  expect(readV2WorldActions(view,full,128,declared)).toHaveLength(128);
  view.setUint32(full.io+region.offset+32*64,1,true);
  expect(() => readV2WorldActions(view,full,128,declared)).toThrow('quota');
  expect(() => readV2WorldActions(view,full,129,declared)).toThrow('bank');
});


test('prepared world effects copy operands and can interleave only after every family validates', () => {
  const scope = new Scope('prepared'),trace: unknown[] = [];
  const action: { binding: string;target: string;kind: 'ignite';x: number;z: number } = { binding: 'a',target: 'cells',kind: 'ignite',x: 1,z: -0 };
  const loan: V2WorldActionLoan = { binding: 'a',target: 'cells',scope,kind: 'cell-field',owner: { activate: (x,z) => { trace.push([x,z]); } } };
  try {
    const prepared = prepareV2WorldActions([action,action],[loan]);expect(trace).toEqual([]);
    action.x = 99;action.z = 99;
    prepared.validate();expect(trace).toEqual([]);
    const first = prepared.operations[0],last = prepared.operations[1];
    if (first === undefined || last === undefined) throw new Error('Missing prepared fixture operations');
    first();trace.push('other prepared family');last();
    expect(trace).toEqual([[1,-0],'other prepared family',[1,-0]]);
  } finally { scope.dispose(); }
});

test('retired or replaced authority after preparation refuses before the first world effect', () => {
  const scope = new Scope('prepared'),effect = vi.fn<(x: number,z: number) => void>();
  const action: V2WorldAction = { binding: 'a',target: 'cells',kind: 'ignite',x: 1,z: 2 };
  const owner = { activate: effect },loan: V2WorldActionLoan = { binding: 'a',target: 'cells',scope,kind: 'cell-field',owner };
  try {
    const prepared = prepareV2WorldActions([action],[loan]);owner.activate = vi.fn();
    expect(prepared.validate).toThrow('Changed');expect(prepared.operations[0]).toThrow('Changed');expect(effect).not.toHaveBeenCalled();
    owner.activate = effect;scope.dispose();
    expect(prepared.validate).toThrow('Retired');expect(effect).not.toHaveBeenCalled();
  } finally { scope.dispose(); }
});
