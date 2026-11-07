import { expect,test,vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { PageAir } from '../src/client/game/population/pageAir';
import { ObservationColumnsV2,type V2ColumnOwners,type V2ReferenceColumn } from '../src/shared/engine/script/observationColumnsV2';
import { parseObservationColumnsV2,ObservationColumnsV2Schema } from '@wildshard/format/scriptObservationColumnsV2';
import { formatJsonSchema } from '../src/shared/host/formatJsonSchema';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

async function fixture() {
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const first = SIM_LEVEL.entities[0];if (first === undefined) throw new Error('Missing original body');
  const host = createSimHost({ ...SIM_LEVEL,quests: [],entities: [first,{ ...first,id: 'boar:2' }] },{ rapier });
  const actor = host.entities.get('boar:1'), other = host.entities.get('boar:2');
  if (actor === undefined || other === undefined) throw new Error('Missing native actors');
  actor.position.set(4,2,7);leadPlayer(host).position.set(20,3,30);
  const environment = new PageAir(), query = vi.spyOn(environment,'grassHeightAt').mockImplementation((x,z) => x+z);
  environment.playerCrouched = true;environment.playerFwdX = .6;environment.playerFwdZ = .8;
  environment.wind = { x: .8,z: -.6,strength: .7 };
  const clock = { hour: 22,dayPhase: 'night',night: .8 }, weather = { stormActive: false };
  const owners: V2ColumnOwners = { scope: host.scope,self: { group: 'roster',slot: 0,identity: actor.entityId,actor },
    player: leadPlayer(host),observed: new Map([[10,actor],[11,other]]),t: 121.25,dt: 1/60,environment,
    clock: { ...clock,dayPhase: 'night' },weather };
  return { host,actor,other,owners,environment,query,weather };
}
function values(rows: ReturnType<ObservationColumnsV2['capture']>): Record<string,number> {
  return Object.fromEntries(rows.map(row => [row.name,row.value]));
}
test('finite column admission emits a closed schema and refuses executable or ambiguous selectors', () => {
  const valid = [{ id: 1,name: 'hidden',source: { kind: 'player',field: 'crouched' } }];
  expect(parseObservationColumnsV2(valid)).toEqual(valid);
  expect(formatJsonSchema(ObservationColumnsV2Schema,'draft-2020-12').items).toMatchObject({ additionalProperties: false });
  for (const input of [[...valid,...valid], [{ ...valid[0],id: 0 }], [{ id: 1,name: 'x',source: { kind: 'path',path: 'owner.value' } }],
    [{ id: 1,name: 'x',source: () => 1 }], [{ id: 1,name: 'state',source: { kind: 'herd-state',group: 'h',slot: 0,states: [{ state: 'watch',value: 1 },{ state: 'watch',value: 2 }] } }]])
    expect(() => parseObservationColumnsV2(input)).toThrow();
});
test('real page environment samples the keeper actor exactly, with detached values and no body/RNG step', async () => {
  const f = await fixture();
  const rows = [
    { id: 1,name: 'crouched',source: { kind: 'player',field: 'crouched' } },
    { id: 2,name: 'forwardX',source: { kind: 'player',field: 'forwardX' } },
    { id: 3,name: 'forwardZ',source: { kind: 'player',field: 'forwardZ' } },
    { id: 4,name: 'grass',source: { kind: 'grass',at: 'self' } },
    { id: 5,name: 'windX',source: { kind: 'wind',field: 'x' } },
    { id: 6,name: 'windZ',source: { kind: 'wind',field: 'z' } },
    { id: 7,name: 'strength',source: { kind: 'wind',field: 'strength' } },
    { id: 8,name: 'phase',source: { kind: 'clock',field: 'dayPhase' } },
    { id: 9,name: 'hour',source: { kind: 'clock',field: 'hour' } },
    { id: 10,name: 't',source: { kind: 'time',field: 't' } },
  ];
  try {
    const reader = new ObservationColumnsV2(rows,f.host.scope), rng = f.host.rng.snapshot(), before = f.actor.snapshot();
    const first = reader.capture(f.owners);
    expect(values(first)).toEqual({ crouched: 1,forwardX: .6,forwardZ: .8,grass: 11,windX: .8,windZ: -.6,strength: .7,phase: 2,hour: 22,t: 121.25 });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(4,7);
    expect(f.actor.snapshot()).toEqual(before);expect(f.host.rng.snapshot()).toEqual(rng);
    f.actor.position.x = 8;f.environment.playerCrouched = false;
    expect(values(reader.capture(f.owners))).toMatchObject({ grass: 15,crouched: 0 });
    expect(values(first)).toMatchObject({ grass: 11,crouched: 1 });
  } finally { f.host.dispose(); }
});
test('absent actors keep zero grass; dead actors keep their slot and a replaced identity refuses', async () => {
  const f = await fixture(), reader = new ObservationColumnsV2([{ id: 1,name: 'grass',source: { kind: 'grass',at: 'self' } }],f.host.scope);
  try {
    expect(values(reader.capture({ ...f.owners,self: { group: 'roster',slot: 0,identity: '',actor: null } }))).toEqual({ grass: 0 });
    expect(f.query).not.toHaveBeenCalled();f.actor.hp = 0;
    expect(values(reader.capture(f.owners))).toEqual({ grass: 11 });
    expect(() => reader.capture({ ...f.owners,self: { ...f.owners.self,actor: f.other } })).toThrow('Stale');
  } finally { f.host.dispose(); }
});
test('unset hit time has an explicit validity bit and attack phase retains its -1 sentinel', async () => {
  const f = await fixture(), reader = new ObservationColumnsV2([
    { id: 1,name: 'valid',source: { kind: 'actor',field: 'lastHitValid' } },
    { id: 2,name: 'seconds',source: { kind: 'actor',field: 'lastHitSeconds' } },
    { id: 3,name: 'attack',source: { kind: 'actor',field: 'attackPhase' } },
  ],f.host.scope);
  try {
    expect(values(reader.capture(f.owners))).toEqual({ valid: 0,seconds: 0,attack: -1 });
    f.actor.lastHitT = 12.5;expect(values(reader.capture(f.owners))).toEqual({ valid: 1,seconds: 12.5,attack: -1 });
    f.actor.lastHitT = Infinity;expect(() => reader.capture(f.owners)).toThrow('hit stamp');
  } finally { f.host.dispose(); }
});
test('herd/taming references compare actual bodies and preflight the entire suffix before queries', async () => {
  const f = await fixture(), reader = new ObservationColumnsV2([
    { id: 1,name: 'grass',source: { kind: 'grass',at: 'self' } },
    { id: 2,name: 'same',source: { kind: 'herd',group: 'herds',slot: 0,field: 'sameActor' } },
    { id: 3,name: 'state',source: { kind: 'herd-state',group: 'herds',slot: 0,states: [{ state: 'beaten',value: 7 }] } },
    { id: 4,name: 'companion',source: { kind: 'taming',field: 'companion' } },
    { id: 5,name: 'bonded',source: { kind: 'taming',field: 'bonded' } },
  ],f.host.scope);
  const herd = { cx: 4,cz: 7,trust: 31,alert: 20,mode: 'flee',stallionState: 'beaten',stallion: f.actor };
  const owner = { ...f.owners,herds: [{ group: 'herds',slot: 0,owner: { ...herd,mode: 'flee',stallionState: 'beaten' } }],taming: { phase: 'bonded',companion: f.actor } };
  try {
    // Both animals share species/variant. Identity, never those labels, controls the comparison.
    const input: V2ColumnOwners = { ...owner,herds: [{ group: 'herds',slot: 0,owner: { ...herd,mode: 'flee',stallionState: 'beaten' } }] };
    expect(values(reader.capture(input))).toEqual({ grass: 11,same: 1,state: 7,companion: 10,bonded: 1 });
    const other: V2ColumnOwners = { ...input,herds: [{ group: 'herds',slot: 0,owner: { ...herd,mode: 'flee',stallionState: 'beaten',stallion: f.other } }] };
    expect(values(reader.capture(other))).toMatchObject({ same: 0 });
    f.query.mockClear();
    expect(() => reader.capture({ ...input,observed: new Map() })).toThrow('identity');expect(f.query).not.toHaveBeenCalled();
  } finally { f.host.dispose(); }
});
test('owner retirement, missing concrete services and later slot effects are observed without caching', async () => {
  const f = await fixture(), reader = new ObservationColumnsV2([
    { id: 1,name: 'grass',source: { kind: 'grass',at: 'self' } },
    { id: 2,name: 'storm',source: { kind: 'weather',field: 'stormActive' } },
  ],f.host.scope);
  try {
    expect(values(reader.capture(f.owners))['storm']).toBe(0);f.weather.stormActive = true;
    expect(values(reader.capture(f.owners))['storm']).toBe(1);
    const foreign = new Scope('other');
    try { expect(() => reader.capture({ ...f.owners,scope: foreign })).toThrow('owner'); } finally { foreign.dispose(); }
    f.query.mockClear();const { weather: _weather,...missing } = f.owners;
    expect(() => reader.capture(missing)).toThrow('weather');expect(f.query).not.toHaveBeenCalled();
    f.host.scope.dispose();expect(() => reader.capture(f.owners)).toThrow('owner');
  } finally { f.host.dispose(); }
});

test('declared metadata is immutable and preflights without sampling live owners', async () => {
  const f = await fixture();
  const states = [{ state: 'beaten',value: 7 }];
  const input = [
    { id: 1,name: 'grass',source: { kind: 'grass',at: 'self' } },
    { id: 2,name: 'state',source: { kind: 'herd-state',group: 'herds',slot: 0,states } },
  ];
  try {
    const reader = new ObservationColumnsV2(input,f.host.scope), columns = reader.declaredColumns;
    expect(columns).toEqual(input);expect(reader.declaredColumns).toBe(columns);
    expect(f.query).not.toHaveBeenCalled();
    expect(Object.isFrozen(columns)).toBe(true);
    for (const column of columns) {
      expect(Object.isFrozen(column)).toBe(true);expect(Object.isFrozen(column.source)).toBe(true);
      expect(() => Object.defineProperty(column,'id',{ value: 99 })).toThrow();
      if (column.source.kind === 'herd-state') {
        expect(Object.isFrozen(column.source.states)).toBe(true);
        for (const code of column.source.states) {
          expect(Object.isFrozen(code)).toBe(true);
          expect(() => Object.defineProperty(code,'value',{ value: 99 })).toThrow();
        }
      }
    }
    states.push({ state: 'watch',value: 8 });
    expect(reader.declaredColumns).toEqual([
      { id: 1,name: 'grass',source: { kind: 'grass',at: 'self' } },
      { id: 2,name: 'state',source: { kind: 'herd-state',group: 'herds',slot: 0,states: [{ state: 'beaten',value: 7 }] } },
    ]);
    expect(values(reader.capture({ ...f.owners,herds: [{ group: 'herds',slot: 0,owner: null }] }))).toEqual({ grass: 11,state: 0 });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(4,7);
  } finally { f.host.dispose(); }
});

test('compiled numeric scalar readers stay fresh and match the detached column API',async()=>{
 const f=await fixture();
 const rows=[{id:1,name:'x',source:{kind:'actor',field:'x'}},{id:2,name:'aw',source:{kind:'memory',key:'aw',default:{value:0}}},
  {id:3,name:'valid',source:{kind:'actor',field:'lastHitValid'}},{id:4,name:'yaw',source:{kind:'actor',field:'yaw'}}];
 const reader=new ObservationColumnsV2(rows,f.host.scope);
 try{
  for(const x of [-0,9,17]){f.actor.position.x=x;f.actor.mem['aw']=x;
   const expected=Float64Array.from(reader.capture(f.owners),row=>row.value),generic=vi.spyOn(reader,'capture');
   expect(reader.captureNumeric(f.owners)).toStrictEqual(expected);expect(generic).not.toHaveBeenCalled();generic.mockRestore();
  }
  f.host.scope.dispose();expect(()=>reader.captureNumeric(f.owners)).toThrow('Retired');
 }finally{f.host.dispose();}
});

test('selected point readers skip unrelated grass and fence replacement at the native read',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([{id:1,name:'x',source:{kind:'actor',field:'x'}},
  {id:2,name:'grass',source:{kind:'grass',at:'self'}}],f.host.scope);
 try{
  const selected=reader.captureNumeric(f.owners,[true,false]);expect(selected[0]).toBe(4);expect(Number.isNaN(selected[1])).toBe(true);expect(f.query).not.toHaveBeenCalled();
  expect(reader.captureNumeric(f.owners)[1]).toBe(11);
  f.query.mockImplementationOnce(()=>{f.environment.grassHeightAt=()=>7;return 1;});
  expect(()=>reader.captureNumeric(f.owners)).toThrow('grass owner');
 }finally{f.host.dispose();}
});


