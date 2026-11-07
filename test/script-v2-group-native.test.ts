import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Scope } from '../src/shared/engine/app/scope';
import { Events } from '../src/shared/engine/events/events';
import { AggressionDirector, AggressionService } from '../src/shared/engine/ai/director';
import { Rng } from '../src/shared/engine/core/rng';
import { GroupStepV2, prepareGroupNativeV2, type GroupStepNativeOwnersV2, type GroupStepOperationV2 } from '../src/shared/engine/script/groupStepV2';
import type { V2ColumnOwners } from '../src/shared/engine/script/observationColumnsV2';
import { parseGroupStepV2, GroupStepV2Schema, groupStepLayoutV2 } from '@wildshard/format/scriptGroupStepV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const rows = parseGroupStepV2({ bank: ['phase','x','z','reply','random'].map(name => ({ name, kind: 'number' })),
  columns: [{ name: 'result', id: 1, source: { kind: 'result', channel: 'reply' } }], members: 16,
  signals: ['normal', 'resume', 'claim', 'visibility', 'mixed', 'grass', 'hearing', 'downwind', 'mixedClaim', 'duplicate'],
  actions: [
    { id: 1, words: 2, native: { kind: 'normal', channel: 'reply' } },
    { id: 2, words: 2, native: { kind: 'grass', channel: 'reply' } },
    { id: 3, words: 1, member: 0, native: { kind: 'claim', channel: 'reply' } },
    { id: 4, words: 1, member: 0, native: { kind: 'visibility', channel: 'reply' } },
    { id: 5, words: 1, member: 0, native: { kind: 'hearing', channel: 'reply', radii: [1,2,3,4] } },
    { id: 6, words: 1, member: 0, native: { kind: 'downwind', channel: 'reply' } },
    { id: 7, words: 0 },
  ], outputs: 4, pages: 1, fuel: 400000 });
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await compileScriptV2(`import * as core from './sdk/as/wsV2';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      const signal=i32(core.parameter(0));core.setState(0,signal);
      if(signal==1){const x=core.random(1),z=core.random(1);core.setState(1,x);core.setState(2,z);core.pageOutput(1,x,z);}
      else if(signal==2){core.setState(3,core.field(0));core.setState(4,core.random(1));}
      else if(signal==3)core.pageOutput(3,0);
      else if(signal==4)core.pageOutput(4,1);
      else if(signal==5){core.pageOutput(2,3,4);core.pageOutput(7);}
      else if(signal==6)core.pageOutput(2,3,4);
      else if(signal==7)core.pageOutput(5,1);
      else if(signal==8)core.pageOutput(6,1);
      else if(signal==9){core.pageOutput(3,0);core.pageOutput(7);}
      else if(signal==10){core.pageOutput(3,0);core.pageOutput(3,0);}
      core.endBinding();return fuel;}`, { lane: 'project', ioBytes: groupStepLayoutV2(rows).bytes,
    sources: { 'sdk/as/wsV2.ts': v2CoreSource(0) } });
});
function actor(id: string): AnimalSim {
  return new AnimalSim({ kind: 'sample', label: 'Sample', variant: 'plain', rarity: 'common', hp: 20, aggressive: false,
    dims: { bodyY: .6, bodyHalfLen: .5, bodyRadius: .3, headRadius: .2, legLen: .5, feet: [], halfWidth: .3 },
    mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 5, relentless: false } },
  1, 1, id, { heightAt: () => 0, random: () => .5 });
}
function fixture() {
  const parent = new Scope('barrier-parent'), scope = parent.child('group'), random = new Rng(42), player = new Vector3(5,6,7);
  const bodies = [actor('first'),actor('second')], calls: unknown[] = [];
  const members: V2ColumnOwners[] = bodies.map((body, slot) => ({ scope, self: { group: 'group', slot, identity: body.entityId, actor: body },
    player: { position: player }, observed: new Map(), t: 8, dt: .1, context: { calm: false, playerSpeed: 2 }, results: { reply: 0 },
    senses: { player,
      visibility(x,z,at,speed,time) { calls.push(['visibility',slot,x,z,at,speed,time]);return this.player.y + speed + time; },
      hearing(radii,at,speed) { calls.push(['hearing',slot,...radii,at,speed]);return radii.reduce((sum,radius) => sum + radius,0) + this.player.y; },
      downwind(x,z,at) { calls.push(['downwind',slot,x,z,at]);return this.player.x > x; },
    } }));
  const events = new Events(), service = new AggressionService(events,scope), director = new AggressionDirector<AnimalSim>(1);
  const ground = { normalY(x: number,z: number): number { calls.push(['normal',x,z]);return this === ground ? .75 : 0; } };
  const grass = { grassHeightAt(x: number,z: number): number { calls.push(['grass',x,z]);return this === grass ? x+z : 0; } };
  const native: GroupStepNativeOwnersV2 = { scope, members, ground, grass, aggression: { kind: 'events', service, events, director } };
  const state = new Float64Array(5), runner = new GroupStepV2(bytes,rows,scope);
  const input = { group: 'group', handle: 10, signal: 'normal', tick: 1, state, members, references: [], random };
  return { parent, scope, random, bodies, members, calls, events, service, director, ground, grass, native, runner, state, input };
}

