import { expect, test } from 'vitest';
import * as v from 'valibot';
import { GroupBankV2 } from '../src/shared/engine/script/groupBankV2';
import { Scope } from '../src/shared/engine/app/scope';
import { GroupBrain } from '../src/shared/engine/ai/GroupBrain';
import { AggressionDirector } from '../src/shared/engine/ai/director';
import { GroupBankV2Schema, parseGroupBankV2 } from '@wildshard/format/scriptGroupBankV2';
import { layoutV2, writeV2Frame, validateV2Frame } from '@wildshard/format/scriptWireV2';
import { prepareV2Observations } from '../src/shared/engine/script/observationsV2';
import { ScriptModuleV2 } from '../src/shared/engine/script/moduleV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { groupBankSourceV2 } from '../src/sharddev/as/groupBankV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const members = Array.from({ length: 16 }, (_, slot) => ({ entityId: `body:${slot}`, alive: slot !== 3 }));
const roster = members.map((actor, slot) => ({ group: 'first', slot, identity: actor.entityId,
  wire: actor.entityId, handle: slot + 1 }));
const external = { group: 'other', slot: 0, identity: 'prey:0', wire: 'herd:other/prey:0', handle: 99 };
const fields = [
  { name: 'time', kind: 'nullable-number' },
  { name: 'initialized', kind: 'boolean' },
  { name: 'phase', kind: 'enum', values: ['rest', 'advance'] },
  { name: 'lead', kind: 'reference', own: true },
  { name: 'target', kind: 'reference' },
  { name: 'members', kind: 'references', own: true, capacity: 16 },
  { name: 'held', kind: 'references', own: true, capacity: 16 },
  { name: 'strength', kind: 'number', min: 0, max: 100 },
];
const record = () => ({ time: null, initialized: true, phase: 'advance', lead: 'body:15',
  target: external.wire, members: members.map(actor => actor.entityId), held: ['body:3', 'body:15'], strength: -0 });

test('finite columns preserve ordered sixteen-member and cross-group references without changing wire values', () => {
  const codec = new GroupBankV2(fields), input = record(), loans = [...roster, external];
  const bank = codec.encode(input, 'first', loans), output = codec.decode(bank, 'first', loans);
  expect(output).toStrictEqual(input);
  expect(Object.is(output['strength'], -0)).toBe(true);
  expect(JSON.stringify(output)).toBe(JSON.stringify(input));
  const next = { ...input, time: 4.25, target: null, members: ['body:15', 'body:0'] };
  expect(codec.decode(codec.encode(next, 'first', loans), 'first', loans)).toStrictEqual(next);
  expect(roster[3]?.identity).toBe('body:3'); // Death retains its original slot.
});

test('real GroupBrain JSON continuation round-trips through the bank and original restore owner', () => {
  class OriginalGroup extends GroupBrain<typeof members[number]> {
    sample(): void { this.groupDelta(7.5, .1); const director = this.groupDirector(2, () => false);
      const first = this.members[0], last = this.members[15];
      if (first === undefined || last === undefined) throw new Error('Missing member');
      director.take(last); director.take(first);
    }
    save(): string { return this.snapshotGroup(actor => actor.entityId); }
    load(input: string): void { this.restoreGroup(input, actor => actor.entityId); }
  }
  const schema = v.strictObject({ members: v.array(v.string()), time: v.nullable(v.number()),
    directors: v.array(v.strictObject({ cap: v.number(), held: v.array(v.string()) })) });
  const original = new OriginalGroup(members), restored = new OriginalGroup(members);
  original.sample();
  const saved = original.save(), value = v.parse(schema, JSON.parse(saved));
  const director = value.directors[0];
  if (director === undefined) throw new Error('Missing original director');
  const codec = new GroupBankV2([{ name: 'members', kind: 'references', capacity: 16, own: true },
    { name: 'time', kind: 'nullable-number' }, { name: 'capacity', kind: 'number', integer: true, min: 0, max: 16 },
    { name: 'held', kind: 'references', capacity: 16, own: true }]);
  const decoded = codec.decode(codec.encode({ members: value.members, time: value.time,
    capacity: director.cap, held: director.held }, 'first', roster), 'first', roster);
  restored.load(JSON.stringify({ members: decoded['members'], time: decoded['time'],
    directors: [{ cap: decoded['capacity'], held: decoded['held'] }] }));
  expect(restored.save()).toBe(saved);
});

