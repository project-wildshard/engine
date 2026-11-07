/** Test-only numeric adapter for the four real Pine elite guests. Declarations
 * supply actual parameter values, state types and generated binding identities. */
import common from '../../src/shards/pine-hollow/behaviour/elites/common.as?raw';
import { ELITE_FEATURE_ROWS } from '../../src/shards/pine-hollow/generators/eliteFeatureRows';
import { parseSpawnScript,spawnScriptRegistries } from '@wildshard/format/spawnScripts';
import { decisionBindingMap } from '@wildshard/format/decisionBindings';
import { scriptV1Identifier } from '@wildshard/format/decisionScripts';
import { SCRIPT_V1_COMMANDS } from '@wildshard/format/scriptAbiV1';
import { simulationPair } from './script-v2-projection';
import type { DualPortFixture } from './script-v2-port';

type Columns = Readonly<Record<string,number>>;
type Kind = 'field' | 'move' | 'strike' | 'cue' | 'channel' | 'spawn';
export interface EliteFrame {
  readonly state?: Columns; readonly fields?: Columns; readonly self?: number; readonly target?: number;
  readonly alive?: boolean; readonly movingStrike?: number; readonly group?: number; readonly dt?: number; readonly value?: number;
  readonly position?: readonly [number,number]; readonly player?: readonly [number,number]; readonly yaw?: number;
  readonly random?: readonly number[]; readonly ground?: readonly number[];
}
export interface EliteAnswer { readonly state: Record<string,number>; readonly commands: number[][]; readonly draws: number; readonly floors: number; readonly ground: number[][] }
export interface EliteShadow {
  readonly params: Columns;
  readonly run: (event: 'start' | 'signal' | 'tick',frame?: EliteFrame) => EliteAnswer;
  readonly has: (answer: EliteAnswer,kind: Kind,name: string) => boolean;
  readonly last: (answer: EliteAnswer,kind: Kind,name: string) => number | undefined;
}