test('a selected scalar read fences only real reads while retaining final retirement checks',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2(Array.from({length:64},(_,index)=>({id:index+1,name:`x${index}`,source:{kind:'actor',field:'x'}})),f.host.scope);
 let reads=0;Object.defineProperty(f.owners.self,'actor',{get:()=>{reads++;return f.actor;}});
 const selection=Array.from({length:64},(_,index)=>index===0);
 try{
  const first=reader.captureNumeric(f.owners,selection);expect(first[0]).toBe(4);expect(Number.isNaN(first[63])).toBe(true);expect(reads).toBeLessThanOrEqual(8);
  f.actor.position.x=12;reads=0;expect(reader.captureNumeric(f.owners,selection)[0]).toBe(12);expect(reads).toBeLessThanOrEqual(8);
  f.host.scope.dispose();expect(()=>reader.captureNumeric(f.owners,selection.map(()=>false))).toThrow('Retired');
 }finally{f.host.dispose();}
});


test('compiled environment preflight refuses a missing suffix before scalar reads',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([
  {id:1,name:'memory',source:{kind:'memory',key:'probe',default:{value:0}}},
  {id:2,name:'wind',source:{kind:'wind',field:'x'}},
  {id:3,name:'grass',source:{kind:'grass',at:'self'}},
 ],f.host.scope);
 let reads=0;Object.defineProperty(f.actor.mem,'probe',{get:()=>{reads++;return -0;}});
 const {environment:_environment,...missing}=f.owners;
 try{
  expect(()=>reader.captureNumeric(missing)).toThrow('environment');expect(reads).toBe(0);expect(f.query).not.toHaveBeenCalled();
  const selected=reader.captureNumeric(missing,[true,false,false]);expect(Object.is(selected[0],-0)).toBe(true);
  expect(Number.isNaN(selected[1])&&Number.isNaN(selected[2])).toBe(true);expect(reads).toBe(1);expect(f.query).not.toHaveBeenCalled();
  const full=reader.captureNumeric(f.owners);expect(Object.is(full[0],-0)).toBe(true);expect(full[1]).toBe(.8);expect(full[2]).toBe(11);
  expect(reads).toBe(2);expect(f.query).toHaveBeenCalledExactlyOnceWith(4,7);
 }finally{f.host.dispose();}
});

