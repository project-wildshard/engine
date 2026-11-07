import { beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { Rng } from '../src/shared/engine/core/rng';
import { ScriptModuleV2 } from '../src/shared/engine/script/moduleV2';
import { GroupStepV2 } from '../src/shared/engine/script/groupStepV2';
import {ReturnProjectionV2} from '../src/shared/game/population/returnProjectionV2';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { parseGroupStepV2 } from '@wildshard/format/scriptGroupStepV2';
import { parseReturnProjectionV2, returnProjectionV2Layout } from '@wildshard/format/returnProjectionV2';
import { SCRIPT_V2_REVISIONS } from '@wildshard/format/scriptAdmissionV2';
import { compileReturnProjectionV2 } from '../src/sharddev/returnProjectionV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const groups = parseGroupStepV2({ bank: [{ name: 'count', kind: 'number' }], columns: [], members: 8, signals: ['advance','badOutputs'], actions: [],
  profiles: [{ id: 'second', bank: [{ name: 'awake', kind: 'boolean' }, { name: 'count', kind: 'number' }], columns: [], members: 16, signals: ['advance'], actions: [] }],
  outputs: 1, pages: 1, fuel: 400000 });
const layout = returnProjectionV2Layout(1, 1, 32, groups);
let descriptor: Awaited<ReturnType<typeof compileReturnProjectionV2>>['legacy'] & { v2: ReturnType<typeof parseReturnProjectionV2> };
let bytes: Uint8Array;
beforeAll(async () => {
  const built = await compileReturnProjectionV2({ id: 'groupFixture', abi: '1.0', side: 'sim', module: `blobs/wasm/${'0'.repeat(64)}.wasm`,
    source: 'behaviour/shared.as', binding: { shard: true }, pages: 1, onFail: 'hold', on: ['signal'], reads: ['field', 'random'], commands: ['channel'],
    fields: { value: 'value' }, signals: { run: 'run' }, channels: { out: 'out' }, stateVersion: 1, state: [], params: {} },
  { fields: new Map([['value', 1]]), signals: new Map([['run', 1]]), channels: new Map([['out', 1]]) },
  new Map([['behaviour/shared.as', `import { Read, Do, Field, Channel } from './generated/groupFixture';
    export function onSignal(signal:i32,value:f64,source:i32):void{Do.channel(Channel.out,Read.field(0,Field.value)+Read.random());}`]]), { asLineCeiling: 5 });
  bytes = await compileScriptV2(`import * as core from './sdk/as/wsV2';let scratch:i32=0;
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));scratch++;
      if(core.count(2)>0){
        if(core.parameter(2)==0){core.setState(0,core.state(0)+f64(scratch)+core.random(1));
          if(core.parameter(0)==2){core.pageOutput(1,0);core.pageOutput(1,0);}}
        else {core.setState(0,1);core.setState(1,core.state(1)+f64(scratch));}
      }else {core.pageOutput(1,core.field(0)+core.random(1));
        if(core.field(0)==99){const d:usize=128+2*24;store<u32>(d+16,1);store<f64>(usize(load<u32>(d+4)),1);}}

      core.endBinding();return fuel;}`, { lane: 'project', ioBytes: layout.bytes, sources: { 'sdk/as/wsV2.ts': v2CoreSource(0) } });
  descriptor = { ...built.legacy, v2: parseReturnProjectionV2({ artifact: { abi: 2, minor: 0, compilerRevision: SCRIPT_V2_REVISIONS.compiler,
    admissionRevision: SCRIPT_V2_REVISIONS.admission, hash: hashImmutableBytes(bytes), lane: 'project', pages: 1, ioBytes: layout.bytes },
  fields: ['value'], signals: ['run'], channels: ['out'], bytes: btoa(Array.from(bytes, byte => String.fromCodePoint(byte)).join('')), groups }) };
});
test('numeric and distinct group profiles use one entered programme and exactly one Wasm instance', () => {
  const owner = new Scope('shared-groups'), Native = WebAssembly.Instance;let instances = 0;
  const spy = vi.spyOn(WebAssembly, 'Instance').mockImplementation(class extends Native {
    constructor(module: WebAssembly.Module, imports?: WebAssembly.Imports) { super(module, imports);instances++; }
  });
  try {
    const programme = ReturnProgram.page(descriptor, owner);expect(instances).toBe(1);
    expect(ReturnProgram.page(structuredClone(descriptor), owner)).toBe(programme);expect(instances).toBe(1);
    const random = new Rng(41), oracle = new Rng(41);
    expect(programme.project('run', { value: 3 }, random)).toStrictEqual({ out: 3 + oracle.next() });
    const prepare = programme.prepareGroup;if (prepare === undefined) throw new Error('Missing group loan');
    const state = Float64Array.of(0), before = random.snapshot();
    const ready = prepare({ group: 'first', handle: 1, signal: 'advance', tick: 0, state, members: [], references: [], random });
    expect(state[0]).toBe(0);expect(random.snapshot()).toStrictEqual(before);ready.accept();
    expect(state[0]).toBe(1 + oracle.next());expect(random.snapshot()).toStrictEqual(oracle.snapshot());
    const other = Float64Array.of(0, 7);
    prepare({ group: 'other', handle: 2, profile: 'second', signal: 'advance', tick: 0, state: other, members: [], references: [] }).accept();
    expect(Array.from(other)).toStrictEqual([1, 8]);
    expect(programme.project('run', { value: -0 }, random)).toStrictEqual({ out: -0 + oracle.next() });
    expect(random.snapshot()).toStrictEqual(oracle.snapshot());expect(instances).toBe(1);
  } finally { spy.mockRestore();owner.dispose(); }
});
test('full group metadata participates in cache identity before any second instance can be constructed', () => {
  const owner = new Scope('shared-group-declarations');
  try {
    const programme = ReturnProgram.page(descriptor, owner), changed = structuredClone(descriptor);
    changed.v2.groups = { ...groups, signals: ['different'] };
    expect(() => ReturnProgram.page(changed, owner)).toThrow('Shared return declaration changed');
    expect(ReturnProgram.page(descriptor, owner)).toBe(programme);
    const unowned=ReturnProgram.page(descriptor),random=new Rng(43),oracle=new Rng(43);
    expect(unowned.project('run',{value:3},random)).toStrictEqual({out:3+oracle.next()});
    expect(unowned.prepareGroup).toBeUndefined();
    expect(()=>new ReturnProjectionV2(descriptor.v2).prepareGroup({group:'first',handle:1,signal:'advance',tick:0,state:Float64Array.of(0),members:[],references:[]})).toThrow('entered scope');
    expect(() => parseReturnProjectionV2({ ...descriptor.v2, groups: { ...groups, pages: 2 } })).toThrow('pages');
  } finally { owner.dispose(); }
});
test('ancestor sliced retirement refuses group capture and acceptance without publishing the bank or RNG', () => {
  const parent = new Scope('group-parent'), owner = parent.child('entered'), programme = ReturnProgram.page(descriptor, owner);
  const prepare = programme.prepareGroup;if (prepare === undefined) throw new Error('Missing group loan');
  const state = Float64Array.of(0), random = new Rng(9), before = random.snapshot();
  const input = { group: 'first', handle: 1, signal: 'advance', tick: 0, state, members: [], references: [], random };
  const ready = prepare(input), disposal = parent.disposeSteps();disposal.next();
  try {
    expect(() => ready.accept()).toThrow('disposed');expect(() => prepare(input)).toThrow('disposed');
    expect(state[0]).toBe(0);expect(random.snapshot()).toStrictEqual(before);
  } finally { for (const _step of disposal) { /* Complete original owner retirement. */ } }
});
test('the shared engine loan rejects a different executable or IO reservation', () => {
  const scope = new Scope('group-module-loan'), module = new ScriptModuleV2(bytes, { seed: [0, 0], initFuel: 400000, ioBytes: layout.bytes, output: [] });
  try {
    const changed = bytes.slice();changed[0] = 1;
    expect(() => new GroupStepV2(changed, groups, scope, { module, layout })).toThrow('Foreign');
    expect(() => new GroupStepV2(bytes, groups, scope, { module, layout: { ...layout, bytes: layout.bytes + 8 } })).toThrow('Foreign');
    expect(module.owns(bytes, layout.io, layout.bytes)).toBe(true);expect(module.owns(bytes, layout.io, layout.bytes + 8)).toBe(false);
  } finally { scope.dispose(); }
});
test('the full admitted named descriptor retains group rows without changing legacy witness bytes', () => {
  const schema = namedJsonSchema(ReturnProgramSchema), encoded = new TextEncoder().encode(JSON.stringify(descriptor));
  expect(validateNamedJsonSchema(schema, encoded)).toStrictEqual(descriptor);
  const invalid = { ...descriptor, v2: { ...descriptor.v2, groups: { ...groups, callbacks: {} } } };
  expect(() => validateNamedJsonSchema(schema, new TextEncoder().encode(JSON.stringify(invalid)))).toThrow();
  expect(ReturnProgram.page({ script: descriptor.script, bytes: descriptor.bytes }).prepareGroup).toBeUndefined();
});

