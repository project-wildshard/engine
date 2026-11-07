import type {GroupGuestBindingsV2} from '@wildshard/engine/ai/GroupBrain';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { DecisionModule } from '@wildshard/engine/script/decisionModule';
import { scriptV1Layout, SCRIPT_V1_EVENTS, SCRIPT_V1_COMMANDS } from '@wildshard/format/scriptAbiV1';
import { decisionScriptContract, parseDecisionScripts, SCRIPT_V1_REFERENCE_KINDS, type DecisionScriptRow } from '@wildshard/format/decisionScripts';
import type {V2ActionBinding} from '@wildshard/format/scriptActionsV2';
import type { Rng } from '@wildshard/engine/core/rng';
import { emitFault } from '@wildshard/engine/core/faults';
import type { GroupStepV2 } from '@wildshard/engine/script/groupStepV2';
import type { PreparedScriptMemory } from '@wildshard/engine/script/moduleV2';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SimHost } from '@wildshard/engine/sim';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import * as v from 'valibot';
import { ReturnModulesSchema, type ReturnModuleRow, admitScriptContract } from '@wildshard/format/scriptContract';
import { loanedSha256, sha256 } from '../plugin/moduleHash';
import { isJsonData } from '@wildshard/format/json';
import { checkReturnProjectionV2Rows } from '@wildshard/format/returnProjectionV2';
import { ReturnProjectionV2,type PreparedProjectionV2 } from './returnProjectionV2';
import type {ShardProduct} from '../shardfile/shardProduct';
import {outputDescriptor} from '../shardfile/outputDescriptor';

type RawReturnRow = ReturnModuleRow;
interface ReturnOwnerBook {
  readonly instances: Map<string,{declaration:string;program:ReturnProgram}>;
  readonly memories: Map<string,{declaration:string;memory:PreparedScriptMemory}>;
  loan?: {readonly assets:ReadonlyMap<string,Uint8Array>;readonly rows:ReadonlyMap<string,RawReturnRow>};
}
// One book, including loans and instances, retired by its original scope.
const scoped = new Map<Scope,ReturnOwnerBook>();
function ownerBook(owner:Scope):ReturnOwnerBook {
  if(owner.disposed||owner.disposing)throw new Error('Return owner disposed');
  const previous=scoped.get(owner);if(previous!==undefined)return previous;
  const book:ReturnOwnerBook={instances:new Map(),memories:new Map()};scoped.set(owner,book);
  owner.onDispose(()=>{book.instances.clear();book.memories.clear();delete book.loan;scoped.delete(owner);});
  return book;
}
function rawModule(owner:Scope|undefined,row:ReturnType<typeof readProgram>,witness=false):Uint8Array|undefined {
  if((witness?row.bytes:row.v2?.bytes)!=='')return undefined;
  if(owner===undefined||owner.disposed||owner.disposing)throw new Error('Raw return module requires a living owner');
  let lender:Scope|undefined,book:ReturnOwnerBook|undefined;
  for(const [scope,candidate]of scoped)if(candidate.loan!==undefined&&owner.belongsTo(scope)
    &&!scope.disposed&&!scope.disposing&&(lender===undefined||scope.belongsTo(lender))){lender=scope;book=candidate;}
  const loan=book?.loan,artifact=row.v2?.artifact;
  const hash=witness?row.script.module.slice('blobs/wasm/'.length,-'.wasm'.length):artifact?.hash;
  const contract=hash===undefined?undefined:loan?.rows.get(artifact?.hash??hash);
  if(loan===undefined||hash===undefined||contract===undefined)throw new Error('Missing admitted raw return module loan');
  if(artifact===undefined){
    if(contract.abi===2||contract.pages!==row.script.pages)throw new Error('Raw return module contract mismatch');
  }else if(contract.abi!==2||contract.pages!==artifact.pages||contract.ioBytes!==artifact.ioBytes)throw new Error('Raw return module contract mismatch');
  const bytes:unknown=Map.prototype.get.call(loan.assets,hash);
  // T10: the loan's immutable bytes are verified once per byte source (loanedSha256), not again in every admission path
  if(!(bytes instanceof Uint8Array)||loanedSha256(bytes)!==hash)throw new Error('Raw return module hash mismatch');
  return bytes;
}