test('numeric observed identity preflight retains empty, distinct and duplicate loan semantics',async()=>{
 const f=await fixture();try{
  const reader=new ObservationColumnsV2([{id:1,name:'x',source:{kind:'actor',field:'x'}}],f.host.scope);
  for(const observed of [new Map(),new Map([[10,f.actor]]),new Map([[10,f.actor],[11,f.other]])]){
   expect([...reader.captureNumeric({...f.owners,observed})]).toEqual([4]);
  }
  for(const observed of [new Map([[10,f.actor],[11,f.actor]]),new Map([[10,f.actor],[11,f.other],[12,f.actor]]),
   new Map([[0,f.actor]]),new Map([[1.5,f.actor]]),new Map([[0x80000000,f.actor]])]){
   expect(()=>reader.captureNumeric({...f.owners,observed})).toThrow('Invalid observed actor identity');
  }
  f.host.scope.dispose();expect(()=>reader.captureNumeric({...f.owners,observed:new Map()})).toThrow('Retired');
 }finally{f.host.dispose();}
});

test('numeric reference pins isolate nested queries, retain detached values and reset after refusal',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([
  {id:1,name:'targetX',source:{kind:'reference',binding:'target',field:'x'}},
  {id:2,name:'grass',source:{kind:'grass',at:'self'}},
 ],f.host.scope);
 const outerLoan={identity:f.actor.entityId,handle:10,body:f.actor},innerLoan={identity:f.other.entityId,handle:11,body:f.other};
 const outer={...f.owners,references:new Map([['target',outerLoan]])},inner={...f.owners,references:new Map([['target',innerLoan]])};
 let depth=0,nested:Float64Array|undefined;
 f.other.position.x=9;
 f.query.mockImplementation((x,z)=>{
  if(depth===0){depth++;try{nested=reader.captureNumeric(inner);}finally{depth--;}}
  return x+z;
 });
 try{
  const first=reader.captureNumeric(outer);expect(first).toEqual(new Float64Array([4,11]));
  expect(nested).toEqual(new Float64Array([9,11]));
  f.actor.position.x=12;expect(reader.captureNumeric(outer)).toEqual(new Float64Array([12,19]));
  expect(first).toEqual(new Float64Array([4,11]));
  f.query.mockImplementationOnce(()=>{outerLoan.handle=12;return 1;});
  expect(()=>reader.captureNumeric(outer)).toThrow('Retired observation owner');
  outerLoan.handle=10;expect(reader.captureNumeric(outer)).toEqual(new Float64Array([12,19]));
  f.host.scope.dispose();expect(()=>reader.captureNumeric(outer)).toThrow('Retired');
 }finally{f.host.dispose();}
});


