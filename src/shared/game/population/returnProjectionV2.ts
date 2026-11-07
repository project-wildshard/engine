import type {GroupGuestBindingsV2} from '@wildshard/engine/ai/GroupBrain';
/** Synchronous stateless numeric projection. This installs no clock, query or
 * body owner; callers retain their existing continuation and decision slots. */
import { parseReturnProjectionV2,returnProjectionV2Layout } from '@wildshard/format/returnProjectionV2';
import { prepareV2Rng } from '@wildshard/format/scriptRngV2';
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import { createV2FrameWriter,validateV2Frame,type V2FrameAuthority } from '@wildshard/format/scriptWireV2';
import type { Rng,RngState } from '@wildshard/engine/core/rng';
import { loanedSha256, sha256 } from '../plugin/moduleHash';
import { GroupStepV2 } from '@wildshard/engine/script/groupStepV2';
import { ScriptModuleV2, prepareScriptMemory, type PreparedScriptMemory } from '@wildshard/engine/script/moduleV2';
import { prepareV2Observations } from '@wildshard/engine/script/observationsV2';
import {readV2WorldActions,type V2WorldAction,type V2ActionBinding} from '@wildshard/format/scriptActionsV2';
import type { Scope } from '@wildshard/engine/app/scope';

export interface PreparedProjectionV2 { readonly values: Readonly<Record<string,number>>; readonly actions:readonly V2WorldAction[]; readonly accept: () => void }
function sameRng(a: RngState,b: RngState): boolean {
  return a.version === b.version && a.state === b.state && a.initial === b.initial && a.scrambledFork === b.scrambledFork;
}
/** Captured observations are native f64 data, including signed zero, rather
 * than authored JSON. Copy own numeric values without invoking accessors. */
