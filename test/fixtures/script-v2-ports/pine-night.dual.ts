/** The actual night guest, with the same explicit continuation and native
 * radial/ground replies under both ABI wrappers. Never enters a product. */
import night from '../../../src/shards/pine-hollow/behaviour/night.as?raw';
import { NIGHT_SPAWN } from '../../../src/shards/pine-hollow/generators/nightSpawn';
import { decisionBindingMap } from '@wildshard/format/decisionBindings';
import { spawnScriptRegistries } from '@wildshard/format/spawnScripts';
import { scriptV1Identifier } from '@wildshard/format/decisionScripts';
import { SCRIPT_V1_COMMANDS } from '@wildshard/format/scriptAbiV1';
import { expect } from 'vitest';
import { simulationPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const script = NIGHT_SPAWN.script, binding = decisionBindingMap(script,spawnScriptRegistries(NIGHT_SPAWN));
const names = [['actors','Actor'],['spawns','Spawn'],['fields','Field'],['flags','Flag'],['cues','Cue'],['channels','Channel'],['moves','Move']] as const;
const boundary = `let io:usize=0;let tick:i32=0;
export function begin(base:usize,now:i32):void{io=base;tick=now;}
${names.map(([kind,name]) => `export namespace ${name}{${Object.entries(binding.ids[kind] ?? {}).map(([alias,value]) => `export const ${scriptV1Identifier(alias)}:i32=${value};`).join('')}}`).join('')}
export namespace Params{${Object.entries(script.params).map(([name,value]) => `export const ${scriptV1Identifier(name)}:f64=${String(value)};`).join('')}}
export class State{${script.state.map((slot,i) => {
  const at = 256+i*8, name = scriptV1Identifier(slot.name);
  return `static get ${name}():${slot.type}{return ${slot.type === 'bool' ? `load<f64>(io+${at})==1` : `${slot.type}(load<f64>(io+${at}))`};}static set ${name}(value:${slot.type}){store<f64>(io+${at},${slot.type === 'bool' ? 'value?1.0:0.0' : 'f64(value)'});}`;
}).join('')}}
export class Clock{static get tick():i32{return tick;}}
@inline function actor(id:i32):void{if(id<1||id>8)unreachable();}
export namespace Read{
 export function x(id:i32):f64{actor(id);return load<f64>(io+512+usize(id)*32);}
 export function z(id:i32):f64{actor(id);return load<f64>(io+520+usize(id)*32);}
 export function hpShare(id:i32):f64{actor(id);return load<f64>(io+528+usize(id)*32);}
 export function alive(id:i32):bool{actor(id);return (i32(load<f64>(io+40))&(1<<(id-1)))!=0;}
 export function moving(id:i32):bool{actor(id);return (i32(load<f64>(io+48))&(1<<(id-1)))!=0;}
 export function nearestPlayer(id:i32):i32{actor(id);return 8;}
 export function distance(a:i32,b:i32):f64{return Math.hypot(x(a)-x(b),z(a)-z(b));}
 export function field(id:i32,field:i32):f64{actor(id);if(field<1||field>7)unreachable();return load<f64>(io+1024+usize(id*8+field)*8);}
 export function flag(id:i32):bool{if(id<1||id>2)unreachable();return load<f64>(io+56+usize(id)*8)!=0;}
 export function radial(angle:f64):i32{const n=i32(load<f64>(io+3008));if(n>=12)unreachable();store<f64>(io+7104+usize(n)*8,angle);store<f64>(io+3008,f64(n+1));store<f64>(io+2288,Math.sin(angle));store<f64>(io+2296,Math.cos(angle));return 2;}
 export function groundHeight(x:f64,z:f64):i32{const n=i32(load<f64>(io+3016));if(n>=12)unreachable();store<f64>(io+6800+usize(n)*16,x);store<f64>(io+6808+usize(n)*16,z);store<f64>(io+2288,load<f64>(io+2304+usize(n)*8));store<f64>(io+3016,f64(n+1));return 1;}
}
export namespace List{export function at(i:i32):f64{if(i<0||i>1)unreachable();return load<f64>(io+2288+usize(i)*8);}}
@inline function emit(op:i32,a:i32,b:i32=0,c:f64=0):void{
 const n=i32(load<f64>(io+3000));if(n>=64)unreachable();const at=io+4096+usize(n)*40;
 store<f64>(at,f64(op));store<f64>(at+8,f64(a));store<f64>(at+16,f64(b));store<f64>(at+24,c);store<f64>(at+32,0);store<f64>(io+3000,f64(n+1));
}
export namespace Do{
 export function field(a:i32,b:i32,c:f64):void{emit(${SCRIPT_V1_COMMANDS.field},a,b,c);}
 export function move(a:i32,b:i32,c:i32=0):void{emit(${SCRIPT_V1_COMMANDS.move},a,b,f64(c));}
 export function stop(a:i32):void{emit(${SCRIPT_V1_COMMANDS.stop},a);}
 export function cue(cue:i32,a:i32=0):void{emit(${SCRIPT_V1_COMMANDS.cue},a,cue);}
 export function channel(channel:i32,v:f64):void{emit(${SCRIPT_V1_COMMANDS.channel},0,channel,v);}
 export function spawn(spawn:i32):void{emit(${SCRIPT_V1_COMMANDS.spawn},0,spawn);}
 export function despawn(a:i32):void{emit(${SCRIPT_V1_COMMANDS.despawn},a);}
 export function flag(flag:i32,v:bool):void{emit(${SCRIPT_V1_COMMANDS.flag},0,flag,v?1.0:0.0);}
}`;
const adapter = `import {onStart,onTick} from './night';import {begin} from './generated/pineNight';
export function handle(io:usize,tick:i32):void{begin(io,tick);if(load<f64>(io)==0)onStart();else onTick(999);}`;
const sources = { 'generated/pineNight.ts': boundary,'adapter.ts': adapter };
const legacy = `import {handle} from './adapter';export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}export function ws_init(lo:i32,hi:i32):void{}export function ws_handle():i32{handle(16384,i32(load<f64>(16392)));return 0;}`;
const candidate = `import {handle} from './adapter';export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}export function ws_step(tick:i32,fuel:i32):i32{handle(1024,tick);return 0;}`;
const input = { authored: new Map([['night.ts',night]]),legacy: { source: legacy,sources },candidate: { source: candidate,sources,lane: 'sim',ioBytes: 8192 },pages: 1 } satisfies DualPortFixture['input'];
interface Frame {
  readonly start?: boolean; readonly state?: Readonly<Record<string,number>>;
  readonly night?: number; readonly limit?: number; readonly force?: number;
  readonly asked?: boolean; readonly done?: boolean; readonly alive?: number; readonly moving?: number;
  readonly player?: readonly [number,number]; readonly actors?: Readonly<Record<number,readonly [number,number,number]>>;
  readonly ground?: number;
}

export const port = { input,verify: pair => {
  const compare = simulationPair(pair,{ ioBytes: 8192,output: [{ offset: 1280,count: script.state.length,width: 8 },{ offset: 4024,count: 3,width: 8 },{ offset: 5120,count: 320,width: 8 },{ offset: 7824,count: 24,width: 8 },{ offset: 8128,count: 12,width: 8 }] });
  const params = script.params;
  const param = (name: string): number => { const value = params[name];if (value === undefined) throw new Error('Missing authored night parameter');return value; };
  const identity = (kind: typeof names[number][0],name: string): number => { const value = binding.ids[kind]?.[name];if (value === undefined) throw new Error('Missing authored night binding');return value; };
  const run = (tick: number,frame: Frame = {}) => compare(tick,(view,base) => {
    new Uint8Array(view.buffer,base,8192).fill(0);
    [frame.start ? 0 : 1,tick,frame.night ?? 1,frame.limit ?? 3,frame.force ?? 0,frame.alive ?? 127,frame.moving ?? 0].forEach((value,i) => { view.setFloat64(base+i*8,value,true); });
    view.setFloat64(base+64,Number(frame.asked ?? false),true);view.setFloat64(base+72,Number(frame.done ?? false),true);
    script.state.forEach((slot,i) => { view.setFloat64(base+256+i*8,frame.state?.[slot.name] ?? Number(slot.default),true); });
    for (let id = 1; id <= 8; id++) {
      const xyz = id === 8 ? [frame.player?.[0] ?? param('regionX'),frame.player?.[1] ?? param('regionZ'),1] : frame.actors?.[id] ?? [0,0,1];
      xyz.forEach((value,i) => { view.setFloat64(base+512+id*32+i*8,value,true); });
      for (const [name,value] of [['night',frame.night ?? 1],['limit',frame.limit ?? 3],['force',frame.force ?? 0]] as const) view.setFloat64(base+1024+(id*8+identity('fields',name))*8,value,true);
    }
    for (let i = 0; i < 12; i++) view.setFloat64(base+2304+i*8,frame.ground ?? 0,true);
  },(view,base) => {
    const count = view.getFloat64(base+3000,true), radials = view.getFloat64(base+3008,true), floors = view.getFloat64(base+3016,true);
    for (const [value,max] of [[count,64],[radials,12],[floors,12]]) if (!Number.isInteger(value) || value === undefined || max === undefined || value < 0 || value > max) throw new Error('Invalid night output count');
    return { state: Object.fromEntries(script.state.map((slot,i) => [slot.name,view.getFloat64(base+256+i*8,true)])),
      commands: Array.from({ length: count },(_,i) => Array.from({ length: 5 },(_unused,j) => view.getFloat64(base+4096+i*40+j*8,true))),
      angles: Array.from({ length: radials },(_,i) => view.getFloat64(base+7104+i*8,true)),
      ground: Array.from({ length: floors },(_,i) => [view.getFloat64(base+6800+i*16,true),view.getFloat64(base+6808+i*16,true)]) };
  });
  type Answer = ReturnType<typeof run>;
  const commands = (answer: Answer,kind: keyof typeof SCRIPT_V1_COMMANDS) => answer.commands.filter(row => row[0] === SCRIPT_V1_COMMANDS[kind]);
  const cue = (answer: Answer,name: string) => commands(answer,'cue').filter(row => row[2] === identity('cues',name));
  const count = (answer: Answer) => commands(answer,'channel').at(-1)?.[3];
  const defaults = Object.fromEntries(script.state.map(slot => [slot.name,Number(slot.default)]));
  const resumed = { ...defaults,lastTick: 600,rng: 123456789,acc: 0.4,roam: 5,race: 3,flee0: 2.5,woke1: 1 };
  expect(run(600,{ start: true,state: resumed })).toEqual({ state: resumed,commands: [],angles: [],ground: [] });

  // Tick-derived time, not the deliberately wrong onTick argument (999).
  const early = run(6);expect(early.state['acc']).toBe(0.1);expect(early.angles).toEqual([]);expect(count(early)).toBe(0);
  const beforeDue = run(59,{ state: early.state });expect(beforeDue.angles).toEqual([]);
  const spawned = run(60,{ state: beforeDue.state });
  expect(spawned.state).toMatchObject({ lastTick: 60,acc: 0,roam: 1,flee0: 0 });
  expect(commands(spawned,'spawn')).toEqual([[5,0,identity('spawns','roam.0.elk'),0,0]]);expect(cue(spawned,'call')).toHaveLength(1);expect(count(spawned)).toBe(1);
  // Independently lock the native [sin,cos] query convention and authored RNG.
  let rng = defaults['rng'] ?? 0;
  const random = (): number => { rng = (rng+0x6d2b79f5) >>> 0;let t = Math.imul(rng^(rng>>>15),rng|1);t ^= t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296; };
  const sites: number[][] = [];
  for (const angle of spawned.angles) {
    expect(angle).toBe(random()*Math.PI*2);const radius = Math.sqrt(random())*param('radius');
    const x = param('regionX')+Math.sin(angle)*param('axisX')*radius, z = param('regionZ')+Math.cos(angle)*param('axisZ')*radius;
    const distance = Math.hypot(x-param('regionX'),z-param('regionZ'));
    if (distance >= 45 && distance <= 150 && Math.hypot(x-param('excludeX'),z-param('excludeZ')) >= param('excludeR') && Math.abs(x) <= param('bound') && Math.abs(z) <= param('bound')) sites.push([x,z]);
  }
  expect(spawned.state['rng']).toBe(rng);expect(spawned.ground).toEqual(sites);
  expect(commands(spawned,'field').map(row => row[3])).toEqual(sites[0]);
  const second = run(120,{ state: spawned.state,actors: { 1: [param('regionX'),param('regionZ'),1] } });
  expect(commands(second,'spawn')).toEqual([[5,0,identity('spawns','roam.1.boar'),0,0]]);expect(second.state['roam']).toBe(3);
  const full = run(180,{ state: { ...second.state,roam: 15 },actors: { 1: [150,-40,1],2: [150,-40,1],3: [150,-40,1],4: [150,-40,1] } });
  expect(full.angles).toEqual([]);expect(count(full)).toBe(4);

  // At dawn, alive roamers flee once and retire only after the age threshold.
  const dawn = run(126,{ state: second.state,night: 0.34,limit: 0 });
  expect(cue(dawn,'flee')).toHaveLength(2);expect(dawn.state).toMatchObject({ flee0: 0.01,flee1: 0.01 });
  const fleeing = run(306,{ state: dawn.state,night: 0,limit: 0,moving: 3 });
  expect(commands(fleeing,'move')).toEqual([]);expect(commands(fleeing,'despawn')).toEqual([]);expect(fleeing.state['flee0']).toBe(3.01);
  const retired = run(342,{ state: fleeing.state,night: 0,limit: 0 });
  expect(commands(retired,'despawn')).toEqual([[6,1,0,0,0],[6,2,0,0,0]]);expect(cue(retired,'burst')).toHaveLength(2);expect(count(retired)).toBe(0);
  const dead = run(6,{ state: { roam: 15 },alive: 5,limit: 0 });expect(dead.state['roam']).toBe(5);expect(commands(dead,'despawn')).toEqual([]);
  const distant = run(60,{ state: { roam: 1 },limit: 0,player: [1000,1000] });expect(commands(distant,'despawn')).toEqual([[6,1,0,0,0]]);

  // Forced rejection still consumes exactly 24 RNG draws and one force token.
  const rejected = run(6,{ force: 1,player: [1000,1000] });expect(rejected.angles).toHaveLength(12);expect(rejected.state['rng']).toBe(((defaults['rng'] ?? 0)+24*0x6d2b79f5) >>> 0);expect(rejected.ground).toEqual([]);expect(commands(rejected,'spawn')).toEqual([]);
  expect(commands(rejected,'field')).toEqual([[4,1,identity('fields','force'),0,0]]);
  const underwater = run(60,{ ground: param('water')-1 });expect(underwater.angles).toHaveLength(12);expect(underwater.ground.length).toBeGreaterThan(0);expect(commands(underwater,'spawn')).toEqual([]);expect(underwater.state['roam']).toBe(0);
  expect(commands(run(60,{ ground: param('water') }),'spawn')).toHaveLength(1);
  expect(run(60,{ night: 0.55 }).angles).toEqual([]);

  // Millrace request, listen/wake, and a single completion flag transaction.
  const raceFrame = { asked: true,limit: 0,player: [param('millX'),param('millZ')] as const };
  expect(commands(run(60,{ ...raceFrame,night: 0.5 }),'spawn')).toEqual([]);
  const race = run(60,raceFrame);expect(race.state['race']).toBe(7);expect(count(race)).toBe(3);
  expect(commands(race,'spawn').map(row => row[2])).toEqual([0,1,2].map(i => identity('spawns',`race.${i}`)));
  const awake = run(66,{ ...raceFrame,state: race.state,actors: { 5: [param('millX')+19,param('millZ'),1],6: [0,0,0.9],7: [0,0,1] } });
  expect(awake.state).toMatchObject({ woke0: 1,woke1: 1,woke2: 0 });expect(cue(awake,'wake')).toHaveLength(2);expect(commands(awake,'stop').map(row => row[1])).toEqual([5,6]);
  const waiting = run(72,{ ...raceFrame,state: awake.state,moving: 64 });expect(cue(waiting,'wake')).toEqual([]);expect(commands(waiting,'move')).toEqual([]);
  const finished = run(120,{ ...raceFrame,state: waiting.state,alive: 0 });expect(finished.state['race']).toBe(0);expect(commands(finished,'flag')).toEqual([[7,0,identity('flags','done'),1,0]]);
  const after = run(180,{ ...raceFrame,state: structuredClone(finished.state),done: true,alive: 0 });expect(commands(after,'spawn')).toEqual([]);expect(commands(after,'flag')).toEqual([]);
  return Promise.resolve();
} } satisfies DualPortFixture;