test('numeric final pins recheck stable loans and null entries after the last scalar read',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([
  {id:1,name:'first',source:{kind:'reference',binding:'first',field:'present'}},
  {id:2,name:'late',source:{kind:'reference',binding:'late',field:'present'}},
  {id:3,name:'tail',source:{kind:'memory',key:'tail',default:{value:0}}},
 ],f.host.scope);
 const loan={identity:f.actor.entityId,handle:10,body:f.actor},references=new Map<string,V2ReferenceColumn|null>([['first',loan],['late',null]]);
 const owners={...f.owners,references},trace:string[]=[],get=references.get.bind(references);
 const lookup=vi.spyOn(references,'get').mockImplementation(name=>{trace.push(name);return get(name);});
 let edit:'none'|'late'|'handle'='none';
 Object.defineProperty(f.actor.mem,'tail',{get:()=>{
  trace.push('tail');if(edit==='late')references.set('late',loan);if(edit==='handle')loan.handle=12;return -0;
 }});
 try{
  const retained=reader.captureNumeric(owners);expect(retained).toStrictEqual(new Float64Array([1,0,-0]));
  expect(trace).toEqual(['first','late','first','late','tail','first','late']);
  trace.length=0;edit='late';expect(()=>reader.captureNumeric(owners)).toThrow('Retired observation owner');
  expect(trace).toEqual(['first','late','first','late','tail','first','late']);
  references.set('late',null);trace.length=0;edit='handle';
  expect(()=>reader.captureNumeric(owners)).toThrow('Retired observation owner');
  expect(trace).toEqual(['first','late','first','late','tail','first']);
  loan.handle=10;edit='none';expect(reader.captureNumeric(owners)).toStrictEqual(retained);
  expect(retained).toStrictEqual(new Float64Array([1,0,-0]));
 }finally{lookup.mockRestore();f.host.dispose();}
});