test('malformed suffixes, forged references and accessors refuse before publication', () => {
  const codec = new GroupBankV2(fields), loans = [...roster, external], scope = new Scope('group-bank');
  const bank = codec.encode(record(), 'first', loans), before = bank.slice();
  try {
    let reads = 0;
    expect(() => codec.encode({ ...record(), get strength() { reads++; return 1; } }, 'first', loans)).toThrow('accessor');
    expect(reads).toBe(0);
    expect(() => codec.encode({ ...record(), lead: external.wire }, 'first', loans)).toThrow('reference');
    expect(() => codec.encode({ ...record(), members: ['body:0', 'body:0'] }, 'first', loans)).toThrow('references');
    expect(() => codec.encode(record(), 'first', [...loans, { ...external, handle: 1 }])).toThrow('Ambiguous');
    const malformed = bank.slice(); malformed[malformed.length - 1] = Number.NaN;
    expect(() => codec.prepare(bank, malformed, 'first', loans, scope)).toThrow('Non-finite');
    expect(bank).toStrictEqual(before);
    const next = codec.encode({ ...record(), strength: 80 }, 'first', loans);
    const ready = codec.prepare(bank, next, 'first', loans, scope);
    ready.validate(); ready.accept();
    expect(codec.decode(bank, 'first', loans)['strength']).toBe(80);
    expect(() => ready.accept()).toThrow('preparation');
  } finally { scope.dispose(); }
});

test('publication fences original bank, reference slot identity and ancestor sliced retirement', () => {
  const codec = new GroupBankV2(fields), root = new Scope('parent'), scope = root.child('group');
  const loans = [...roster, { ...external }], bank = codec.encode(record(), 'first', loans);
  const next = codec.encode({ ...record(), strength: 12 }, 'first', loans);
  try {
    const staleBank = codec.prepare(bank, next, 'first', loans, scope); bank[bank.length - 1] = 2;
    expect(() => staleBank.accept()).toThrow('Changed group bank'); bank[bank.length - 1] = -0;
    const staleRef = codec.prepare(bank, next, 'first', loans, scope);
    const last = loans[loans.length - 1]; if (last === undefined) throw new Error('Missing reference');
    last.identity = 'replacement';
    expect(() => staleRef.accept()).toThrow('reference loan'); last.identity = external.identity;
    const retiring = codec.prepare(bank, next, 'first', loans, scope), steps = root.disposeSteps(); steps.next();
    expect(() => retiring.accept()).toThrow('Retired'); expect(Object.is(bank[bank.length - 1], -0)).toBe(true);
    for (const _step of steps) { /* Complete the same original retirement. */ }
  } finally { root.dispose(); }
});

