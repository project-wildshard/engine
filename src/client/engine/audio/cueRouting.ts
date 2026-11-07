import type { AudioVoiceBindings } from '@wildshard/format/audioRouting';
import type { CombatCueOpts } from '../combat/cues';

type Field = keyof CombatCueOpts;
type Scalar = number | boolean | string;
/** Conditions inspect existing cue options without adding random draws or audio taps. */
export type CueCondition = { op: 'present'; field: Field } | { op: 'number'; field: Field } | { op: 'equals'; field: Field; value: Scalar } | { op: 'in'; field: Field; values: readonly Scalar[] };
type Defaults = { readonly [Key in 'pan' | 'gain' | 'strength' | 'speed' | 'heavy' | 'killed' | 'sprinting' | 'surface' | 'kind' | 'phase' | 'clang']?: CombatCueOpts[Key] | undefined };
/** A voice action keeps the caller's point/direction references; defaults apply only to absent options. Null delay means synchronous. */
export interface CueAction {
  voice: string; when: readonly CueCondition[]; defaults: Defaults; delay: number | null;
  /** Fixed recipe parameters take precedence over caller options, preserving the previous bank call. */
  overrides?: Defaults | undefined;
}
/** First matching route owns a cue; an empty action list consumes intentionally silent cues. */
export interface CueRoute {
  id: string;
  /** Generic mixer or combat dispatcher; omitted selects combat for existing declarations. */
  bus?: 'audio' | 'combat' | undefined;
  when: readonly CueCondition[]; actions: readonly CueAction[];
}
/** Voice recipes are trusted platform implementations. A false result preserves the original fallback boundary. Delayed actions use the supplied scope-owned scheduler. */
export interface CueRoutingPorts {
  voices: ReadonlyMap<string, (opts: CombatCueOpts) => boolean | undefined>;
  bindings?:AudioVoiceBindings|undefined; owners?:ReadonlyMap<string,object>|undefined;
  later?: ((run: () => void, seconds: number) => void) | undefined;
}
function matches(conditions: readonly CueCondition[], opts: CombatCueOpts): boolean {
  return conditions.every((condition) => {
    const value = opts[condition.field];
    if (condition.op === 'present') return value !== undefined;
    if (condition.op === 'number') return typeof value === 'number';
    if (condition.op === 'equals') return value === condition.value;
    return condition.values.some((entry) => entry === value);
  });
}
function withDefaults(opts: CombatCueOpts, defaults: Defaults, overrides: Defaults | undefined): CombatCueOpts {
  const merged = { ...opts };
  for (const [key, value] of Object.entries(defaults)) {
    const current: unknown = Reflect.get(merged, key);
    if (current === undefined && value !== undefined) Reflect.set(merged, key, value);
  }
  for (const [key, value] of Object.entries(overrides ?? {})) if (value !== undefined) Reflect.set(merged, key, value);
  return merged;
}

type VoiceBinding=AudioVoiceBindings[number];
type VoiceArgument=VoiceBinding['args'][number];
const memberSafe=(key:string):boolean=>/^[A-Za-z][A-Za-z0-9_]*$/u.test(key)&&!['constructor','prototype','__proto__','caller','callee','arguments'].includes(key);
/** Bind only explicitly lent owners and bounded argument fields, before any cue can play. */
function bindVoice(row:VoiceBinding,owners:ReadonlyMap<string,object>):(opts:CombatCueOpts)=>boolean|undefined {
  if(!memberSafe(row.method)||row.args.length>8||row.when.length>16)throw new Error('Invalid voice binding');
  const owner=owners.get(row.owner);if(owner===undefined)throw new Error('Missing voice owner');
  const method:unknown=Reflect.get(owner,row.method);
  const callable=(value:unknown):value is (...args:unknown[])=>unknown=>typeof value==='function';
  if(!callable(method))throw new Error('Missing voice method');
  const check=(value:VoiceArgument):void=>{
    if(value.kind==='options'){if(Object.keys(value.fields).length>16)throw new Error('Voice options exceed bound');for(const [key,entry]of Object.entries(value.fields)){if(!memberSafe(key))throw new Error('Unsafe voice option');check(entry);}}
    else if(value.kind==='owner'&&(!owners.has(value.owner)||!memberSafe(value.key)))throw new Error('Missing or unsafe voice argument owner');
  };
  for(const value of row.args)check(value);
  const read=(value:VoiceArgument,opts:CombatCueOpts):unknown=>{
    if(value.kind==='literal')return value.value;
    if(value.kind==='field')return opts[value.field]??value.fallback;
    if(value.kind==='options')return Object.fromEntries(Object.entries(value.fields).map(([key,entry])=>[key,read(entry,opts)]));
    const target=owners.get(value.owner);if(target===undefined)throw new Error('Missing voice argument owner');return Reflect.get(target,value.key);
  };
  return opts=>{if(!matches(row.when,opts))return false;const result=method.call(owner,...row.args.map(value=>read(value,opts)));if(result!==undefined&&typeof result!=='boolean')throw new Error('Invalid voice result');return result;};
}

/** Resolve every voice and scheduling dependency up front, then dispatch synchronously in declaration order. Routing never creates a sound tap or random draw. */
export function createCueRouter(routes: readonly CueRoute[], ports: CueRoutingPorts): (id: string, opts: CombatCueOpts) => boolean {
  const voices=new Map(ports.voices);
  if((ports.bindings?.length??0)>128)throw new Error('Voice bindings exceed bound');
  for(const row of ports.bindings??[]){if(voices.has(row.id))throw new Error('Duplicate voice binding');voices.set(row.id,bindVoice(row,ports.owners??new Map()));}
  const compiled = routes.map((route) => ({ id: route.id, when: route.when, actions: route.actions.map((action) => {
    const voice = voices.get(action.voice);
    if (voice === undefined) throw new Error(`Unknown catalogue voice: ${action.voice}`);
    if (action.delay !== null && ports.later === undefined) throw new Error('Delayed cue requires a scope-owned scheduler');
    return { ...action, voice };
  }) }));
  return (id, opts) => {
    const route = compiled.find((candidate) => candidate.id === id && matches(candidate.when, opts));
    if (route === undefined) return false;
    for (const action of route.actions) {
      if (!matches(action.when, opts)) continue;
      const input = withDefaults(opts, action.defaults, action.overrides);
      if (action.delay === null) { if (action.voice(input) === false) return false; }
      else ports.later?.(() => { action.voice(input); }, action.delay);
    }
    return true;
  };
}
