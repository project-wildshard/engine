import { beforeAll, expect, test } from 'vitest';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { Rng } from '../src/shared/engine/core/rng';
import { GroupStepV2 } from '../src/shared/engine/script/groupStepV2';
import { parseGroupStepV2, groupStepLayoutV2, GroupStepV2Schema } from '@wildshard/format/scriptGroupStepV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const rows = parseGroupStepV2({ bank: ['firstA','secondA','firstB','secondB'].map(name => ({name,kind:'number'})),
  columns: [], members: 16, signals: ['step','bad'], actions: [], outputs: 1, pages: 1, fuel: 400000, randomStreams: 2 });
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await compileScriptV2(`import * as core from './sdk/as/wsV2';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      core.setState(0,core.random(1));core.setState(1,core.random(2));
      core.setState(2,core.random(1));core.setState(3,core.random(2));
      if(core.parameter(0)==2)core.pageOutput(99);
      core.endBinding();return fuel;}`, {lane:'project',ioBytes:groupStepLayoutV2(rows).bytes,sources:{'sdk/as/wsV2.ts':v2CoreSource(0)}});
});
function fixture() {
  const parent = new Scope('rng-parent'),scope = parent.child('group'), random = new Rng(10), contextRandom = new Rng(45);
  const runner = new GroupStepV2(bytes,rows,scope), state = new Float64Array(4);
  const input = {group:'sample',handle:1,signal:'step',tick:3,state,members:[],references:[],random,contextRandom};
  return {parent,scope,random,contextRandom,runner,state,input};
}
function oracle(first: Rng, second: Rng): number[] { return [first.next(),second.next(),first.next(),second.next()]; }

test('real group AS borrows both original streams and atomically commits exact interleaved draws', () => {
  const f = fixture();
  try {
    const first = new Rng(10),second = new Rng(45),expected = oracle(first,second);
    const before = [f.random.snapshot(),f.contextRandom.snapshot()],candidate = f.runner.prepare(f.input);
    expect([f.random.snapshot(),f.contextRandom.snapshot()]).toStrictEqual(before);expect(Array.from(f.state)).toStrictEqual([0,0,0,0]);
    candidate.validate();candidate.accept();expect(Array.from(f.state)).toStrictEqual(expected);
    expect([f.random.snapshot(),f.contextRandom.snapshot()]).toStrictEqual([first.snapshot(),second.snapshot()]);
    expect(() => candidate.accept()).toThrow('accepted');
    const saved = JSON.stringify([f.random.snapshot(),f.contextRandom.snapshot()]);
    const nextExpected = oracle(first,second);f.runner.prepare(f.input).accept();
    expect(Array.from(f.state)).toStrictEqual(nextExpected);
    const savedRng = v.strictObject({version:v.literal(1),state:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(0xffffffff)),
      initial:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(0xffffffff)),scrambledFork:v.boolean()});
    const [a,b] = v.parse(v.strictTuple([savedRng,savedRng]),JSON.parse(saved));
    f.random.restore(a);f.contextRandom.restore(b);f.runner.prepare(f.input).accept();
    expect(Array.from(f.state)).toStrictEqual(nextExpected);expect(JSON.stringify([f.random.snapshot(),f.contextRandom.snapshot()])).toBe(JSON.stringify([first.snapshot(),second.snapshot()]));
  } finally { f.parent.dispose(); }
});
test('rejected suffix, second-stream replacement and stale draws publish neither bank nor other stream', () => {
  const f = fixture();
  try {
    const state = f.state.slice(), before = [f.random.snapshot(),f.contextRandom.snapshot()];
    expect(() => f.runner.prepare({...f.input,signal:'bad'})).toThrow('operation');
    expect(f.state).toStrictEqual(state);expect([f.random.snapshot(),f.contextRandom.snapshot()]).toStrictEqual(before);
    const prepared = f.runner.prepare(f.input);f.contextRandom.next();
    expect(() => prepared.accept()).toThrow('RNG');expect(f.random.snapshot()).toStrictEqual(before[0]);expect(f.state).toStrictEqual(state);
    const replacement = f.runner.prepare(f.input);f.input.contextRandom = new Rng(45);
    expect(() => replacement.accept()).toThrow('continuation');expect(f.random.snapshot()).toStrictEqual(before[0]);expect(f.state).toStrictEqual(state);
  } finally { f.parent.dispose(); }
});
test('two-stream capability is explicit and aliased original owners refuse before any draw', () => {
  const f = fixture();
  try {
    const before = f.random.snapshot();
    expect(() => f.runner.prepare({...f.input,contextRandom:f.random})).toThrow('aliased');
    const {random:_random,...missing} = f.input;
    expect(() => f.runner.prepare(missing)).toThrow('Undeclared');expect(f.random.snapshot()).toStrictEqual(before);
    const {randomStreams:_streams,...single} = rows;
    expect(groupStepLayoutV2(single).regions[20]?.capacity).toBe(1);
    expect(groupStepLayoutV2(rows).regions[20]?.capacity).toBe(2);
    expect(groupStepLayoutV2(rows).regions[21]?.capacity).toBe(2);
    const one = new GroupStepV2(bytes,single,f.scope);
    expect(() => one.prepare(f.input)).toThrow('Undeclared');
    const schema = namedJsonSchema(GroupStepV2Schema),encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(validateNamedJsonSchema(schema,encode(rows))).toStrictEqual(rows);
    for (const randomStreams of [0,1,3,16]) expect(() => parseGroupStepV2({...rows,randomStreams})).toThrow();
  } finally { f.parent.dispose(); }
});
test('ancestor retirement and callable replacement refuse both prepared stream commits', () => {
  const f = fixture();
  try {
    const before = [f.random.snapshot(),f.contextRandom.snapshot()],state = f.state.slice(),prepared = f.runner.prepare(f.input);
    f.contextRandom.next = () => .5;
    expect(() => prepared.accept()).toThrow('RNG');expect(f.state).toStrictEqual(state);
    expect([f.random.snapshot(),f.contextRandom.snapshot()]).toStrictEqual(before);
    const next = f.runner.prepare(f.input),disposal = f.parent.disposeSteps();disposal.next();
    expect(() => next.accept()).toThrow('disposed');expect(f.state).toStrictEqual(state);
    expect([f.random.snapshot(),f.contextRandom.snapshot()]).toStrictEqual(before);
    for (const _step of disposal) { /* Finish original retirement. */ }
  } finally { f.parent.dispose(); }
});