export function elitePort(id: string,source: string,verify: (shadow: EliteShadow) => void): DualPortFixture {
  const fight = ELITE_FEATURE_ROWS.fights.find(row => row.def.id === id);if (fight === undefined) throw new Error('Unknown authored elite');
  const program = parseSpawnScript(fight.program), script = program.script, binding = decisionBindingMap(script,spawnScriptRegistries(program));
  const names = [['actors','Actor'],['moves','Move'],['strikes','Strike'],['fields','Field'],['cues','Cue'],['channels','Channel'],['spawns','Spawn']] as const;
  const fieldWidth = program.fields.length+1;
  const boundary = `let io:usize=0;export function begin(base:usize):void{io=base;}
${names.map(([kind,name]) => `export namespace ${name}{${Object.entries(binding.ids[kind] ?? {}).map(([alias,value]) => `export const ${scriptV1Identifier(alias)}:i32=${value};`).join('')}}`).join('')}
export namespace Params{${Object.entries(script.params).map(([name,value]) => `export const ${scriptV1Identifier(name)}:f64=${String(value)};`).join('')}}
export class State{${script.state.map((slot,i) => {
    const at = 256+i*8, name = scriptV1Identifier(slot.name);
    return `static get ${name}():${slot.type}{return ${slot.type === 'bool' ? `load<f64>(io+${at})==1` : `${slot.type}(load<f64>(io+${at}))`};}static set ${name}(value:${slot.type}){store<f64>(io+${at},${slot.type === 'bool' ? 'value?1.0:0.0' : 'f64(value)'});}`;
  }).join('')}}
export class Clock{static get self():i32{return i32(load<f64>(io+16));}}
@inline function actor(id:i32):void{if(id<1||id>4)unreachable();}
export namespace Read{
 export function x(id:i32):f64{actor(id);return load<f64>(io+512+usize(id)*32);}
 export function z(id:i32):f64{actor(id);return load<f64>(io+520+usize(id)*32);}
 export function yaw(id:i32):f64{actor(id);return load<f64>(io+528+usize(id)*32);}
 export function alive(id:i32):bool{actor(id);return load<f64>(io+536+usize(id)*32)!=0;}
 export function field(id:i32,field:i32):f64{actor(id);if(field<1||field>=${fieldWidth})unreachable();return load<f64>(io+1024+usize(id*${fieldWidth}+field)*8);}
 export function nearestPlayer(id:i32):i32{actor(id);return i32(load<f64>(io+32));}
 export function hpShare(id:i32):f64{actor(id);return 1;}
 export function distance(a:i32,b:i32):f64{return Math.hypot(x(a)-x(b),z(a)-z(b));}
 export function strikeState(id:i32):i32{actor(id);return i32(load<f64>(io+40));}
 export function spawnGroupAlive(id:i32):i32{return i32(load<f64>(io+48));}
 export function random():f64{const n=i32(load<f64>(io+3008));if(n>=32)unreachable();store<f64>(io+3008,f64(n+1));return load<f64>(io+2048+usize(n)*8);}
 export function groundHeight(x:f64,z:f64):i32{const n=i32(load<f64>(io+3016));if(n>=16)unreachable();store<f64>(io+6800+usize(n)*16,x);store<f64>(io+6808+usize(n)*16,z);store<f64>(io+2288,load<f64>(io+2304+usize(n)*8));store<f64>(io+3016,f64(n+1));return 1;}
}
export namespace List{export function at(i:i32):f64{if(i!=0)unreachable();return load<f64>(io+2288);}}
@inline function emit(op:i32,a:i32,b:i32=0,c:f64=0):void{
 const n=i32(load<f64>(io+3000));if(n>=64)unreachable();const at=io+4096+usize(n)*40;
 store<f64>(at,f64(op));store<f64>(at+8,f64(a));store<f64>(at+16,f64(b));store<f64>(at+24,c);store<f64>(at+32,0);store<f64>(io+3000,f64(n+1));
}
export namespace Do{
 export function field(a:i32,b:i32,c:f64):void{emit(${SCRIPT_V1_COMMANDS.field},a,b,c);}
 export function move(a:i32,b:i32,c:i32=0):void{emit(${SCRIPT_V1_COMMANDS.move},a,b,f64(c));}
 export function strike(a:i32,b:i32,c:i32=0):void{emit(${SCRIPT_V1_COMMANDS.strike},a,b,f64(c));}
 export function stop(a:i32):void{emit(${SCRIPT_V1_COMMANDS.stop},a);}
 export function cue(cue:i32,a:i32=0):void{emit(${SCRIPT_V1_COMMANDS.cue},a,cue);}
 export function channel(channel:i32,v:f64):void{emit(${SCRIPT_V1_COMMANDS.channel},0,channel,v);}
 export function spawn(spawn:i32):void{emit(${SCRIPT_V1_COMMANDS.spawn},0,spawn);}
}`;
  const path = script.source.replace(/^behaviour\//u,'').replace(/\.as$/u,'.ts'), header = `generated/${scriptV1Identifier(script.id)}.ts`;
  const adapter = `import {onStart,onSignal,onTick} from './${path.slice(0,-3)}';import {begin} from './${header.slice(0,-3)}';
export function handle(io:usize):void{begin(io);const event=i32(load<f64>(io));if(event==0)onStart();else if(event==1)onSignal(0,load<f64>(io+24),0);else if(event==2)onTick(load<f64>(io+8));else unreachable();}`;
  const sources = { [header]: boundary,'adapter.ts': adapter };
  const legacy = `import {handle} from './adapter';export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}export function ws_init(lo:i32,hi:i32):void{}export function ws_handle():i32{handle(16384);return 0;}`;
  const candidate = `import {handle} from './adapter';export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}export function ws_step(tick:i32,fuel:i32):i32{handle(1024);return 0;}`;
  const input = { authored: new Map([[path,source],['elites/common.ts',common]]),legacy: { source: legacy,sources },candidate: { source: candidate,sources,lane: 'sim',ioBytes: 8192 },pages: 1 } satisfies DualPortFixture['input'];
  return { input,verify: pair => {
    const compare = simulationPair(pair,{ ioBytes: 8192,output: [{ offset: 1280,count: script.state.length,width: 8 },{ offset: 4024,count: 3,width: 8 },{ offset: 5120,count: 320,width: 8 },{ offset: 7824,count: 32,width: 8 }] });
    const params = script.params;
    const run: EliteShadow['run'] = (event,frame = {}) => compare(6,(view,base) => {
      new Uint8Array(view.buffer,base,8192).fill(0);
      const self = frame.self ?? 1, x = frame.position?.[0] ?? params['lairX'] ?? 0, z = frame.position?.[1] ?? params['lairZ'] ?? 0;
      [event === 'start' ? 0 : event === 'signal' ? 1 : 2,frame.dt ?? 0.1,self,frame.value ?? 0,frame.target ?? 4,frame.movingStrike ?? 0,frame.group ?? 1].forEach((value,i) => { view.setFloat64(base+i*8,value,true); });
      script.state.forEach((slot,i) => { view.setFloat64(base+256+i*8,frame.state?.[slot.name] ?? Number(slot.default),true); });
      for (let who = 1; who <= 4; who++) {
        const actor = who === 4 ? [frame.player?.[0] ?? x+20,frame.player?.[1] ?? z,frame.yaw ?? 0,1] : [x,z,0,Number(frame.alive ?? true)];
        actor.forEach((value,i) => { view.setFloat64(base+512+who*32+i*8,value,true); });
        for (const [name,field] of Object.entries(binding.ids['fields'] ?? {})) view.setFloat64(base+1024+(who*fieldWidth+field)*8,frame.fields?.[name] ?? (name === 'engaged' ? 1 : name === 'lastHit' ? -1000000 : 0),true);
      }
      for (let i = 0; i < 32; i++) view.setFloat64(base+2048+i*8,frame.random?.[i] ?? 0.25,true);
      for (let i = 0; i < 16; i++) view.setFloat64(base+2304+i*8,frame.ground?.[i] ?? 0,true);
    },(view,base) => {
      const count = view.getFloat64(base+3000,true), floors = view.getFloat64(base+3016,true);
      if (!Number.isInteger(count) || count < 0 || count > 64 || !Number.isInteger(floors) || floors < 0 || floors > 16) throw new Error('Invalid elite output count');
      return { state: Object.fromEntries(script.state.map((slot,i) => [slot.name,view.getFloat64(base+256+i*8,true)])),
        commands: Array.from({ length: count },(_,i) => Array.from({ length: 5 },(_unused,j) => view.getFloat64(base+4096+i*40+j*8,true))),
        draws: view.getFloat64(base+3008,true),floors,ground: Array.from({ length: floors },(_,i) => [view.getFloat64(base+6800+i*16,true),view.getFloat64(base+6808+i*16,true)]) };
    });
    const namespaces = { field: 'fields',move: 'moves',strike: 'strikes',cue: 'cues',channel: 'channels',spawn: 'spawns' } as const;
    const matches = (answer: EliteAnswer,kind: Kind,name: string): number[][] => {
      const identity = binding.ids[namespaces[kind]]?.[name];if (identity === undefined) throw new Error('Unknown elite command binding');
      return answer.commands.filter(row => row[0] === SCRIPT_V1_COMMANDS[kind] && row[2] === identity);
    };
    verify({ params,run,has: (answer,kind,name) => matches(answer,kind,name).length > 0,last: (answer,kind,name) => matches(answer,kind,name).at(-1)?.[3] });
    return Promise.resolve();
  } };
}