test('real AS claims observe earlier writes in the same group call and match the original director', async () => {
  const codec = new GroupBankV2([{ name: 'held', kind: 'number', integer: true, min: 0, max: 65535 },
    { name: 'first', kind: 'boolean' }, { name: 'second', kind: 'boolean' }, { name: 'repeat', kind: 'boolean' }]);
  const bank = codec.encode({ held: 0, first: false, second: false, repeat: false }, 'first', roster);
  const layout = layoutV2(0, 1, new Map([[1, 1], [2, codec.width], [3, codec.width], [5, 1]]));
  const source = `import * as core from './sdk/as/wsV2'; import * as group from './sdk/as/groupBankV2';
    export function ws_abi():i32{return 2;} export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      group.write(1,group.claim(0,2,1)?1:0);group.write(2,group.claim(0,3,1)?1:0);
      group.write(3,group.claim(0,2,1)?1:0);core.endBinding();return fuel;}`;
  const bytes = await compileScriptV2(source, { lane: 'project', ioBytes: layout.bytes,
    sources: { 'sdk/as/wsV2.ts': v2CoreSource(0), 'sdk/as/groupBankV2.ts': groupBankSourceV2(0, codec.width) } });
  const module = new ScriptModuleV2(bytes, { seed: [0, 0], initFuel: 400000, output: [], ioBytes: layout.bytes });
  const input = prepareV2Observations(layout, 0, { bindings: [{ identity: 'original-group', handle: 1,
    self: 0, player: 0, observed: new Set(), enabled: true, due: true, divisor: 6, fuel: 400000,
    previousTick: 0, currentTick: 0, state: Array.from(bank), parameters: [], fields: [], sample: { atTick: 0, target: 0 } }],
    players: [], edges: [], events: [], actions: new Set(), eventKinds: new Set() });
  let authority: ReturnType<typeof writeV2Frame> | undefined;
  const result = module.project(400000, view => {
    authority = writeV2Frame(view, layout, { lane: 2, module: 1, sequence: 0, tick: 0, due: 1 }, input.counts);
    input.write(view);
  }, view => {
    if (authority === undefined) throw new Error('Missing frame');
    const counts = validateV2Frame(view, layout, authority), state = layout.regions[2];
    if (state === undefined || counts[2] !== codec.width) throw new Error('Incomplete candidate');
    return Float64Array.from({ length: codec.width }, (_, index) => view.getFloat64(state.offset + index * 8, true));
  }).value;
  const director = new AggressionDirector(1), first = members[2], second = members[3];
  if (first === undefined || second === undefined) throw new Error('Missing member');
  const expected = { held: 4, first: director.take(first), second: director.take(second), repeat: director.take(first) };
  expect(codec.decode(result, 'first', roster)).toStrictEqual(expected);
  expect(bank).toStrictEqual(Float64Array.of(0, 0, 0, 0));
});

test('metadata admission is strict and emits the same finite named schema', () => {
  expect(() => parseGroupBankV2([{ name: '__proto__', kind: 'boolean' }])).toThrow();
  expect(() => parseGroupBankV2([{ name: 'phase', kind: 'enum', values: ['x', 'x'] }])).toThrow('Duplicate');
  expect(() => parseGroupBankV2([{ name: 'value', kind: 'number', min: 2, max: 1 }])).toThrow('Inverted');
  const schema = namedJsonSchema(GroupBankV2Schema);
  expect(validateNamedJsonSchema(schema, new TextEncoder().encode(JSON.stringify(fields)))).toStrictEqual(fields);
});

test('incremental updates keep one bank and validate the whole changed suffix before any write',()=>{
 const codec=new GroupBankV2(fields),loans=[...roster,external],bank=codec.encode(record(),'first',loans),same=bank;
 codec.update(bank,{strength:17,phase:'rest',held:['body:0']},'first',loans);
 expect(bank).toBe(same);expect(codec.decode(bank,'first',loans)).toStrictEqual({...record(),strength:17,phase:'rest',held:['body:0']});
 const before=bank.slice();let reads=0;
 for(const changes of [{strength:20,lead:external.wire},{strength:20,get phase(){reads++;return 'rest';}},{strength:Number.NaN}]){
  expect(()=>codec.update(bank,changes,'first',loans)).toThrow();expect(bank).toStrictEqual(before);
 }
 expect(reads).toBe(0);codec.update(bank,{strength:-0},'first',loans);expect(Object.is(codec.decode(bank,'first',loans)['strength'],-0)).toBe(true);
});