function snapshotFrame(input: unknown): Readonly<Record<string,number>> {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid return observation frame');
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid return observation frame');
  const values: Record<string,number> = {};
  const keys=Reflect.ownKeys(input);
  for(let index=0;index<keys.length;index++){
    const key=keys[index];if(key===undefined)throw new Error('Invalid return observation frame');
    const descriptor = Object.getOwnPropertyDescriptor(input,key);
    // a '__proto__' key would set the copy's prototype instead of a value
    if (typeof key !== 'string' || key === '__proto__' || descriptor === undefined || !Object.hasOwn(descriptor,'value')) throw new Error('Invalid return observation frame');
    const value: unknown = descriptor.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid return observation frame');
    values[key] = value;
  }
  return values;
}
/** Freeze the already-admitted owned descriptor; readers borrow it unchanged. */
function freezeGroups(value:unknown):void {
  if(value===null||typeof value!=='object'||Object.isFrozen(value))return;
  for(const child of Object.values(value))freezeGroups(child);
  Object.freeze(value);
}
interface FieldColumn { readonly actor: number; readonly field: string; readonly name: string; readonly id: number; readonly value: undefined }
interface ObservationShape {
  /** each actor's declared field -> its column's byte offset from `fieldsAt` */
  readonly columnsOf: readonly ReadonlyMap<string,number>[];
  readonly input: ReturnType<typeof prepareV2Observations>;
  readonly counts: readonly [ReadonlyMap<number,number>,ReadonlyMap<number,number>];
  readonly signalAt: number;
  readonly fieldsAt: number;
}
/** The same detached byte, hash and layout admission for preparation and use. */
function projectionSource(input: unknown, owner?: Scope, raw?: Uint8Array) {
  if (owner?.disposed === true || owner?.disposing === true) throw new Error('Return owner disposed');
  const row = parseReturnProjectionV2(input), layout = returnProjectionV2Layout(row.fields.length,row.artifact.pages,row.outputCapacity,row.groups);
  if(raw!==undefined&&(row.bytes!==''||owner===undefined))throw new Error('Raw return module requires its original owner');
  if(row.bytes===''&&raw===undefined)throw new Error('Missing admitted raw return module loan');
  const bytes = raw===undefined?Uint8Array.from(atob(row.bytes),byte => byte.codePointAt(0) ?? 0):Uint8Array.from(raw);
  // T10: a raw module is the loan's immutable array (its copy above hashes the same): verified once per byte source
  if ((raw === undefined ? sha256(bytes) : loanedSha256(raw)) !== row.artifact.hash) throw new Error('Return projection hash mismatch');
  const admitted = admitScriptV2(bytes,{ lane: 'project',ioBytes: layout.bytes,compilerRevision: row.artifact.compilerRevision,admissionRevision: row.artifact.admissionRevision });
  if (admitted.initialPages !== row.artifact.pages || admitted.io !== layout.io) throw new Error('Return projection layout mismatch');
  return { row, layout, bytes };
}
export class ReturnProjectionV2 {
  private readonly row;
  private readonly layout;
  private readonly module: ScriptModuleV2;
  private readonly writeFrame: ReturnType<typeof createV2FrameWriter>;
  private emptyRng: ReturnType<typeof prepareV2Rng> | undefined;
  private readonly emptyBindings: ReadonlyMap<number,V2ActionBinding> = new Map();
  private busy = false;
  private readonly worldIndices:number[]=[];
  private readonly rngDue:ReadonlySet<number>=new Set([1]);
  private readonly groups:GroupStepV2|null=null;
  /** Only fixed ABI bytes are retained. Every call still captures its own numeric values. */
  private readonly columns: (ObservationShape | undefined)[] = [];
  /** Reserve no instance or guest state, only this exact consumer's memory. */
  static prepareMemory(input: unknown, owner: Scope, raw?: Uint8Array): PreparedScriptMemory {
    const { bytes } = projectionSource(input, owner, raw);
    return prepareScriptMemory(bytes, owner);
  }
  constructor(input: unknown,private readonly owner?: Scope,raw?:Uint8Array, prepared?: PreparedScriptMemory) {
    const { row, layout, bytes } = projectionSource(input, owner, raw);
    this.row = row; this.layout = layout;
    if (prepared !== undefined && owner === undefined) throw new Error('Prepared return memory requires its original owner');
    this.module = new ScriptModuleV2(bytes,{ seed: [0,0],initFuel: 400000,output: [],ioBytes: this.layout.bytes, ...(owner === undefined ? {} : {owner}), ...(prepared === undefined || owner === undefined ? {} : {prepared: {memory: prepared, scope: owner}}) });
    if (this.module.io !== this.layout.io) throw new Error('Return projection IO mismatch');
    if(this.row.groups!==undefined&&owner!==undefined)this.groups=new GroupStepV2(bytes,this.row.groups,owner,{module:this.module,layout:this.layout});
    this.writeFrame = createV2FrameWriter(this.layout);
    freezeGroups(this.row.groups);this.live();
  }
  /** Original admitted group rows; reading adds no module or continuation. */
  get groupBindings():GroupGuestBindingsV2|undefined { this.live();return this.row.groups; }
  private live(): void { if (this.owner?.disposed === true || this.owner?.disposing === true) throw new Error('Return owner disposed'); }
  private observationShape(count: number): ObservationShape {
    const prior = this.columns[count];
    if (prior !== undefined) return prior;
    const fields = Array.from({ length: count+1 },(_,actor) => this.row.fields.map((field,index): FieldColumn =>
      ({actor,field,name:`${String(actor)}/${field}`,id:actor*this.row.fields.length+index+1,value:undefined})))
      .flat().sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const input = prepareV2Observations(this.layout,0,{bindings:[{identity:'projection',handle:1,self:1,player:0,observed:new Set([1]),enabled:true,due:true,
      divisor:6,fuel:400000,previousTick:0,currentTick:0,state:[],parameters:[{name:'signal',value:0}],fields,sample:{atTick:0,target:0}}],
    players:[],edges:[],events:[],actions:new Set(),eventKinds:new Set()});
    const parameters = this.layout.regions[3], columns = this.layout.regions[5];
    if (parameters === undefined || columns === undefined) throw new Error('Missing projection input banks');
    // Retain sorted column order: each actor's field names its column's place in it.
    const columnsOf = Array.from({ length: count+1 },() => new Map<string,number>());
    for(let index=0;index<fields.length;index++){
      const column=fields[index];if(column===undefined)throw new Error('Missing projection column');
      columnsOf[column.actor]?.set(column.field,index*16);
    }
    // Private admitted shapes only; frame authority and RNG state remain per-call.
    const withoutRng = new Map(input.counts);withoutRng.set(21,0);
    const withRng = new Map(withoutRng);withRng.set(21,1);
    const shape: ObservationShape = {columnsOf,input,counts:[withoutRng,withRng],signalAt:this.layout.io+parameters.offset,fieldsAt:this.layout.io+columns.offset};
    this.columns[count] = shape;return shape;
  }
  /** Capture once. No RNG is changed until the caller has validated its retained
   * state as well as every channel. Traps and rejected candidates consume none. */
  prepare(signal: string,observations: Readonly<Record<string,number>>,random?: Rng,candidates: readonly Readonly<Record<string,number>>[] = [],bindings:ReadonlyMap<number,V2ActionBinding>=this.emptyBindings): PreparedProjectionV2 {
    this.live();
    if (this.busy) throw new Error('Reentrant return projection');
    const signalId = this.row.signals.indexOf(signal)+1;
    if (signalId === 0 || candidates.length > 8) throw new Error('Invalid return request');
    const frames = [observations,...candidates];
    for(let index=0;index<frames.length;index++)frames[index]=snapshotFrame(frames[index]);
    this.live();
    const before = random?.snapshot(), layout = this.layout;
    this.live();
    // An empty bank carries no continuation and never leaves this instance.
    const rng = before === undefined ? (this.emptyRng ??= prepareV2Rng(layout,[])) : prepareV2Rng(layout,[{ binding: 1,stream: 1,algorithm: 1,
      state: [before.state,before.initial,Number(before.scrambledFork),0,0,0] }]);
    const shape = this.observationShape(candidates.length), input = shape.input;
    const counts = rng.count === 0 ? shape.counts[0] : shape.counts[1];
    let authority: V2FrameAuthority | undefined;
    this.busy = true;
    try {
      const answer = this.module.project(400000,view => {
        authority = this.writeFrame(view,{ lane: 2,module: 1,sequence: 0,tick: 0,due: 1 },counts);input.write(view);
        view.setFloat64(shape.signalAt,signalId,true);
        // FC CPU cut: the observation bank just written holds every declared column absent (flag 0, value +0), so only the
        // fields a frame carries are written over it: the same bytes as writing every column, absent ones as (0, 0)
        for(let actor=0;actor<frames.length;actor++){
          const frame=frames[actor],columns=shape.columnsOf[actor];if(frame===undefined||columns===undefined)throw new Error('Missing projection column');
          const keys=Object.keys(frame);
          for(let index=0;index<keys.length;index++){
            const field=keys[index]??'',offset=columns.get(field);if(offset===undefined)continue;
            const value=frame[field];if(value===undefined)continue;
            const at=shape.fieldsAt+offset;view.setUint32(at+4,1,true);view.setFloat64(at+8,value,true);
          }
        }
        const bank = layout.regions[20];if (bank === undefined) throw new Error('Missing projection RNG bank');
        new Uint8Array(view.buffer,layout.io+bank.offset,rng.bytes.length).set(rng.bytes);
      },view => {
        if (authority === undefined) throw new Error('Missing projection authority');
        const actual = validateV2Frame(view,layout,authority),bank = layout.regions[9],values: Record<string,number> = {};
        if (bank === undefined) throw new Error('Missing projection output bank');
        if(actual[2]!==0||(actual[10]??0)!==0)throw new Error('Unexpected numeric projection state or queries');
        if((actual[9]??0)>(this.row.outputCapacity??32))throw new Error('Return projection output quota');
        const world=this.worldIndices;world.length=0;
        for (let index = 0; index < (actual[9] ?? 0); index++) {
          const at = layout.io+bank.offset+index*64,name = this.row.channels[view.getUint32(at+8,true)-1],value = view.getFloat64(at+16,true);
          if(view.getUint32(at+4,true)!==25){world.push(index);continue;}
          if (view.getUint32(at,true) !== 1 || view.getUint32(at+4,true) !== 25 || view.getUint32(at+12,true) !== 0 || name === undefined || Object.hasOwn(values,name)
            || !Number.isFinite(value) || view.getFloat64(at+24,true) !== 0 || view.getFloat64(at+32,true) !== 0
            || view.getFloat64(at+40,true) !== 0 || view.getFloat64(at+48,true) !== 0 || view.getFloat64(at+56,true) !== 0) throw new Error('Invalid return output');
          values[name] = value;
        }
        const actions=readV2WorldActions(view,layout,actual[9]??0,bindings,world);
        const next = rng.readCandidate(view,actual[21] ?? 0,this.rngDue)[0];
        return { values,next,actions };
      }).value;
      this.live();
      let accepted = false;
      return { values: Object.freeze(answer.values),actions:answer.actions,accept: () => {
        this.live();
        if (accepted) throw new Error('Return projection already accepted');
        if (before !== undefined && random !== undefined) {
          const current = random.snapshot();this.live();
          if (!sameRng(before,current) || answer.next === undefined) throw new Error('Changed projection RNG owner');
          random.restore({ ...before,state: answer.next.state[0] });
        }
        accepted = true;
      } };
    } finally { this.worldIndices.length=0;this.busy = false; }
  }
  /** Borrow the SAME selected instance. Group bodies, bank, RNG and operation
   * application remain with the original native owner at its original slot. */
  prepareGroup(input:Parameters<GroupStepV2['prepare']>[0]):ReturnType<GroupStepV2['prepare']>{
    this.live();
    if(this.busy)throw new Error('Reentrant return projection');
    if(this.owner===undefined)throw new Error('Group projection requires an entered scope');
    if(this.groups===null)throw new Error('Missing group projection declaration');
    this.busy=true;
    try{return this.groups.prepare(input);}finally{this.busy=false;}
  }
  project(signal: string,observations: Readonly<Record<string,number>>,random?: Rng,candidates: readonly Readonly<Record<string,number>>[] = []): Readonly<Record<string,number>> {
    const result = this.prepare(signal,observations,random,candidates);result.accept();return result.values;
  }
}