/** admitted programs by their frozen declaration (T10: every herd and pack of a Nalati entry admitted the same declaration
 *  again, ~10 ms a group at phone 4x, before its owner's instance memo returned the shared program). A frozen input cannot
 *  change, so its admission is reused; anything else is admitted on every call. */
const admittedPrograms = new WeakMap<object, ReturnType<typeof admitProgram>>();
/** Detach the closed descriptor before consulting a scope's admitted modules.
 * A declared v2 projection never falls back to legacy bytes on refusal. */
function readProgram(input: unknown): ReturnType<typeof admitProgram> {
  if (typeof input !== 'object' || input === null || !Object.isFrozen(input)) return admitProgram(input);
  const known = admittedPrograms.get(input); if (known !== undefined) return known;
  const row = admitProgram(input); admittedPrograms.set(input, row); return row;
}
function admitProgram(input: unknown): Omit<v.InferOutput<typeof ReturnProgramSchema>,'script'> & { script: DecisionScriptRow } {
  if (!isJsonData(input)) throw new Error('Return program requires JSON data');
  const row = v.parse(ReturnProgramSchema,input),script = parseDecisionScripts([row.script])[0];
  if (script === undefined) throw new Error('Missing return script');
  if (row.v2 !== undefined) {
    const v2 = row.v2;
    checkReturnProjectionV2Rows(v2);
    if (Object.keys(script.params).length > 0 || script.reads.some(read => read !== 'field' && read !== 'random' && read !== 'radial')
      || (['fields','signals','channels'] as const).some(kind => JSON.stringify([...Object.values(script[kind]).sort(),...(v2.additional?.[kind]??[])]) !== JSON.stringify(v2[kind]))) throw new Error('Mismatched return projection declaration');
  }
  return {...row,script};
}

function admitReturn(row: ReturnType<typeof readProgram>, owner?: Scope, witness?: Uint8Array): Uint8Array {
  if (row.script.state.length > 0 || row.script.tick !== null
    || row.script.timers.length > 0 || row.script.on.length !== 1 || row.script.on[0] !== 'signal'
    || row.script.commands.some(command => command !== 'channel')
    || row.script.reads.some(read => !['field', 'random', 'groundHeight', 'radial'].includes(read))) throw new Error('Invalid return projection');
  if(row.bytes===''&&witness===undefined)throw new Error('Missing admitted raw return module loan');
  const bytes = witness ?? Uint8Array.from(atob(row.bytes), byte => byte.codePointAt(0) ?? 0);
  if (`blobs/wasm/${witness === undefined ? sha256(bytes) : loanedSha256(bytes)}.wasm` !== row.script.module) throw new Error('Return module hash mismatch');
  if (owner?.disposed === true || owner?.disposing === true) throw new Error('Return owner disposed');
  admitScriptContract(bytes, { abi: 1, pages: row.script.pages });
  return bytes;
}
function returnIdentity(row: ReturnType<typeof readProgram>) {
  const script = row.script;
  // Alias identity follows sorted names; property order is immaterial.
  const named = Object.fromEntries([...SCRIPT_V1_REFERENCE_KINDS, 'params' as const].map(key =>
    [key, Object.fromEntries(Object.entries(script[key] ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))]));
  return {key: row.v2 === undefined ? `1:${script.module}` : `2:${row.v2.artifact.hash}`,
    declaration: JSON.stringify({script: decisionScriptContract({...script, ...named}), bytes: row.bytes, ...(row.v2 === undefined ? {} : {v2: row.v2})})};
}

/** Event-only, stateless projections; only explicit v2 rows select ws_project.
 * The caller retains its queue, phase and
 * continuation; the guest can read numeric observations and publish channels.
 * There is no scheduler, actor mutation, timer or private persistent state. */
/** module bytes already hashed and admitted for their declaration row, keyed by the byte array itself (G639: Nalati's
 *  entry lent the same modules to its entry scope and then its level, hashing and admitting each twice in one 183 ms
 *  frame); a replaced array is verified again, and every program hashes and admits its bytes again when it is built */