test('validation checks every original wire kind without building a decoded record',()=>{
 const codec=new GroupBankV2(fields),loans=[...roster,external],bank=codec.encode(record(),'first',loans);
 codec.validate(bank,'first',loans);
 expect(codec.decode(bank,'first',loans)).toStrictEqual(record());
 const changes:readonly (readonly [number,number])[]=[[0,2],[2,2],[3,9],[4,99],[5,404],[6,17],[7,0],[40,Infinity]];
 for(const[offset,value]of changes){
  const malformed=bank.slice();malformed[offset]=value;const before=malformed.slice();
  expect(()=>codec.validate(malformed,'first',loans)).toThrow();
  expect(()=>codec.decode(malformed,'first',loans)).toThrow();
  expect(malformed).toStrictEqual(before);
 }
});

test('equivalent fresh rosters preserve metadata but keep each publication tied to its original row objects', () => {
  const codec = new GroupBankV2(fields), scope = new Scope('fresh-reference-rosters');
  const first = structuredClone([...roster, external]);
  const bank = codec.encode(record(), 'first', first), before = bank.slice();
  try {
    for (let visit = 0; visit < 3; visit++) {
      const current = structuredClone(first);
      expect(codec.decode(bank, 'first', current)).toStrictEqual(record());
      const ready = codec.prepare(bank, bank.slice(), 'first', current, scope);
      const original = current[0]; if (original === undefined) throw new Error('Missing original loan');
      current[0] = { ...original };
      expect(() => ready.accept()).toThrow('Changed group reference loan');
      expect(bank).toStrictEqual(before);
    }
    const changes = [{ group: 'foreign' }, { slot: 0 }, { identity: 'body:0' }, { wire: 'body:0' }, { handle: 1 }];
    for (const change of changes) {
      const current = structuredClone(first), last = current[15];
      if (last === undefined) throw new Error('Missing changed loan');
      current[15] = { ...last, ...change };
      expect(() => codec.decode(bank, 'first', current)).toThrow();
      expect(bank).toStrictEqual(before);
    }
    expect(codec.decode(bank, 'first', first)).toStrictEqual(record());
    codec.prepare(bank, bank.slice(), 'first', first, scope).accept();
    expect(Object.is(bank[bank.length - 1], -0)).toBe(true);
  } finally { scope.dispose(); }
});

test('repeated publication guards retain signed-zero and final-row metadata fences', () => {
  const codec = new GroupBankV2([{ name: 'value', kind: 'number' }]), scope = new Scope('publication-loop');
  const loans = structuredClone(roster), bank = codec.encode({ value: -0 }, 'first', loans);
  try {
    const ready = codec.prepare(bank, Float64Array.of(1), 'first', loans, scope);
    for (let at = 0; at < 3; at++) ready.validate();
    bank[0] = 0;
    expect(() => ready.validate()).toThrow('Changed group bank owner');
    bank[0] = -0;
    const last = loans[loans.length - 1];
    if (last === undefined) throw new Error('Missing final reference');
    const handle = last.handle;
    last.handle = 99;
    expect(() => ready.validate()).toThrow('Changed group reference loan');
    last.handle = handle;
    ready.validate(); ready.accept();
    expect(bank[0]).toBe(1);
    expect(() => ready.validate()).toThrow('Retired group bank preparation');
  } finally { scope.dispose(); }
});

test('numeric read plans retain finite and bounded checks around variable-width reference columns',()=>{
 const codec=new GroupBankV2([{name:'free',kind:'number'},{name:'bounded',kind:'number',integer:true,min:1,max:3},
  {name:'list',kind:'references',capacity:2,own:true},{name:'tail',kind:'number'}]);
 const input={free:-0,bounded:2,list:['body:0'],tail:5},bank=codec.encode(input,'first',roster);
 expect(codec.decode(bank,'first',roster)).toStrictEqual(input);
 for(const value of [Number.NaN,Infinity,-Infinity])for(const slot of [0,bank.length-1]){
  const bad=bank.slice();bad[slot]=value;
  expect(()=>codec.validate(bad,'first',roster)).toThrow('Non-finite');
  expect(()=>codec.decode(bad,'first',roster)).toThrow('Non-finite');
 }
 for(const value of [.5,0,4]){
  const bad=bank.slice();bad[1]=value;
  expect(()=>codec.validate(bad,'first',roster)).toThrow('outside bound');
  expect(()=>codec.decode(bad,'first',roster)).toThrow('outside bound');
 }
 const bad=bank.slice();bad[4]=1;expect(()=>codec.decode(bad,'first',roster)).toThrow('Nonzero unused');
 expect(Object.is(codec.decode(bank,'first',roster)['free'],-0)).toBe(true);
});

