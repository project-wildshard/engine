/** H13's three-way oracle: retained shipping v0 bytes versus the same new
 * explicit-continuation AS body compiled and admitted under v1 and v2. */
import { expect } from 'vitest';
import * as v from 'valibot';
import { parseDirector,type DirectorEvent } from '@wildshard/format/director';
import { scriptV1Identifier } from '@wildshard/format/decisionScripts';
import { prepareEmbeddedDirector,embeddedDirectorBytes } from '../../src/shared/game/plugin/director';
import { compileScript } from '../../src/sharddev/bake/compileScript';
import { generateDirectorAbi } from '../../src/sharddev/directorAbi';
import { simulationPair } from './script-v2-projection';
import type { DualPortFixture } from './script-v2-port';

interface StateRow { readonly name: string; readonly type: 'f64' | 'bool'; readonly initial: number }
export interface DirectorSession {
  readonly run: (observation: Readonly<Record<string,number>>,options?: {
    readonly dt?: number; readonly events?: readonly string[]; readonly dispatch?: boolean; readonly roundtrip?: boolean;
  }) => { readonly state: Readonly<Record<string,number>>; readonly events: readonly DirectorEvent[] };
}
export function directorPort(options: {
  readonly source: string; readonly original: string; readonly declaration: unknown;
  readonly embedded: { readonly module: string; readonly bytes: Uint8Array };
  readonly header: string; readonly states: readonly StateRow[]; readonly parameters: readonly string[];
  readonly verify: (create: () => DirectorSession) => void;
}): DualPortFixture {
  const data = parseDirector(options.declaration), states = options.states;
  if (options.parameters.length !== data.parameters.length) throw new Error('Incomplete director parameter samples');
  const boundary = `let io:usize=0;let tick:i32=0;export function begin(base:usize,now:i32):void{io=base;tick=now;}
export class Clock{static get tick():i32{return tick;}static get dt():f64{return load<f64>(io+16);}}
export class Inputs{${data.inputs.map((row,i) => `static get ${scriptV1Identifier(row.key)}():f64{return load<f64>(io+${1024+i*8});}`).join('')}}
export class Params{${options.parameters.map((name,i) => `static get ${name}():f64{return load<f64>(io+${768+i*8});}`).join('')}}
export class Incoming{static get count():i32{return i32(load<f64>(io+32));}static type(i:i32):i32{if(i<0||i>=Incoming.count)unreachable();return i32(load<f64>(io+64+usize(i)*8));}}
export class State{${states.map((row,i) => `static get ${row.name}():${row.type}{return ${row.type === 'bool' ? `load<f64>(io+${512+i*8})==1` : `load<f64>(io+${512+i*8})`};}static set ${row.name}(value:${row.type}){store<f64>(io+${512+i*8},${row.type === 'bool' ? 'value?1.0:0.0' : 'value'});}`).join('')}}
export namespace Do{export function event(type:i32,value:f64=0):void{const n=i32(load<f64>(io+2048));if(n>=8)unreachable();const at=io+2056+usize(n)*24;store<f64>(at,f64(type));store<f64>(at+8,${data.entity}.0);store<f64>(at+16,value);store<f64>(io+2048,f64(n+1));}}`;
  const sources = { [`generated/${options.header}.ts`]: boundary };
  const imports = `import {onTick} from './directorV2';import {begin} from './generated/${options.header}';`;
  const legacy = `${imports}export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}export function ws_init(lo:i32,hi:i32):void{}export function ws_handle():i32{begin(16384,i32(load<f64>(16392)));onTick();return 0;}`;
  const candidate = `${imports}export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}export function ws_step(tick:i32,fuel:i32):i32{begin(1024,tick);onTick();return 0;}`;
  const input = { authored: new Map([['directorV2.ts',options.source]]),legacy: { source: legacy,sources },candidate: { source: candidate,sources,lane: 'sim',ioBytes: 4096 },pages: 1 } satisfies DualPortFixture['input'];
  return { input,retainedV0: { path: 'director.ts',source: options.original },verify: async pair => {
    // Keep the shipping compiler path and the actual embedded v0 artifact
    // hash-pinned; the port is not a regeneration or save migration.
    const pinned = embeddedDirectorBytes(data,options.embedded);
    expect(await compileScript(options.original,{ maximumPages: 1,sources: { 'wildshard-director.ts': generateDirectorAbi(data) } })).toEqual(pinned);
    const oldFactory = await prepareEmbeddedDirector(data,options.embedded,357);
    options.verify(() => {
      const old = oldFactory(), compare = simulationPair(pair,{ ioBytes: 4096,output: [{ offset: 1536,count: states.length,width: 8 },{ offset: 3072,count: 25,width: 8 }] });
      let state: Record<string,number> = Object.fromEntries(states.map(row => [row.name,row.initial]));
      return { run: (observation,frame = {}) => {
        const tick = frame.dispatch ? old.tick : old.tick+1, dt = frame.dispatch ? 0 : frame.dt ?? 1/60;
        const events = (frame.events ?? []).map(key => {
          const event = data.events.find(row => row.key === key && row.direction === 'input');if (event === undefined) throw new Error('Unknown director input');old.enqueue(key);return event.id;
        });
        const expected = frame.dispatch ? old.dispatch(observation) : old.step(tick,observation,dt);
        const answer = compare(tick,(view,base) => {
          new Uint8Array(view.buffer,base,4096).fill(0);
          view.setFloat64(base+8,tick,true);view.setFloat64(base+16,dt,true);view.setFloat64(base+32,events.length,true);
          events.forEach((id,i) => { view.setFloat64(base+64+i*8,id,true); });
          states.forEach((row,i) => { const value = state[row.name];if (value === undefined) throw new Error('Missing director continuation');view.setFloat64(base+512+i*8,value,true); });
          data.parameters.forEach((value,i) => { view.setFloat64(base+768+i*8,value,true); });
          data.inputs.forEach((row,i) => { const value = observation[row.key];if (value === undefined) throw new Error('Missing director observation');view.setFloat64(base+1024+i*8,value,true); });
        },(view,base) => {
          const count = view.getFloat64(base+2048,true);if (!Number.isInteger(count) || count < 0 || count > 8) throw new Error('Invalid director event count');
          return { state: Object.fromEntries(states.map((row,i) => [row.name,view.getFloat64(base+512+i*8,true)])),events: Array.from({ length: count },(_,i): DirectorEvent => {
            const at = base+2056+i*24, id = view.getFloat64(at,true), event = data.events.find(row => row.id === id && row.direction === 'output');
            if (event === undefined || view.getFloat64(at+8,true) !== data.entity) throw new Error('Invalid director event identity');
            return { director: data.id,tick,key: event.key,type: event.type,value: view.getFloat64(at+16,true) };
          }) };
        });
        expect(answer.events).toEqual(expected);state = answer.state;
        if (frame.roundtrip) {
          const saved = old.snapshot(), restored = oldFactory();restored.restore(saved);expect(restored.snapshot()).toBe(saved);old.restore(restored.snapshot());
          const wire = JSON.stringify(state);state = v.parse(v.record(v.string(),v.number()),JSON.parse(wire));expect(JSON.stringify(state)).toBe(wire);
        }
        return answer;
      } };
    });
  } };
}