const lentBytes = new WeakMap<Uint8Array, string>();
/** Hash and contract-admit one raw module's bytes for its declaration, once per bytes and declaration. */
function admitRawModule(bytes:Uint8Array,hash:string,row:ReturnModuleRow):void {
  const declared=JSON.stringify(row);
  if(lentBytes.get(bytes)===declared)return;
  if(sha256(bytes)!==hash)throw new Error('Raw return module hash mismatch');
  admitScriptContract(bytes,row.abi===2?{abi:2,lane:row.lane,pages:row.pages,ioBytes:row.ioBytes,compilerRevision:row.compilerRevision,admissionRevision:row.admissionRevision}:{abi:1,pages:row.pages});lentBytes.set(bytes,declared);
}
/** A plain record's own field names, or null when a field could change unseen by them (an inherited field, an accessor). */
function plainFields(record: Readonly<Record<string, number>>): string[] | null {
  const proto: unknown = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.getOwnPropertyNames(record);
  for (const key of keys) { const field = Object.getOwnPropertyDescriptor(record, key); if (field === undefined || !Object.hasOwn(field, 'value')) return null; }
  return keys;
}
export class ReturnProgram {
  /** The same frozen admitted rows, for a native binding over this owner. */
  readonly declaration:ReturnType<typeof readProgram>;
  private readonly module: DecisionModule | null = null;
  private readonly script: DecisionScriptRow;
  private readonly signalNames:readonly string[];
  private readonly parameterNames:readonly string[];
  private readonly channelNames:readonly string[];
  private readonly layout: ReturnType<typeof scriptV1Layout>;
  private observations: Readonly<Record<string, number>> = {};
  private candidates: readonly Readonly<Record<string, number>>[] = [];
  private random: Rng | undefined;
  private active = false;
  /** Each signal's last successful request and its channels, when the guest reads only its fields (and radial
   *  arithmetic): a rewound pure guest answers the same inputs with the same channels, so a repeat runs no guest
   *  (Pine's shelter clock repeated 244,249 of 244,250 steps). Never with a random stream, candidates or terrain. */
  private readonly pure: boolean = false;
  private readonly last = new Map<number, { readonly keys: readonly string[]; readonly values: readonly number[]; readonly channels: readonly (readonly [string, number])[] }>();
  readonly prepareWorld?: (signal:string,observations:Readonly<Record<string,number>>,bindings:ReadonlyMap<number,V2ActionBinding>,candidates?:readonly Readonly<Record<string,number>>[],random?:Rng)=>PreparedProjectionV2;
  readonly prepare?: NonNullable<NumericProjection['prepare']>;
  /** The same immutable admitted descriptor used by this selected instance. */
  readonly groupBindings?:GroupGuestBindingsV2;
  readonly prepareGroup?:NonNullable<NumericProjection['prepareGroup']>;
  private constructor(row: ReturnType<typeof readProgram>, floor: (x: number, z: number) => number,private readonly owner?: Scope,raw?:Uint8Array,witness?:Uint8Array,prepared?:PreparedScriptMemory) {
    const script = row.script;
    const freeze=(value:unknown):void=>{if(typeof value!=='object'||value===null||Object.isFrozen(value))return;for(const child of Object.values(value))freeze(child);Object.freeze(value);};
    freeze(row);this.declaration=row;
    const bytes = admitReturn(row, owner, witness);
    this.script = script;this.signalNames=row.v2?.signals??Object.values(script.signals).sort(); this.layout = scriptV1Layout(0, Object.keys(script.params).length);
    this.parameterNames=Object.keys(script.params).sort();this.channelNames=Object.values(script.channels).sort();
    this.pure = script.reads.every(name => name === 'field' || name === 'radial');
    const fields = Object.values(script.fields).sort();
    if (row.v2 !== undefined) {
      const projection = new ReturnProjectionV2(row.v2,owner,raw,prepared);
      this.prepare = projection.prepare.bind(projection);
      if(projection.groupBindings!==undefined)this.groupBindings=projection.groupBindings;
      if(row.v2.groups!==undefined&&owner!==undefined)this.prepareGroup=projection.prepareGroup.bind(projection);
      this.prepareWorld=(signal,observations,bindings,candidates,random)=>projection.prepare(signal,observations,random,candidates??[],bindings);
      return;
    }
    const module: DecisionModule = new DecisionModule(bytes, [0, 0], {
      read: (op, a, b) => {
        if (!this.active) throw new Error('Return read outside a request');
        if (op === 12 && script.reads.includes('random') && a === 0 && b === 0 && this.random !== undefined) return this.random.next();
        const observed = a === 0 ? this.observations : Number.isSafeInteger(a) && a > 0 ? this.candidates[a - 1] : undefined;
        const name = fields[b - 1], value = name === undefined ? undefined : observed?.[name];
        if (op !== 7 || !script.reads.includes('field') || !Number.isInteger(b) || value === undefined || !Number.isFinite(value)) throw new Error('Undeclared return observation');
        return value;
      },
      list: (op, a, b, out, cap) => {
        if (!this.active || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isSafeInteger(out) || out < 0 || out % 8 !== 0
          || !Number.isSafeInteger(cap) || cap < 0 || cap > 96 || out + cap * 8 > module.memory.buffer.byteLength) throw new Error('Invalid return query');
        const values = op === 3 && script.reads.includes('groundHeight') && Math.abs(a) <= 250 && Math.abs(b) <= 250 ? [floor(a, b)]
          : op === 6 && script.reads.includes('radial') && b >= 0 && b <= 10000 ? [Math.sin(a) * b, Math.cos(a) * b] : null;
        if (values === null || values.some(value => !Number.isFinite(value))) throw new Error('Unsupported return query');
        const count = Math.min(cap, values.length);
        for (let i = 0; i < count; i++) module.view.setFloat64(out + i * 8, values[i] ?? 0, true);
        return count;
      },
    }, true); // stateless: rewound around every request, so it shares the page's memory for its page count
    this.module = module;
    if (module.io + this.layout.bytes > module.memory.buffer.byteLength) throw new Error('Return IO outside module');
  }
  private static owned(owner: Scope, input: unknown, floor: (x: number, z: number) => number): ReturnProgram {
    if (owner.disposed || owner.disposing) throw new Error('Return owner disposed');
    const row = readProgram(input);
    const {key, declaration} = returnIdentity(row), book = ownerBook(owner), modules = book.instances;
    const raw=rawModule(owner,row),witness=rawModule(owner,row,true);
    const previous = modules.get(key);
    if (previous !== undefined) {
      if (previous.declaration !== declaration) throw new Error('Shared return declaration changed');
      return previous.program;
    }
    const prepared = book.memories.get(key);
    if (prepared !== undefined && prepared.declaration !== declaration) throw new Error('Shared return declaration changed');
    book.memories.delete(key);
    // Admission already detached and checked this descriptor. Each new owner still
    // receives its own frozen snapshot; admitting that snapshot a second time
    // repeated the JSON/schema walks for every first pack and herd.
    const program = owner.run(() => new ReturnProgram(structuredClone(row), floor,owner,raw,witness,prepared?.memory));
    modules.set(key, { declaration, program });
    return program;
  }
  /** Prepare only a declared consumer, in its actual scope. The original
   * cache consumes this fresh memory once when that consumer constructs. */
  static prepareMemory(input: unknown, owner: Scope): boolean {
    const row = readProgram(input), book = ownerBook(owner), {key, declaration} = returnIdentity(row);
    if (row.v2 === undefined) return false;
    const raw = rawModule(owner, row), witness = rawModule(owner, row, true);
    admitReturn(row, owner, witness);
    const previous = book.instances.get(key) ?? book.memories.get(key);
    if (previous !== undefined) {
      if (previous.declaration !== declaration) throw new Error('Shared return declaration changed');
      return false;
    }
    const memory = ReturnProjectionV2.prepareMemory(row.v2, owner, raw);
    book.memories.set(key, {declaration, memory});
    return true;
  }
  /** Read selected modules and their direct declared dependencies into the
   * original asset map. Witness sidecars are data, never executable admissions. */
  static async prepareModules(product:ShardProduct,assets:ReadonlyMap<string,Uint8Array>,rows:readonly ReturnModuleRow[]):Promise<void> {
    if(!(assets instanceof Map))throw new Error('Return modules require the original asset map');
    const files=outputDescriptor(product.shardfile)?.index.files;
    for(const row of rows){
      const hash=row.module.slice('blobs/wasm/'.length,-'.wasm'.length);
      const root=files?.find(file=>file.kind==='wasm'&&file.hash===hash);
      if(root?.name===undefined){if(row.abi===2)throw new Error('Return module needs its admitted logical file');continue;}
      for(const key of [hash,...root.dependencies]){
        if(Map.prototype.has.call(assets,key))continue;
        const file=files?.find(candidate=>candidate.hash===key);
        if(file?.name===undefined)throw new Error('Return dependency needs its admitted logical file');
        Map.prototype.set.call(assets,key,await product.file(file.name));
      }
    }
  }
  /** Admit each declared module's bytes (hash and script contract) a `pause` apart, so a later `lendModules` finds them
   *  admitted: in one task they were ~106 ms of a cold Nine Dragon crossing's world step at phone 4x. */
  static async admitModules(assets:ReadonlyMap<string,Uint8Array>,input:readonly ReturnModuleRow[],pause:()=>Promise<void>):Promise<void> {
    for(const row of v.parse(ReturnModulesSchema,input)){
      const hash=row.module.slice('blobs/wasm/'.length,-'.wasm'.length),bytes:unknown=Map.prototype.get.call(assets,hash);
      if(!(bytes instanceof Uint8Array))continue;
      admitRawModule(bytes,hash,row);await pause();
    }
  }
  /** Lend the original admitted asset map to its actual runtime scope. Child
   * scopes borrow it; unrelated scopes cannot. No byte or state copy is kept. */
  static lendModules(owner:Scope,assets:ReadonlyMap<string,Uint8Array>,input:readonly ReturnModuleRow[]):void {
    if(!(assets instanceof Map))throw new Error('Return modules require the original asset map');
    const rows=v.parse(ReturnModulesSchema,input),selected=new Map<string,RawReturnRow>();
    for(const row of rows){
      const hash=row.module.slice('blobs/wasm/'.length,-'.wasm'.length),previous=selected.get(hash);
      if(row.abi!==2&&!Map.prototype.has.call(assets,hash))continue;
      if(previous!==undefined&&JSON.stringify(previous)!==JSON.stringify(row))throw new Error('Conflicting raw return module declarations');
      const bytes:unknown=Map.prototype.get.call(assets,hash);
      if(!(bytes instanceof Uint8Array))throw new Error('Raw return module hash mismatch');
      admitRawModule(bytes,hash,row);
      selected.set(hash,row);
    }
    const book=ownerBook(owner),previous=book.loan;
    if(previous!==undefined&&(previous.assets!==assets||JSON.stringify([...previous.rows])!==JSON.stringify([...selected])))throw new Error('Raw return module loan changed');
    book.loan={assets,rows:selected};
  }
  /** Detached declared names for resource preflight before allocating a module. */
  static projectionBindings(input:unknown):{readonly script:Pick<DecisionScriptRow,'fields'|'signals'|'channels'>} { const row=readProgram(input);return {script:row.v2===undefined?row.script:{fields:Object.fromEntries(row.v2.fields.map(name=>[name,name])),signals:Object.fromEntries(row.v2.signals.map(name=>[name,name])),channels:Object.fromEntries(row.v2.channels.map(name=>[name,name]))}}; }
  /** Built-in terrain owners share one admitted instance per module and scope. */
  static native(host: SimHost, input: unknown): ReturnProgram { return ReturnProgram.owned(host.scope, input, (x, z) => host.groundHeightAt(x, z)); }
  static page(input: unknown, owner?: Scope): ReturnProgram { return owner === undefined ? new ReturnProgram(readProgram(input), terrainHeight) : ReturnProgram.owned(owner, input, terrainHeight); }