test('reused update staging clears shorter reference tails and never publishes a refused prefix', () => {
  const codec = new GroupBankV2(fields), loans = [...roster, external], bank = codec.encode(record(), 'first', loans);
  codec.update(bank, { held: ['body:15', 'body:0'], strength: 10, time: 4.5 }, 'first', loans);
  codec.update(bank, { held: ['body:3'] }, 'first', loans);
  expect(codec.decode(bank, 'first', loans)).toStrictEqual({ ...record(), held: ['body:3'], strength: 10, time: 4.5 });
  const before = bank.slice();
  expect(() => codec.update(bank, { strength: 20, phase: 'unknown' }, 'first', loans)).toThrow('enum');
  expect(bank).toStrictEqual(before);
  codec.update(bank, { phase: 'rest' }, 'first', loans);
  expect(codec.decode(bank, 'first', loans)).toStrictEqual({ ...record(), held: ['body:3'], strength: 10, time: 4.5, phase: 'rest' });
  codec.update(bank, { strength: -0, time: null, held: [] }, 'first', loans);
  expect(codec.decode(bank, 'first', loans)).toStrictEqual({ ...record(), held: [], phase: 'rest' });
});

test('a descriptor trap reentering update borrows independent staging and preserves both original banks', () => {
  const codec = new GroupBankV2(fields), loans = [...roster, external];
  const outer = codec.encode(record(), 'first', loans), inner = outer.slice();
  for (let visit = 0; visit < 3; visit++) {
    let nested = 0;
    const changes = new Proxy({ strength: 37 + visit, phase: 'rest' }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'phase') {
          nested++;
          codec.update(inner, { held: ['body:1'], strength: 4 + visit }, 'first', loans);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    codec.update(outer, changes, 'first', loans);
    expect(nested).toBe(1);
    expect(codec.decode(outer, 'first', loans)).toStrictEqual({ ...record(), strength: 37 + visit, phase: 'rest' });
    expect(codec.decode(inner, 'first', loans)).toStrictEqual({ ...record(), held: ['body:1'], strength: 4 + visit });
  }
});

test('snapshot pairs stay exclusive until accept or discard while public values stay detached', () => {
  const codec = new GroupBankV2([{ name: 'value', kind: 'number' }]), scope = new Scope('snapshot-pairs'), bank = Float64Array.of(0);
  try {
    const first = codec.prepare(bank, Float64Array.of(11), 'herd', [], scope);
    const second = codec.prepare(bank, Float64Array.of(22), 'herd', [], scope);
    first.discard();
    const third = codec.prepare(bank, Float64Array.of(33), 'herd', [], scope);
    expect(second.values['value']).toBe(22);expect(third.values['value']).toBe(33);
    expect(first.values['value']).toBe(11);expect(Object.isFrozen(first.values)).toBe(true);
    expect(() => first.accept()).toThrow('Retired');second.validate();third.validate();
    second.accept();expect(bank[0]).toBe(22);
    expect(() => third.accept()).toThrow('Changed');third.discard();
    const source = Float64Array.of(-0), final = codec.prepare(bank, source, 'herd', [], scope);
    source[0] = 99;final.accept();expect(Object.is(bank[0], -0)).toBe(true);
    expect(second.values['value']).toBe(22);expect(third.values['value']).toBe(33);
    for (let i = 0; i < 5; i++) {
      const dropped = codec.prepare(bank, Float64Array.of(i), 'herd', [], scope);dropped.discard();dropped.discard();
      expect(() => dropped.validate()).toThrow('Retired');
    }
    expect(Object.is(bank[0], -0)).toBe(true);
  } finally { scope.dispose(); }
});

test('a refused pooled candidate returns its lease without publishing or retaining a stale numeric suffix', () => {
  const codec = new GroupBankV2([{ name: 'value', kind: 'number' }]), scope = new Scope('refused-pair'), bank = Float64Array.of(1);
  try {
    codec.prepare(bank, Float64Array.of(2), 'herd', [], scope).accept();
    expect(() => codec.prepare(bank, Float64Array.of(Number.NaN), 'herd', [], scope)).toThrow('Non-finite');
    expect(bank[0]).toBe(2);
    const ready = codec.prepare(bank, Float64Array.of(-0), 'herd', [], scope);ready.accept();
    expect(Object.is(bank[0], -0)).toBe(true);
    const short = new Float64Array(0);Object.defineProperty(short, 'length', { value: 1 });
    expect(() => codec.prepare(bank, short, 'herd', [], scope)).toThrow('width');
  } finally { scope.dispose(); }
});

test('custom slice and iterable snapshots preserve their original copy semantics', () => {
  const codec = new GroupBankV2([{ name: 'value', kind: 'number' }]), scope = new Scope('custom-snapshots'), bank = Float64Array.of(1);
  try {
    let slices = 0;
    Object.defineProperty(bank, 'slice', { value(this: Float64Array) { slices++;return Float64Array.prototype.slice.call(this); } });
    const source = Float64Array.of(4);
    Object.defineProperty(source, Symbol.iterator, { *value() { yield -0; } });
    const ready = codec.prepare(bank, source, 'herd', [], scope);
    expect(slices).toBe(1);expect(Object.is(ready.values['value'], -0)).toBe(true);
    ready.accept();expect(Object.is(bank[0], -0)).toBe(true);
  } finally { scope.dispose(); }
});

test('an overridden setter may retain a candidate even after throwing without later pool reuse changing it', () => {
  const codec = new GroupBankV2([{ name: 'value', kind: 'number' }]), scope = new Scope('exposed-candidate'), bank = Float64Array.of(0);
  let captured: ArrayLike<number> | undefined;
  try {
    const ready = codec.prepare(bank, Float64Array.of(8), 'herd', [], scope);
    Object.defineProperty(bank, 'set', { configurable: true, value(source: ArrayLike<number>) { captured = source;throw new Error('setter failure'); } });
    expect(() => ready.accept()).toThrow('setter failure');ready.discard();
    expect(Reflect.deleteProperty(bank, 'set')).toBe(true);
    for (let value = 9; value < 14; value++) codec.prepare(bank, Float64Array.of(value), 'herd', [], scope).accept();
    if (captured === undefined) throw new Error('Missing captured candidate');
    expect(captured[0]).toBe(8);expect(bank[0]).toBe(13);
  } finally { scope.dispose(); }
});

test('discard during a setter getter cannot lend the in-progress acceptance pair to a nested preparation', () => {
  const codec = new GroupBankV2([{ name: 'value', kind: 'number' }]), scope = new Scope('nested-acceptance');
  const bank = Float64Array.of(0), other = Float64Array.of(0);
  try {
    const ready = codec.prepare(bank, Float64Array.of(11), 'herd', [], scope);let nested = false;
    Object.defineProperty(bank, 'set', { get() {
      if (!nested) { nested = true;ready.discard();codec.prepare(other, Float64Array.of(77), 'herd', [], scope).accept(); }
      return Reflect.get(Float64Array.prototype, 'set');
    } });
    ready.accept();expect(nested).toBe(true);expect(other[0]).toBe(77);expect(bank[0]).toBe(11);
    expect(ready.values['value']).toBe(11);expect(() => ready.accept()).toThrow('Retired');
  } finally { scope.dispose(); }
});

test('repeated scalar validation checks changed words and current reference authority', () => {
  const codec = new GroupBankV2([
    { name: 'bounded', kind: 'number', integer: true, min: 0, max: 10 },
    { name: 'flag', kind: 'boolean' },
    { name: 'phase', kind: 'enum', values: ['rest', 'go'] },
    { name: 'owner', kind: 'reference', own: true },
    { name: 'free', kind: 'number' },
  ]);
  const input = { bounded: 2, flag: true, phase: 'go', owner: 'body:0', free: -0 };
  const bank = codec.encode(input, 'first', roster);
  for (let visit = 0; visit < 3; visit++) codec.validate(bank, 'first', roster);
  const invalid: readonly (readonly [number, number])[] = [
    [0, .5], [0, 11], [1, 2], [2, -1], [2, 2], [3, 99],
    [4, Number.NaN], [4, Infinity], [4, -Infinity],
  ];
  for (const [offset, value] of invalid) {
    const previous = bank[offset];
    if (previous === undefined) throw new Error('Missing scalar word');
    bank[offset] = value;
    expect(() => codec.validate(bank, 'first', roster)).toThrow();
    bank[offset] = previous;
    codec.validate(bank, 'first', roster);
  }
  const foreign = structuredClone(roster);
  const first = foreign[0];
  if (first === undefined) throw new Error('Missing reference');
  first.group = 'foreign';
  expect(() => codec.validate(bank, 'first', foreign)).toThrow('reference');
  codec.validate(bank, 'first', roster);
  const one = codec.decode(bank, 'first', roster), two = codec.decode(bank, 'first', roster);
  expect(one).toStrictEqual(input);
  expect(two).toStrictEqual(input);
  expect(one).not.toBe(two);
  expect(Object.isFrozen(one)).toBe(true);
  expect(Object.is(one['free'], -0)).toBe(true);
  bank[4] = 0;
  codec.validate(bank, 'first', roster);
  expect(Object.is(codec.decode(bank, 'first', roster)['free'], 0)).toBe(true);
});

test('failed scalar reads cannot prime a later invalid bank', () => {
  const codec = new GroupBankV2([
    { name: 'first', kind: 'number', min: 0, max: 5 },
    { name: 'last', kind: 'boolean' },
  ]);
  const bank = Float64Array.of(1, 0);
  codec.validate(bank, 'first', roster);
  bank[0] = 2; bank[1] = 2;
  expect(() => codec.validate(bank, 'first', roster)).toThrow();
  bank[0] = 6; bank[1] = 0;
  expect(() => codec.validate(bank, 'first', roster)).toThrow('bound');
  bank[0] = 2;
  codec.validate(bank, 'first', roster);
});

test('ArrayLike getters retain order and nested validation after native reads', () => {
  const codec = new GroupBankV2([
    { name: 'first', kind: 'number' }, { name: 'last', kind: 'boolean' },
  ]);
  codec.validate(Float64Array.of(1, 0), 'first', roster);
  const reads: string[] = [];
  const input = {
    get length() { reads.push('length'); return 2; },
    get 0() {
      reads.push('first');
      codec.validate(Float64Array.of(4, 1), 'first', roster);
      return 2;
    },
    get 1() { reads.push('last'); return 2; },
  };
  expect(() => codec.validate(input, 'first', roster)).toThrow();
  expect(reads).toStrictEqual(['length', 'first', 'last']);
  codec.validate(Float64Array.of(2, 0), 'first', roster);
});

test('native validation does not trust detached or shared mutable views', () => {
  const codec = new GroupBankV2([{ name: 'flag', kind: 'boolean' }]);
  const bank = Float64Array.of(1);
  codec.validate(bank, 'first', roster);
  structuredClone(bank.buffer, { transfer: [bank.buffer] });
  expect(() => codec.validate(bank, 'first', roster)).toThrow('width');
  const shared = new Float64Array(new SharedArrayBuffer(8));
  codec.validate(shared, 'first', roster);
  shared[0] = 2;
  expect(() => codec.validate(shared, 'first', roster)).toThrow();
});