test('real AS resumes after original normal sampling in the same call with exact shared RNG order', () => {
  const f = fixture();
  try {
    const oracle = new Rng(42), first = oracle.next(), second = oracle.next(), before = f.random.snapshot();
    const step = f.runner.prepare(f.input), result = step.prepareNative(f.native);
    expect(f.calls).toStrictEqual([]);expect(f.random.snapshot()).toStrictEqual(before);expect(Array.from(f.state)).toStrictEqual([0,0,0,0,0]);
    result.validate();const answers = result.accept();
    expect(answers).toStrictEqual([{channel:'reply',value:.75}]);expect(f.calls).toStrictEqual([['normal',first,second]]);
    expect(f.random.snapshot()).toStrictEqual(oracle.snapshot());
    const nextMembers = f.members.map(member => ({...member,results:{reply:answers[0]?.value ?? 0}}));
    f.runner.prepare({...f.input,signal:'resume',members:nextMembers}).accept();
    expect(Array.from(f.state)).toStrictEqual([2,first,second,.75,oracle.next()]);
    expect(f.random.snapshot()).toStrictEqual(oracle.snapshot());
    expect(() => result.accept()).toThrow('accepted');
  } finally { f.parent.dispose(); }
});
test('only emitted member senses execute at conditional segments with their original arguments and receivers', () => {
  const f = fixture();
  try {
    const rng = f.random.snapshot(), body = f.bodies.map(row => row.snapshot());
    for (const [signal,value] of [['visibility',16],['hearing',16],['downwind',1]] as const) {
      const result = f.runner.prepare({...f.input,signal}).prepareNative(f.native).accept();
      expect(result[0]?.value).toBe(value);expect(result[0]?.member?.actor).toBe(f.bodies[1]);
    }
    const player = f.members[1]?.senses?.player;
    expect(f.calls).toStrictEqual([['visibility',1,0,0,player,2,8],['hearing',1,1,2,3,4,player,2],['downwind',1,0,0,player]]);
    expect(f.random.snapshot()).toStrictEqual(rng);expect(f.bodies.map(row => row.snapshot())).toStrictEqual(body);
  } finally { f.parent.dispose(); }
});
test('page aggression uses original register then ai.claim, native aggression uses its original token owner', () => {
  const f = fixture(), oracleEvents = new Events(), oracleScope = new Scope('oracle-claims');
  try {
    const first = f.bodies[0], second = f.bodies[1];if (first === undefined || second === undefined) throw new Error('Missing bodies');
    const oracleService = new AggressionService(oracleEvents,oracleScope), oracleDirector = new AggressionDirector<AnimalSim>(1);
    oracleService.register(first,oracleDirector);const expected = oracleEvents.ask('ai.claim',first);
    const step = f.runner.prepare({...f.input,signal:'claim'}), prepared = step.prepareNative(f.native);
    expect(f.director.count).toBe(0);expect(prepared.accept()[0]?.value).toBe(Number(expected));
    expect(f.director.holds(first)).toBe(oracleDirector.holds(first));
    f.service.register(second,f.director);expect(f.events.ask('ai.claim',second)).toBe(false);
    const tokens = new WeakMap<AnimalSim,AggressionDirector<AnimalSim>>(), director = new AggressionDirector<AnimalSim>(1);
    const native = {...f.native,aggression:{kind:'tokens' as const,owners:tokens,director}};
    expect(f.runner.prepare({...f.input,signal:'claim'}).prepareNative(native).accept()[0]?.value).toBe(1);
    expect(tokens.get(first)).toBe(director);expect(director.holds(first)).toBe(true);
  } finally { f.parent.dispose();oracleScope.dispose(); }
});
test('mixed or missing native suffix refuses before sampling, claim, bank or RNG publication', () => {
  const f = fixture();
  try {
    const rng = f.random.snapshot(), state = f.state.slice();
    for (const signal of ['mixed','mixedClaim']) expect(() => f.runner.prepare({...f.input,signal}).prepareNative(f.native)).toThrow('declaration');
    expect(() => f.runner.prepare({...f.input,signal:'duplicate'}).prepareNative(f.native)).toThrow('Duplicate');
    const {ground:_ground,...missing} = f.native;
    expect(() => f.runner.prepare(f.input).prepareNative(missing)).toThrow('ground');
    expect(f.calls).toStrictEqual([]);expect(f.director.count).toBe(0);expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
    expect(() => f.runner.prepare(f.input).prepareNative({...f.native,members:[...f.members]})).toThrow('scope');
  } finally { f.parent.dispose(); }
});
test('callable replacement and ancestor retirement refuse prepared publication, and run is once-only', () => {
  const f = fixture();
  try {
    const rng = f.random.snapshot(), state = f.state.slice(), prepared = f.runner.prepare(f.input).prepareNative(f.native);
    f.ground.normalY = () => 1;
    expect(() => prepared.accept()).toThrow('replaced');expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
    const live = f.runner.prepare({...f.input,signal:'grass'}).prepareNative(f.native), disposal = f.parent.disposeSteps();disposal.next();
    expect(() => live.accept()).toThrow('disposed');expect(f.calls).toStrictEqual([]);
    for (const _step of disposal) { /* Finish original ancestor retirement. */ }
  } finally { f.parent.dispose(); }
});
test('strict named rows reject malformed result arity, member selectors, radii and unknown operations', () => {
  const schema = namedJsonSchema(GroupStepV2Schema), encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  expect(validateNamedJsonSchema(schema,encode(rows))).toStrictEqual(rows);
  for (const action of [
    {id:1,words:1,native:{kind:'normal',channel:'reply'}},
    {id:1,words:1,member:0,native:{kind:'normal',channel:'reply'}},
    {id:1,words:2,native:{kind:'claim',channel:'reply'}},
    {id:1,words:1,member:0,native:{kind:'hearing',channel:'reply',radii:[1,2,3]}},
    {id:1,words:1,member:0,native:{kind:'hearing',channel:'reply',radii:[1,2,-3,4]}},
    {id:1,words:1,member:0,native:{kind:'unknown',channel:'reply'}},
  ]) expect(() => parseGroupStepV2({...rows,actions:[action]})).toThrow();
});

