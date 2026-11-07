import type { AudioMusic, AudioSampleMix, AudioAmbienceLifecycle, AudioObservationSystem, AudioAmbienceRouting, AudioNodeRow, AudioOneShotSchedule, AudioPhraseProgram, SynthBedGraph, AudioMixExpr, AudioMixRecipe } from '@wildshard/format/audioProfiles';
import type { ScoreSelection } from '../../../client/engine/audio/scoreSelection';

/** Same-byte platform sample catalogue; gains apply to admitted named loops. */
export interface AudioSampleProfile { set: string; bed: string; loopGains: Readonly<Record<string, number>>; omitLoops?: readonly string[] | undefined; omitShots?: readonly string[] | undefined; omitSlots?: readonly string[] | undefined }
/** Existing music catalogue and bounded scene selection; stem decoding and bar-grid playback remain engine-owned. */
export interface AudioMusicProfile {
  controlTension?: 'late';
  setPlayback?:AudioMusic['setPlayback'];
  setCatalogue?:AudioMusic['setCatalogue'];
  id: string; base: string; slots: readonly string[]; bootSlots: readonly string[]; synthLead: 'pluck' | 'marimba'; minFade: number;
  lifecycle?:{persistent:boolean;dispose:boolean;logChanges:boolean;bossScene?:string};
  source: { dir: string; manifestKey: string } | null; sets: Readonly<Record<string, string>>;
  selection: readonly ScoreSelection[]; selectMode: 'first' | 'all';
  /** Declared cache/decode policy, preserving slot fallback or an entire boot bank. */
  catalogue?: { mode:'slots'|'bank'; extraStings:readonly ('pickup'|'death'|'chunk'|'dawn')[]; stingSets:Readonly<Partial<Record<'pickup'|'death'|'chunk'|'dawn',string>>> } | undefined;
}
/** Named circular ambience zones; a source id resolves a trusted moving-emitter or geometry port. */
export interface AudioZone { id: string; x: number; z: number; inner: number; outer: number; gain: number; /** Exact authored width; avoids subtracting rounded outer/inner radii. */ fade?: number | undefined; open?: boolean | undefined; source?: string | undefined }
/** Mixer timing, bed levels, room sends and named zones consumed by a trusted catalogue recipe. */
export interface AudioZoneProfile {
  sampleMix?:AudioSampleMix;
  lifecycle?:AudioAmbienceLifecycle;
  routing?: AudioAmbienceRouting | undefined;
  mix?: AudioMixRecipe | undefined;
  graph?: SynthBedGraph | undefined;
  programs?: Readonly<Record<string,AudioPhraseProgram>> | undefined;
  schedules?: readonly AudioOneShotSchedule[] | undefined;
  nodes?: readonly AudioNodeRow[] | undefined;
  id: string; smoothSeconds: number; tickHz: number; silentSeconds: number; holdSeconds: number;
  levels: Readonly<Record<string, number>>;
  /** Rectangle-distance blend regions and admitted bed/sample names, for enclosed scenes. */
  blendMetres?: number | undefined; rectangles?: readonly { id: string; zone: string; x0: number; x1: number; z0: number; z1: number }[] | undefined;
  beds?: readonly { id: string; zone: string }[] | undefined; positional?: { sample: string; max: number; reach: number } | undefined;
  wet: Readonly<Record<string, number>>; zones: readonly AudioZone[];
}

