import { expect, test } from 'vitest';
import { EliteCore, memoryElitePersistence, type EliteCoreScript } from '../../shared/game/eliteSystem';
import { onFault,type Fault } from '@wildshard/engine/core/faults';

function fixture(): { core: EliteCore<EliteCoreScript>; effects: string[] } {
  const effects: string[] = [];
  const core = new EliteCore<EliteCoreScript>({ player: { position: { x: 0, z: 0 } }, condition: () => true },
    { spawned: () => { effects.push('spawned'); } }, 'continuation-fixture', memoryElitePersistence());
  for (const id of ['first', 'second']) core.add({ def: { id, lair: { x: 0, z: 0, r: 2 }, awareR: 10, engageR: 5, leashR: 20, rule: 'always', respawnMin: 1 },
    animal: null, spawn: () => { effects.push('spawn'); }, despawn: () => { effects.push('despawn'); },
    tick: () => { effects.push('tick'); }, enterPhase2: () => { effects.push('phase'); }, reset: () => { effects.push('reset'); }, trophy: () => { effects.push('trophy'); } });
  return { core, effects };
}

test('elite core resumes legacy lair fields quietly and refuses an incompatible roster before mutation', () => {
  const { core, effects } = fixture(), before = core.snapshot();
  const saved = { ...before, clocks: { saveT: 0.75, lastDusk: true }, entries: before.entries.map((row, i) => ({ ...row, state: 'engaged' as const,
    timer: 4, lastHit: i === 0 ? null : 2, phase2: true })), version: 4, scripts: [] };
  const commit = core.prepareRestore(saved);
  expect(core.snapshot()).toEqual(before);
  commit();
  expect(core.snapshot().clocks).toEqual(saved.clocks);
  expect(core.snapshot().entries).toEqual(saved.entries);
  expect(core.entries[0]?.lastHit).toBe(-Infinity);
  expect(effects).toEqual([]);
  const restored = core.snapshot();
  expect(() => core.prepareRestore({ ...saved, entries: [...saved.entries].reverse() })).toThrow(/continuation/);
  expect(() => core.prepareRestore({ ...saved, entries: saved.entries.slice(1) })).toThrow(/continuation/);
  expect(() => core.prepareRestore({ ...saved, entries: saved.entries.map(row => ({ ...row, unexpected: true })) })).toThrow();
  expect(() => core.prepareRestore({ ...saved, clocks: { saveT: Number.NaN, lastDusk: true } })).toThrow();
  expect(core.snapshot()).toEqual(restored);
  expect(effects).toEqual([]);
  const prepared = core.prepareRestore(saved);
  core.entries.reverse();
  expect(prepared).toThrow(/roster changed/);
  expect(core.snapshot().entries.map(row => row.id)).toEqual(['second', 'first']);
});

function activeFixture() {
  const calls:string[]=[],core=new EliteCore<EliteCoreScript>({player:{position:{x:0,z:0}},condition:()=>true},{},'frame-fixture',memoryElitePersistence());
  for(const id of ['first','second'])core.add({def:{id,lair:{x:0,z:0,r:2},awareR:10,engageR:5,leashR:20,rule:'always',respawnMin:1},
    animal:{alive:true,position:{x:0,z:0},hp:100,maxHp:100,lastHitT:-Infinity},spawn:()=>{calls.push(`${id}:spawn`);},despawn:()=>undefined,
    tick:()=>{calls.push(`${id}:tick`);},enterPhase2:()=>undefined,reset:()=>undefined,trophy:()=>undefined});
  return {core,calls};
}

test('one refused elite frame leaves the next entry running and retries without disabling its owner',()=>{
  const {core,calls}=activeFixture(),faults:Fault[]=[],off=onFault(fault=>{faults.push(fault);});
  const first=core.entries[0],second=core.entries[1];if(first===undefined||second===undefined)throw new Error('Missing original entries');
  let refuse=true;
  first.script.tick=()=>{calls.push('first:tick');if(refuse)throw new Error('Retired or replaced elite output owner');};
  try{
    core.initialize();core.update(.1,1);core.update(.1,2);
    expect(calls.filter(call=>call.endsWith(':tick'))).toEqual(['first:tick','second:tick','first:tick','second:tick']);
    expect(faults).toHaveLength(1);expect(faults[0]).toMatchObject({system:'elite.rules',verdict:'retry',error:{message:'Retired or replaced elite output owner'}});
    refuse=false;expect(core.update(.1,3)).toBe(first);expect(calls.at(-1)).toBe('second:tick');expect(faults).toHaveLength(1);
    expect(first.state).toBe('engaged');expect(second.state).toBe('engaged');
  }finally{off();}
});

test('a phase callback keeps its accepted entry prefix and never replays the transition after refusal',()=>{
  const {core,calls}=activeFixture(),faults:Fault[]=[],off=onFault(fault=>{faults.push(fault);});
  const first=core.entries[0];if(first?.script.animal===undefined||first.script.animal===null)throw new Error('Missing original actor');
  let phases=0;first.script.animal.hp=40;first.script.enterPhase2=()=>{phases++;throw new Error('Phase native refusal');};
  try{
    core.initialize();core.update(.1,1);
    expect(first.phase2).toBe(true);expect(first.lockHp).toBe(40);expect(phases).toBe(1);
    expect(calls.filter(call=>call.endsWith(':tick'))).toEqual(['second:tick']);
    core.update(.1,2);expect(phases).toBe(1);expect(calls.slice(-2)).toEqual(['first:tick','second:tick']);
    expect(faults).toHaveLength(1);expect(faults[0]).toMatchObject({verdict:'retry',error:{message:'Phase native refusal'}});
  }finally{off();}
});

test('each failing entry reports independently while direct initialization stays strict',()=>{
  const {core}=activeFixture(),faults:Fault[]=[],off=onFault(fault=>{faults.push(fault);});
  try{
    for(const entry of core.entries)entry.script.tick=()=>{throw new Error(`Refused ${entry.script.def.id}`);};
    core.initialize();core.update(.1,1);core.update(.1,2);
    expect(faults.map(fault=>fault.error instanceof Error?fault.error.message:'wrong error')).toEqual(['Refused first','Refused second']);
    const fresh=activeFixture(),first=fresh.core.entries[0];if(first===undefined)throw new Error('Missing fresh entry');
    first.script.spawn=()=>{throw new Error('Invalid original spawn owner');};
    expect(()=>fresh.core.initialize()).toThrow('Invalid original spawn owner');expect(faults).toHaveLength(2);
  }finally{off();}
});