  private validateOwner():void {
    if(this.owner?.disposed===true||this.owner?.disposing===true)throw new Error('Return owner disposed');
  }

  /** Resolve only the admitted signal table for a same-call native barrier. */
  signalName(id:number):string{const name=Number.isInteger(id)?this.signalNames[id-1]:undefined;if(name===undefined)throw new Error('Unknown return signal');return name;}

  /** A request is atomic with its borrowed stream. Refusals publish no channel
   * and restore the stream, including traps after one or more terrain retries. */
  project(signal: string, observations: Readonly<Record<string, number>>, random?: Rng, candidates: readonly Readonly<Record<string, number>>[] = []): Readonly<Record<string, number>> {
    this.validateOwner();
    if (this.prepare !== undefined) { const result = this.prepare(signal,observations,random,candidates);result.accept();return result.values; }
    if (this.active) throw new Error('Reentrant return request');
    const signalId = this.signalNames.indexOf(signal) + 1;
    if (signalId === 0 || Object.values(observations).some(value => !Number.isFinite(value))
      || candidates.length > 8 || candidates.some(candidate => Object.values(candidate).some(value => !Number.isFinite(value)))) throw new Error('Invalid return request');
    const { module, layout } = this;
    if (module === null) throw new Error('Missing return transport');
    const keys = this.pure && random === undefined && candidates.length === 0 ? plainFields(observations) : null;
    if (keys !== null) {
      const last = this.last.get(signalId);
      if (last !== undefined && last.keys.length === keys.length && keys.every((key, i) => key === last.keys[i] && Object.is(observations[key], last.values[i]))) {
        const result: Record<string, number> = {};
        for (const [name, value] of last.channels) result[name] = value;
        this.validateOwner();
        return result;
      }
    }
    const before = random?.snapshot(),base = module.io;
    module.rewind(); module.begin(400000); this.observations = observations; this.candidates = candidates; this.random = random; this.active = true;
    try {
      const set = (slot: number, value: number): void => { module.view.setFloat64(base + slot * 8, value, true); };
      set(0, 0); set(1, 0); set(2, 1); set(3, 0); set(4, 1);
      for(let i=0;i<this.parameterNames.length;i++){const name=this.parameterNames[i];if(name===undefined)throw new Error('Missing return parameter');set(layout.params+i,this.script.params[name]??0);}
      set(layout.inbox,SCRIPT_V1_EVENTS.signal);set(layout.inbox+1,signalId);
      set(layout.inbox+2,0);set(layout.inbox+3,0);set(layout.inbox+4,0);set(layout.inbox+5,0);
      const count = module.invoke('ws_handle'), result: Record<string, number> = {}, channels = this.channelNames;
      if (!Number.isSafeInteger(count) || count < 0 || count > 32) throw new Error('Return output bound');
      for (let i = 0; i < count; i++) {
        const at=base+(layout.outbox+i*5)*8;
        const op=module.view.getFloat64(at,true),target=module.view.getFloat64(at+8,true),id=module.view.getFloat64(at+16,true),
          value=module.view.getFloat64(at+24,true),reserved=module.view.getFloat64(at+32,true),name=channels[id-1];
        if (op !== SCRIPT_V1_COMMANDS.channel || target !== 0 || reserved !== 0 || !Number.isInteger(id) || name === undefined
          || value === undefined || !Number.isFinite(value) || Object.hasOwn(result, name)) throw new Error('Invalid return output');
        result[name] = value;
      }
      this.validateOwner();
      if (keys !== null) this.last.set(signalId, { keys, values: keys.map(key => observations[key] ?? Number.NaN), channels: Object.entries(result) });
      return result;
    } catch (error) { if (before !== undefined) random?.restore(before); throw error; }
    finally { this.active = false; this.observations = {}; this.candidates = []; this.random = undefined; module.rewind(); }
  }
}