test('a single native result retains full operand and channel preflight and frozen publication', () => {
  const f = fixture();
  const operation: GroupStepOperationV2 = { id: 1, values: [3,4], native: { kind: 'normal', channel: 'reply' } };
  const invalid: GroupStepOperationV2[] = [
    { ...operation, values: [3] }, { ...operation, values: [3,Number.NaN] },
    { ...operation, native: { kind: 'normal', channel: '' } },
    { ...operation, native: { kind: 'normal', channel: 'x'.repeat(129) } },
  ];
  try {
    for (const row of invalid) expect(() => prepareGroupNativeV2([row], f.native)).toThrow();
    expect(() => prepareGroupNativeV2([operation, { ...operation, id: 2 }], f.native)).toThrow('Duplicate native group result channel');
    expect(f.calls).toStrictEqual([]);
    const ready = prepareGroupNativeV2([operation], f.native);
    ready.validate(); expect(f.calls).toStrictEqual([]);
    const result = ready.run();
    expect(result).toStrictEqual([{ channel: 'reply', value: .75 }]);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result[0])).toBe(true);
    expect(f.calls).toStrictEqual([['normal',3,4]]);
    expect(() => ready.run()).toThrow('consumed');
  } finally { f.parent.dispose(); }
});

test('retirement during a native query prevents result publication and the consumed segment cannot run twice', () => {
  const f = fixture();
  let disposal: ReturnType<Scope['disposeSteps']> | undefined;
  try {
    f.ground.normalY = () => { disposal = f.parent.disposeSteps();disposal.next();return .5; };
    const result = f.runner.prepare(f.input).prepareNative(f.native);
    expect(() => result.accept()).toThrow('Retired');
    expect(() => result.accept()).toThrow();
    if (disposal !== undefined) for (const _step of disposal) { /* Finish original retirement. */ }
  } finally { f.parent.dispose(); }
});