test('caller-owned numeric destinations overwrite omissions without changing detached captures',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([
  {id:1,name:'x',source:{kind:'actor',field:'x'}},{id:2,name:'grass',source:{kind:'grass',at:'self'}},
 ],f.host.scope),destination=new Float64Array(2);
 try{
  const detached=reader.captureNumeric(f.owners);f.actor.position.x=-0;
  expect(reader.captureNumeric(f.owners,[true,false],destination)).toBe(destination);
  expect(Object.is(destination[0],-0)).toBe(true);expect(Number.isNaN(destination[1])).toBe(true);
  expect(detached).toEqual(new Float64Array([4,11]));
  f.actor.position.x=12;expect(reader.captureNumeric(f.owners,undefined,destination)).toBe(destination);
  expect(destination).toEqual(new Float64Array([12,19]));expect(detached).toEqual(new Float64Array([4,11]));
  const queries=f.query.mock.calls.length;
  expect(()=>reader.captureNumeric(f.owners,undefined,new Float64Array(1))).toThrow('destination');
  expect(f.query).toHaveBeenCalledTimes(queries);
  f.query.mockImplementationOnce(()=>{f.environment.grassHeightAt=()=>7;return 1;});
  expect(()=>reader.captureNumeric(f.owners,undefined,destination)).toThrow('grass owner');
  expect(reader.captureNumeric(f.owners,undefined,destination)).toEqual(new Float64Array([12,7]));
  f.host.scope.dispose();expect(()=>reader.captureNumeric(f.owners,undefined,destination)).toThrow('Retired');
 }finally{f.host.dispose();}
});