test('shared capacity never broadens the numeric or group publication rights', () => {
  const owner = new Scope('shared-rights'), programme = ReturnProgram.page(descriptor, owner), random = new Rng(90), before = random.snapshot();
  try {
    expect(() => programme.project('run', { value: 99 }, random)).toThrow('Unexpected numeric projection state');
    expect(random.snapshot()).toStrictEqual(before);
    const state = Float64Array.of(0), prepare = programme.prepareGroup;
    if (prepare === undefined) throw new Error('Missing group loan');
    expect(() => prepare({ group: 'first', handle: 1, signal: 'badOutputs', tick: 0, state, members: [], references: [], random })).toThrow('Incomplete group candidate');
    expect(state[0]).toBe(0);expect(random.snapshot()).toStrictEqual(before);
  } finally { owner.dispose(); }
});
test('native capture cannot reenter the other side of the shared programme', () => {
  const owner = new Scope('shared-reentry'), programme = ReturnProgram.page(descriptor, owner), random = new Rng(91), before = random.snapshot();
  const snapshot = random.snapshot.bind(random), prepare = programme.prepareGroup;
  if (prepare === undefined) throw new Error('Missing group loan');
  const spy = vi.spyOn(random, 'snapshot').mockImplementation(() => {
    expect(() => programme.project('run', { value: 1 })).toThrow('Reentrant');return snapshot();
  });
  try {
    const state = Float64Array.of(0);prepare({ group: 'first', handle: 1, signal: 'advance', tick: 0, state, members: [], references: [], random });
    expect(state[0]).toBe(0);expect(snapshot()).toStrictEqual(before);
  } finally { spy.mockRestore();owner.dispose(); }
});