/** Refuse a missing required recipe before its runtime graph can start. */
export function requireAudioProfile<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Missing declared audio profile: ${name}`);
  return value;
}
/** Resolve a declared mixer level or room send without silently changing the previous recipe. */
export function requireAudioLevel(levels: Readonly<Record<string, number>>, id: string): number {
  return requireAudioProfile(levels[id], id);
}


/** Evaluate the admitted algebra without clocks, random draws or audio allocation. */
export function audioMixValue(expr:AudioMixExpr,read:(id:string)=>number):number {
  if(typeof expr==='number')return expr;if(typeof expr==='string')return read(expr);
  const arg=(index:number):number=>{const value=expr[index];if(value===undefined)throw new Error('Missing audio mix argument');return audioMixValue(value,read);};
  const truthy=(value:number):boolean=>value!==0&&!Number.isNaN(value);
  switch(expr[0]){
    case '+':{let value=arg(1);for(let i=2;i<expr.length;i++)value+=arg(i);return value;}
    case '*':{let value=arg(1);for(let i=2;i<expr.length;i++)value*=arg(i);return value;}
    case '-':return arg(1)-arg(2);case '/':return arg(1)/arg(2);
    case '%':return arg(1)%arg(2);case 'pow':return arg(1)**arg(2);case 'cos':return Math.cos(arg(1));case 'exp':return Math.exp(arg(1));case 'tanh':return Math.tanh(arg(1));case 'lerp':{const a=arg(1),b=arg(2),u=arg(3);return a+(b-a)*u;}
    case 'min':return Math.min(arg(1),arg(2));case 'max':return Math.max(arg(1),arg(2));
    case 'clamp':return Math.max(arg(2),Math.min(arg(3),arg(1)));
    case 'round':return Math.round(arg(1));case 'floor':return Math.floor(arg(1));case 'abs':return Math.abs(arg(1));case 'sin':return Math.sin(arg(1));case 'hypot':return Math.hypot(arg(1),arg(2));
    case 'ss':{const a=arg(1),b=arg(2),x=arg(3),t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
    case 'in':{const value=arg(1);return value>arg(2)&&value<arg(3)?1:0;}
    case 'lt':return arg(1)<arg(2)?1:0;case 'gt':return arg(1)>arg(2)?1:0;
    case 'if':return truthy(arg(1))?arg(2):arg(3);
    case 'and':{for(let i=1;i<expr.length;i++)if(!truthy(arg(i)))return 0;return 1;}
    case 'or':{for(let i=1;i<expr.length;i++)if(truthy(arg(i)))return 1;return 0;}
    case 'not':return truthy(arg(1))?0:1;
    case 'dist':case 'zone':{
      const name=expr[1];if(typeof name!=='string')throw new Error('Audio mix point requires a name');
      const distance=Math.hypot(read('x')-read(`${name}.x`),read('z')-read(`${name}.z`));
      if(expr[0]==='dist')return distance;
      const outer=read(`${name}.outer`),inner=read(`${name}.inner`),t=Math.max(0,Math.min(1,(distance-outer)/(inner-outer)));return t*t*(3-2*t);
    }
    default:throw new Error('Unknown audio mix operator');
  }
}
/** Apply declared mix rows in original order; a borrowed after-level phase retains live emitter steering. */
export function evaluateAudioMix(rows:AudioMixRecipe,ports:{read:(id:string)=>number;write:(id:string,value:number)=>void;
  level:(id:string,value:number)=>void;afterLevels?:()=>void;cutoff:(id:string,value:number)=>void;
  room:(id:string,weight:number,level:number)=>void;diag:(id:string,value:number)=>void;shade?:(gain:number,cutoff:number)=>void}):string {
  const value=(expr:AudioMixExpr):number=>audioMixValue(expr,ports.read);
  for(const [id,expr] of rows.values)ports.write(id,value(expr));
  for(const [id,expr] of rows.levels)ports.level(id,value(expr));
  ports.afterLevels?.();
  for(const [id,expr] of rows.cutoffs)ports.cutoff(id,value(expr));
  if(rows.shade!==undefined)ports.shade?.(value(rows.shade[0]),value(rows.shade[1]));
  for(const room of rows.rooms)ports.room(room.id,value(room.weight),value(room.level));
  for(const [id,expr] of rows.diag)ports.diag(id,value(expr));
  let selected=rows.defaultZone,best=rows.zoneFloor;
  for(const [id,expr] of rows.zones){const weight=value(expr);if(rows.zoneMode==='first'){if(weight!==0&&!Number.isNaN(weight)){selected=id;break;}}else if(weight>best){selected=id;best=weight;}}
  return selected;
}

/** Borrowed living actor identity; transition history is retained without copying the native roster. */
export interface AudioObservationEntity {readonly kind:string;readonly state:string;readonly alive:boolean;readonly position:{readonly x:number;readonly y:number;readonly z:number}}
export interface AudioObservationEvent {readonly value?:number;readonly previous?:number;readonly entity?:AudioObservationEntity}
export interface AudioObservationPorts {
  readonly inputs:ReadonlyMap<string,()=>unknown>;
  readonly writers:ReadonlyMap<string,(value:number)=>void>;
  readonly commands:ReadonlyMap<string,(dt:number,t:number,event:AudioObservationEvent)=>void>;
  readonly entities?:Readonly<Record<string,()=>readonly AudioObservationEntity[]>>;
}
/** Compile bounded observation order once; clocks, actor states and sound calls remain actual native loans. */
export function createAudioObserver(row:AudioObservationSystem,ports:AudioObservationPorts):{run:(dt:number,t:number)=>void;state:(id:string)=>number} {
  const inputRows=new Map(row.inputs.map(input=>[input.id,input])),native=new Map<string,unknown>();
  for(const input of row.inputs)if(!ports.inputs.has(input.source))throw new Error(`Missing audio observation owner: ${input.source}`);
  for(const field of row.frame)if(!ports.writers.has(field.write))throw new Error(`Missing audio observation target: ${field.write}`);
  const state=new Map(Object.entries(row.initial)),history=new Map<Extract<AudioObservationSystem['steps'][number],{kind:'entities'}>,WeakMap<AudioObservationEntity,string>>(),empty:AudioObservationEvent={};let elapsed=0;
  const command=(id:string):NonNullable<ReturnType<AudioObservationPorts['commands']['get']>>=>{const fn=ports.commands.get(id);if(fn===undefined)throw new Error(`Missing audio observation command: ${id}`);return fn;};
  for(const step of row.steps){
    if(step.kind==='state'&&step.changed!==undefined)command(step.changed);
    if(step.kind==='call'||step.kind==='entities')command(step.call);
    if(step.kind==='entities'){if(ports.entities?.[step.list]===undefined)throw new Error('Missing audio observation roster');history.set(step,new WeakMap());}
  }
  let time=0;
  const read=(id:string):number=>{
    if(id==='t')return time;if(id.startsWith('state.'))return state.get(id.slice(6))??0;
    const input=inputRows.get(id);if(input===undefined)throw new Error(`Missing audio observation input: ${id}`);
    if(!native.has(input.source))native.set(input.source,ports.inputs.get(input.source)?.());
    let value:unknown=native.get(input.source);
    for(const key of input.path)value=typeof value==='object'&&value!==null?Reflect.get(value,key):undefined;
    switch(input.op){
      case 'present':return value===undefined||value===null?0:1;
      case 'truth':return Number(Boolean(value));
      case 'equals':return value===input.value?1:0;
      case 'number':if(typeof value==='number'&&Number.isFinite(value))return value;if(input.fallback!==undefined)return input.fallback;throw new Error(`Non-numeric audio observation: ${id}`);
      default:throw new Error('Unsupported audio observation input');
    }
  };
  const evaluate=(expr:AudioMixExpr):number=>audioMixValue(expr,read);
  return {state:id=>state.get(id)??0,run:(dt,t)=>{
    time=t;native.clear();
    for(const field of row.frame)if(field.when===undefined||evaluate(field.when)!==0)ports.writers.get(field.write)?.(evaluate(field.value));
    elapsed+=dt;if(elapsed<row.interval)return;elapsed=0;
    for(const step of row.steps){
      switch(step.kind){
        case 'state':{
          if(step.when!==undefined&&evaluate(step.when)===0)break;
          const previous=state.get(step.id)??0,value=evaluate(step.value);state.set(step.id,value);
          if(value!==previous&&step.changed!==undefined)command(step.changed)(dt,t,{value,previous});break;
        }
        case 'call':if(step.when===undefined||evaluate(step.when)!==0){if(step.remember!==undefined)state.set(step.remember,t);command(step.call)(dt,t,empty);}break;
        case 'entities':{
          const previous=history.get(step),actors=ports.entities?.[step.list]?.();
          if(previous===undefined||actors===undefined)throw new Error('Missing audio observation roster');
          if(actors.length>8192)throw new Error('Audio observation roster exceeds its bound');
          const x=read('listener.x'),y=read('listener.y'),z=read('listener.z');
          for(const actor of actors){
            const was=previous.get(actor);previous.set(actor,actor.state);
            if(actor.kind!==step.actorKind||!actor.alive||actor.state!==step.state||was===undefined||step.exclude.includes(was))continue;
            const dx=actor.position.x-x,dy=actor.position.y-y,dz=actor.position.z-z;
            if(t-(state.get(step.remember)??0)<step.gap||dx*dx+dy*dy+dz*dz>step.radius*step.radius)continue;
            state.set(step.remember,t);command(step.call)(dt,t,{entity:actor});
          }break;
        }
        default:throw new Error('Unsupported audio observation');
      }
    }
  }};
}