test('nested numeric captures keep caller-owned outer and inner destinations independent',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([
  {id:1,name:'targetX',source:{kind:'reference',binding:'target',field:'x'}},
  {id:2,name:'grass',source:{kind:'grass',at:'self'}},
 ],f.host.scope),outerValues=new Float64Array(2),innerValues=new Float64Array(2);
 const outerLoan={identity:f.actor.entityId,handle:10,body:f.actor},innerLoan={identity:f.other.entityId,handle:11,body:f.other};
 const outer={...f.owners,references:new Map([['target',outerLoan]])},inner={...f.owners,references:new Map([['target',innerLoan]])};
 let depth=0;f.other.position.x=9;
 f.query.mockImplementation((x,z)=>{if(depth===0){depth++;try{reader.captureNumeric(inner,undefined,innerValues);}finally{depth--;}}return x+z;});
 try{
  expect(reader.captureNumeric(outer,undefined,outerValues)).toBe(outerValues);
  expect(outerValues).toEqual(new Float64Array([4,11]));expect(innerValues).toEqual(new Float64Array([9,11]));
  f.query.mockImplementationOnce(()=>{outerLoan.handle=12;return 1;});
  expect(()=>reader.captureNumeric(outer,undefined,outerValues)).toThrow('Retired observation owner');
  outerLoan.handle=10;expect(reader.captureNumeric(outer,undefined,outerValues)).toEqual(new Float64Array([4,11]));
 }finally{f.host.dispose();}
});

test('query-bearing numeric destinations retain the complete generic capture and selection refusal',async()=>{
 const f=await fixture(),reader=new ObservationColumnsV2([
  {id:1,name:'bearing',source:{kind:'bearing',target:{kind:'player'}}},
 ],f.host.scope),destination=new Float64Array(1);
 try{
  expect(reader.captureNumeric(f.owners,undefined,destination)).toBe(destination);
  expect(destination).toEqual(reader.captureNumeric(f.owners));
  expect(()=>reader.captureNumeric(f.owners,[true],destination)).toThrow('Selected capture');
 }finally{f.host.dispose();}
});