/** Ten-Hz motion observation with a reused frame. The guest owns velocity caps
 * and smoothing; renderer frames borrow the last projected scalar. */
export class ProjectedMotionSample {
  private initialized = false;
  private readonly frame = { dt: 0, x: 0, z: 0, px: 0, pz: 0, speed: 0 };
  constructor(private readonly program: ReturnProgram, private readonly signal: string) {}
  update(dt: number, x: number, z: number): number {
    const frame = this.frame;
    if (!this.initialized) { frame.px = x; frame.pz = z; this.initialized = true; }
    frame.dt += dt; frame.x = x; frame.z = z;
    if (frame.dt + 1e-9 >= .1) {
      frame.speed = this.program.project(this.signal, frame)['speed'] ?? frame.speed;
      frame.px = x; frame.pz = z; frame.dt = 0;
    }
    return frame.speed;
  }
}


/** Numeric projections retain the existing caller's decision slots. A v2
 * transport prepares its RNG candidate until retained columns also validate. */
export interface NumericProjection {
  readonly prepareGroup?:(input:Parameters<GroupStepV2['prepare']>[0])=>ReturnType<GroupStepV2['prepare']>;
  readonly project:(signal:string,observations:Readonly<Record<string,number>>,random?:Rng,candidates?:readonly Readonly<Record<string,number>>[])=>Readonly<Record<string,number>>;
  readonly prepareWorld?: (signal:string,observations:Readonly<Record<string,number>>,bindings:ReadonlyMap<number,V2ActionBinding>,candidates?:readonly Readonly<Record<string,number>>[],random?:Rng)=>PreparedProjectionV2;
  readonly prepare?:(signal:string,observations:Readonly<Record<string,number>>,random?:Rng,candidates?:readonly Readonly<Record<string,number>>[])=>{
    readonly values:Readonly<Record<string,number>>;readonly accept:()=>void;
  };
}

/** Native continuation for admitted numeric projections. The guest owns rules;
 * rows name retained channels and event aliases. Both live arena clocks and
 * practice courses use the same state owner and optional ten-Hz sampling. */
interface ProjectedStateRows<S extends Record<string,number>> {
  readonly initial:S; readonly parameters?:Readonly<Record<string,number>>;
  readonly retain?:Readonly<Record<string,string>>; readonly outputs?:readonly string[];
  readonly signals?:Readonly<Record<string,string>>; readonly signal?:string;
  /** Required numeric outputs retained only at their original event slot. */
  readonly retainEvents?:Readonly<Record<string,Readonly<Record<string,string>>>>;
  /** Complete required bank for one event, checked before RNG or state accepts. */
  readonly outputsEvents?:Readonly<Record<string,readonly string[]>>;
}
/** A projected state's continuation as data: every retained slot and the step clock (CI12 native checkpoints). */
export interface ProjectedSnapshot { readonly state: Readonly<Record<string,number>>; readonly elapsed: number }
export class ProjectedState<S extends Record<string,number> = Record<string,number>> {
  readonly state:S;
  private elapsed=0;
  private reportedStep=false;
  private readonly retain:Readonly<Record<string,string>>;
  /** Call with the declared program before module allocation when admitting a
   * resource owner. Construction repeats the structural checks for direct use. */
  static preflight(row:ProjectedStateRows<Record<string,number>>,program?:{readonly script:Pick<DecisionScriptRow,'signals'|'channels'>}):void {
    const retain=row.retain??Object.fromEntries(Object.keys(row.initial).map(key=>[key,key]));
    const channels=program===undefined?null:new Set(Object.values(program.script.channels));
    const signals=program===undefined?null:new Set(Object.values(program.script.signals));
    if(signals!==null&&[...Object.values(row.signals??{}),...(row.signal===undefined?[]:[row.signals===undefined?row.signal:row.signals[row.signal]])].some(signal=>signal===undefined||!signals.has(signal)))throw new Error('Missing projection event');
    if(channels!==null&&row.outputs?.some(channel=>!channels.has(channel))===true)throw new Error('Missing projection channel');
    for(const [event,outputs]of Object.entries(row.outputsEvents??{})){
      const signal=row.signals===undefined?event:row.signals[event];
      if(signal===undefined||signals!==null&&!signals.has(signal))throw new Error('Missing projection event');
      if(channels!==null&&outputs.some(channel=>!channels.has(channel)))throw new Error('Missing projection channel');
    }
    for(const [event,map]of Object.entries(row.retainEvents??{})){
      const signal=row.signals===undefined?event:row.signals[event];
      if(signal===undefined||signals!==null&&!signals.has(signal))throw new Error('Missing projection event');
      const merged={...retain,...map},targets=Object.values(merged);
      if(Object.entries(map).some(([channel,slot])=>Object.hasOwn(retain,channel)&&retain[channel]!==slot)
        ||new Set(targets).size!==targets.length)throw new Error('Conflicting projection retention');
    }
    for(const map of [retain,...Object.values(row.retainEvents??{})])for(const [channel,slot]of Object.entries(map)){
      if(!Object.hasOwn(row.initial,slot))throw new Error('Missing projection state slot');
      if(channels!==null&&!channels.has(channel))throw new Error('Missing projection channel');
    }
    if(Object.values(row.initial).some(value=>!Number.isFinite(value)))throw new Error('Invalid projection state');
  }
  constructor(private readonly row:ProjectedStateRows<S>,private readonly program:NumericProjection) {
    ProjectedState.preflight(row);this.state={...row.initial};this.retain=row.retain??Object.fromEntries(Object.keys(row.initial).map(key=>[key,key]));
  }
  value(key:string):number {const value=this.state[key];if(value===undefined)throw new Error('Unknown projection state slot');return value;}
  /** CI12: the whole continuation as data (its state and its step clock), for a native checkpoint */
  snapshot():ProjectedSnapshot {return {state:{...this.state},elapsed:this.elapsed};}
  /** Continue from `saved` (a snapshot of a state of this row): the same state and step clock. */
  restore(saved:ProjectedSnapshot):void {
    if(!Number.isFinite(saved.elapsed)||saved.elapsed<0||Object.keys(saved.state).length!==Object.keys(this.row.initial).length)throw new Error('Invalid projection snapshot');
    this.set(saved.state);this.elapsed=saved.elapsed;
  }
  set(values:Readonly<Record<string,number>>):void {
    if(Object.entries(values).some(([key,value])=>!Object.hasOwn(this.row.initial,key)||!Number.isFinite(value)))throw new Error('Invalid projection state');
    Object.assign(this.state,values);
  }
  reset(values:Readonly<Record<string,number>>={}):void {this.elapsed=0;Object.assign(this.state,this.row.initial);this.set(values);}
  /** Reset retained slots, then let the guest interpret reset observations. */
  restart(frame:Readonly<Record<string,number>>={}):Readonly<Record<string,number>> {this.reset();return this.event('reset',frame);}
  event(event:string,frame:Readonly<Record<string,number>>={},random?:Rng,candidates:readonly Readonly<Record<string,number>>[]=[]):Readonly<Record<string,number>> {
    const signal=this.row.signals===undefined?event:this.row.signals[event];if(signal===undefined)throw new Error('Missing projection event');
    const input={...this.row.parameters,...this.state,...frame},prepared=this.program.prepare?.(signal,input,random,candidates);
    const out=prepared?.values??this.program.project(signal,input,random,candidates),next:Record<string,number>={...this.state},eventRetain=this.row.retainEvents?.[event];
    if(this.row.outputs?.some(key=>!Number.isFinite(out[key]))===true
      ||this.row.outputsEvents?.[event]?.some(key=>!Number.isFinite(out[key]))===true
      ||Object.keys(eventRetain??{}).some(key=>!Number.isFinite(out[key])))throw new Error('Missing required projection output');
    for(const [channel,slot]of Object.entries({...this.retain,...eventRetain})){const value=out[channel];if(value!==undefined)next[slot]=value;}
    if(Object.entries(next).some(([key,value])=>!Object.hasOwn(this.row.initial,key)||!Number.isFinite(value)))throw new Error('Invalid projection state');
    prepared?.accept();this.set(next);return out;
  }
  project(frame:Readonly<Record<string,number>>,random?:Rng,candidates:readonly Readonly<Record<string,number>>[]=[]):Readonly<Record<string,number>> {
    if(this.row.signal===undefined)throw new Error('Missing projection signal');return this.event(this.row.signal,frame,random,candidates);
  }
  private skipStep(error:unknown):{dt:number;values:Readonly<Record<string,number>>} {
    if(!this.reportedStep){this.reportedStep=true;emitFault({system:'projection.step',error,verdict:'retry'});}
    return {dt:0,values:{}};
  }
  /** At most one decision each 100 ms; rejected samples retain their clock,
   * state and random continuation, skip this entity and retry on a later frame. */
  step(dt:number,frame:Readonly<Record<string,number>>,random?:Rng):{dt:number;values:Readonly<Record<string,number>>} {
    if(!Number.isFinite(dt)||dt<0||!Number.isFinite(this.elapsed+dt))return this.skipStep(new RangeError('Invalid projection frame delta'));
    this.elapsed+=dt;if(this.elapsed+1e-9<.1)return {dt:0,values:{}};
    const step=this.elapsed,before=random?.snapshot();
    try {const values=this.event('step',{...frame,dt:step},random);this.elapsed=0;return {dt:step,values};}
    catch(error){if(before!==undefined)random?.restore(before);return this.skipStep(error);}
  }
}
