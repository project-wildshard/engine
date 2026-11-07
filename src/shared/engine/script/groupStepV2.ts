/** One reusable AS group executable over the original group's borrowed bank.
 * Calls happen at the original native slot. There is no tick loop, body/RNG/save
 * owner, action dispatcher or per-group module instance in this transport. */
import { parseGroupStepV2, groupStepLayoutV2, groupNativeWordsV2, groupNativeTargetV2, type GroupStepNativeV2 } from '@wildshard/format/scriptGroupStepV2';
import { Vector3 } from 'three';
import type { GroupBankReferenceV2, GroupBankValueV2 } from '@wildshard/format/scriptGroupBankV2';
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import { prepareV2Rng } from '@wildshard/format/scriptRngV2';
import { createV2FrameWriter, validateV2Frame, layoutV2, relativeTickV2, type V2FrameAuthority, type V2Layout } from '@wildshard/format/scriptWireV2';
import type { V2QueryBinding } from '@wildshard/format/scriptQueriesV2';
import { GroupBankV2 } from './groupBankV2';
import { ObservationColumnsV2, type V2ColumnOwners, type V2ActorColumnSlot, type V2ReferenceColumn, type V2ColumnSource } from './observationColumnsV2';
import { ScriptModuleV2 } from './moduleV2';
import type { QueryRingV2 } from '../../../server/engine/script/queriesV2';
import type { Scope } from '../app/scope';
import { ANIMAL_STATES } from '../entities/animalStates';
import type { AnimalSim } from '../entities/AnimalSim';
import type { Rng, RngState } from '../core/rng';
import type { AggressionDirector, AggressionService } from '../ai/director';
import type { Events } from '../events/events';
import type { CirclingPackPrey, CirclingPackContext, StalkerBrain } from '../ai/stalker';
import type { GuardedHerdContext, GrazerBrain } from '../../../server/engine/ai/grazer';
import { GUARDED_STALLION_STATES } from '@wildshard/format/groupBrains';

export type GroupStepReferenceV2<A extends AnimalSim = AnimalSim> = GroupBankReferenceV2 & (
  | { readonly body: A; readonly pose?: never }
  | { readonly body: CirclingPackPrey; readonly pose: true }
);
function validReference(row: GroupStepReferenceV2): boolean {
  return row.pose === true ? typeof row.body.alive === 'boolean' : row.body.entityId === row.identity;
}
function sameReference(current: GroupStepReferenceV2 | undefined, before: GroupStepReferenceV2): boolean {
  return current !== undefined && current.body === before.body && current.pose === before.pose
    && current.group === before.group && current.slot === before.slot && current.identity === before.identity
    && current.wire === before.wire && current.handle === before.handle && validReference(current);
}
export interface GroupStepOperationV2 {
  readonly id: number;
  readonly values: readonly number[];
  readonly member?: V2ActorColumnSlot;
  readonly reference?: GroupStepReferenceV2;
  readonly native?: Readonly<GroupStepNativeV2>;
}
/** One member's pins for a prepared segment, and whether its numbers were kept from the segment before. */
interface GroupMemberRecordV2 {
  readonly source: V2ColumnOwners; readonly self: Readonly<V2ColumnOwners['self']>;
  readonly referenceOwner: V2ColumnOwners['references'];
  readonly references: {name:string;loan:V2ReferenceColumn|null;body:V2ReferenceColumn['body']|undefined;identity:string|undefined;handle:number|undefined}[];
  values: Float64Array; common: boolean; held: boolean;
}
/** A column a segment of reads and memory writes cannot move: not a reply, and not a reference a reply can repoint. */
function steadyColumn(source: V2ColumnSource): boolean {
  if (source.kind === 'result') return source.channel === 'foal' || source.channel === 'mother';
  return source.kind !== 'reference' || source.binding === 'self';
}
/** The members whose memory these operations wrote, when that is all they did: `visibility`, `hearing`, `downwind` and
 * `environment` read, and `memory` writes one member's memory. Anything else may move a body, so nothing is settled. */
export function settledGroupSlots(operations: readonly GroupStepOperationV2[]): readonly number[] | undefined {
  const touched: number[] = [];
  for (const operation of operations) {
    const kind = operation.native?.kind;
    if (kind === 'memory' && operation.member !== undefined) touched.push(operation.member.slot);
    else if (kind !== 'visibility' && kind !== 'hearing' && kind !== 'downwind' && kind !== 'environment') return undefined;
  }
  return touched;
}
/** Admitted operations name few keys and ask per segment, so each is matched once. */
const memoryKeys=new Map<string,boolean>();
function plainMemoryKey(key:string):boolean {
  let plain=memoryKeys.get(key);
  if(plain===undefined){plain=/^(?!(?:__proto__|prototype|constructor)$).+$/u.test(key);if(memoryKeys.size<4096)memoryKeys.set(key,plain);}
  return plain;
}
const stateSlice:unknown=Reflect.get(Float64Array.prototype,'slice');
/** whether a Float64Array writes the bytes DataView.setFloat64(…, true) writes (every supported engine: little-endian) */
const LITTLE_ENDIAN=new Uint8Array(Float64Array.of(1).buffer)[7]===0x3f;
function sameRng(a: RngState, b: RngState): boolean {
  return a.version === b.version && a.state === b.state && a.initial === b.initial && a.scrambledFork === b.scrambledFork;
}
export class GroupStepV2 {
  private readonly rows;
  readonly layout: V2Layout;
  private readonly profiles;
  private readonly module: ScriptModuleV2;
  private readonly writeFrame: ReturnType<typeof createV2FrameWriter>;
  private busy = false;
  private revision = 0;
  private readonly scope: Scope;
  /** The last frozen copy of a roster, and its rows by handle: a group lends the same rows every segment. */
  private loaned: { readonly source: readonly GroupStepReferenceV2[]; readonly refs: readonly Readonly<GroupStepReferenceV2>[]; readonly byHandle: ReadonlyMap<number,Readonly<GroupStepReferenceV2>> } | undefined;
  constructor(bytes: Uint8Array, input: unknown, scope: Scope, shared?: { readonly module: ScriptModuleV2; readonly layout: V2Layout }) {
    this.scope = scope;
    this.live();
    this.rows = structuredClone(parseGroupStepV2(input));
    const minimum=groupStepLayoutV2(this.rows);
    this.layout=shared===undefined?minimum:layoutV2(0,this.rows.pages,new Map(shared.layout.regions.map(row=>[row.kind,row.capacity])));
    if(shared!==undefined&&(this.layout.bytes!==shared.layout.bytes||this.layout.io!==shared.layout.io||this.layout.pages!==shared.layout.pages
      ||minimum.regions.some(row=>(this.layout.regions[row.kind-1]?.capacity??-1)<row.capacity)
      ||!shared.module.owns(bytes,this.layout.io,this.layout.bytes)))throw new Error('Foreign shared group executable');
    this.profiles = [this.rows, ...(this.rows.profiles ?? [])].map((rows, index) => {
      const bank=new GroupBankV2(rows.bank);
      return {
      id: index === 0 ? 'main' : this.rows.profiles?.[index - 1]?.id,
      rows, bank, input: new Float64Array(bank.width), output: new Float64Array(bank.width),
      counts: new Map([[1,1],[2,0],[4,0],[5,1],[6,0],[21,0]]), columns: new ObservationColumnsV2(rows.columns, scope),
      observations: Array.from({length:rows.members},()=>new Float64Array(rows.columns.length)),
      actions: new Map(rows.actions.map(row=>{if(row.native!==undefined)freezeNative(row.native);return [row.id,row];})),
      order: rows.columns.map((row,column)=>({name:row.name,index:column})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(row=>row.index),
      /** the last capture selection's common names (a copy) and the columns they select: a group asks the same each segment */
      selection: undefined as { readonly names: readonly string[]; readonly selected: readonly boolean[]; readonly settled: boolean } | undefined,
      /** the last prepare's token and its member rows: `settled` reads them back instead of capturing again */
      last: undefined as object | undefined,
      records: [] as (GroupMemberRecordV2 | undefined)[],
      /** the observation region's words, written whole: only `present` and the value move between segments */
      fields: undefined as { readonly count: number; readonly bytes: Uint8Array; readonly words: Uint32Array; readonly numbers: Float64Array } | undefined,
    };});
    const source = Uint8Array.from(bytes), admitted = admitScriptV2(source, { lane: 'project', ioBytes: this.layout.bytes });
    if (admitted.io !== 0 || admitted.initialPages !== this.rows.pages) throw new Error('Group step module layout mismatch');
    this.module = shared?.module ?? new ScriptModuleV2(source, { seed: [0, 0], initFuel: this.rows.fuel, ioBytes: this.layout.bytes, output: [] });
    this.writeFrame = createV2FrameWriter(this.layout);
    this.live();
  }
  private live(): void {
    if (this.scope.disposed || this.scope.disposing) throw new Error('Group step owner disposed');
  }
  /** Frozen rows for this roster. A same-row roster keeps its copy: every row is still compared, none is rebuilt. */
  private freezeReferences(source: readonly GroupStepReferenceV2[]): NonNullable<GroupStepV2['loaned']> {
    const known = this.loaned;
    if (known?.source === source && known.refs.length === source.length) {
      let same = true;
      for (let index = 0; same && index < source.length; index++) {
        const row = known.refs[index];
        same = row !== undefined && sameReference(source[index], row);
      }
      if (same) return known;
    }
    const refs = source.map(row => {
      if (!validReference(row)) throw new Error('Foreign group reference body');
      return Object.freeze({ ...row });
    });
    const loaned = { source, refs, byHandle: new Map(refs.map(row => [row.handle, row])) };
    this.loaned = loaned;return loaned;
  }
  /** Capture once, execute once, then validate ALL state/actions/queries/RNG.
   * The original native owner preflights its concrete operation loans before
   * validate/accept and drains the returned ordered operations at that slot.
   * A synchronous native barrier requires another segment at the SAME slot;
   * this transport never invents a delayed mount/adopt/bond transaction. */
  prepare(input: {
    readonly group: string; readonly handle: number; readonly signal: string; readonly tick: number; readonly profile?: string;
    readonly state: Float64Array; readonly members: readonly V2ColumnOwners[];
    readonly capture?: {readonly common:readonly string[];readonly slots:readonly number[]};
    readonly references: readonly GroupStepReferenceV2[]; readonly random?: Rng; readonly contextRandom?: Rng;
    readonly queries?: { readonly ring: QueryRingV2; readonly binding: V2QueryBinding };
    /** The caller's word that since `after` was prepared only `touched` members' memory has moved (see `settledGroupSlots`). */
    readonly settled?: { readonly after: object; readonly touched: readonly number[] };
  }): {
    readonly operations: readonly GroupStepOperationV2[];
    readonly values: Readonly<Record<string,GroupBankValueV2>>;
    readonly validate: () => void;
    readonly accept: () => void;
    /** Drop an unaccepted candidate; consumed candidates remain retired. */
    readonly discard: () => void;
    readonly prepareNative: <A extends AnimalSim>(owners: GroupStepNativeOwnersV2<A>) => {
      readonly validate: () => void;
      readonly accept: () => readonly GroupStepNativeResultV2[];
    };
  } {
    this.live();
    if (this.busy) throw new Error('Reentrant group step');
    this.busy = true;
    let bankPreparation:ReturnType<GroupBankV2['prepare']>|undefined,handedOff=false;
    try {
      const revision = this.revision, stateOwner = input.state;
      const envelope = { group: input.group, handle: input.handle, signal: input.signal, tick: input.tick, profile: input.profile };
      const profileIndex = this.profiles.findIndex(row => row.id === (input.profile ?? 'main'));
      const profile = this.profiles[profileIndex];
      if (profile === undefined) throw new Error('Unknown group step profile');
      const signal = profile.rows.signals.indexOf(input.signal) + 1;
      if (signal === 0 || input.group.length === 0 || input.members.length > profile.rows.members
        || !Number.isInteger(input.handle) || input.handle < 1 || input.handle > 0x7fffffff) throw new Error('Invalid group step input');
      const stateInput=input.state;
      let originalState:Float64Array;
      // This snapshot is used only inside the non-reentrant synchronous call.
      // Public/custom slice semantics stay on the original detached-copy path.
      if(ArrayBuffer.isView(stateInput)&&Object.getPrototypeOf(stateInput)===Float64Array.prototype&&!Object.hasOwn(stateInput,'slice')
        &&!Object.hasOwn(stateInput,'constructor')&&!Object.hasOwn(stateInput,'length')&&stateInput.slice===stateSlice){
        if(stateInput.length!==profile.bank.width)throw new Error('Group bank width mismatch');
        originalState=profile.input;originalState.set(stateInput);
      }else originalState=stateInput.slice();
      profile.bank.validate(originalState, input.group, input.references);
      const { refs, byHandle } = this.freezeReferences(input.references);
      for (const row of refs) if (row.group === input.group && (row.pose === true || input.members[row.slot]?.self.actor !== row.body))
        throw new Error('Foreign group member reference');
      const identities = input.members.filter(owners => owners.self.actor !== null).map(owners => owners.self.identity);
      if (new Set(identities).size !== identities.length) throw new Error('Duplicate group body loan');
      const selection=input.capture,common=selection?.common.slice(),captureSlots=selection?.slots.slice();
      // The admitted columns never change: the same common names (element by element) select the same columns as last time
      const known=profile.selection,same=selection!==undefined&&known!==undefined&&known.names.length===selection.common.length
        &&selection.common.every((name,index)=>name===known.names[index]);
      if(selection!==undefined&&(selection.common.length>128||selection.slots.length>16||!same&&selection.common.some(name=>!profile.rows.columns.some(row=>row.name===name))
        ||selection.slots.some(slot=>!Number.isInteger(slot)||slot<0||slot>=input.members.length)))throw new Error('Invalid group capture selection');
      if(selection!==undefined&&!same){
        const chosen=profile.rows.columns.map(row=>selection.common.includes(row.name));
        profile.selection={names:selection.common.slice(),selected:chosen,settled:profile.rows.columns.every((row,index)=>!chosen[index]||steadyColumn(row.source))};
      }
      const selected=selection===undefined?undefined:profile.selection?.selected;
      const settled=input.settled,keep=settled!==undefined&&same&&profile.selection?.settled===true&&profile.last===settled.after;
      const members:GroupMemberRecordV2[]=[];
      for(let slot=0;slot<input.members.length;slot++){
        const owners=input.members[slot];if(owners===undefined)throw new Error('Missing group member loan');
        if (owners.scope !== this.scope || owners.self.group !== input.group || owners.self.slot !== slot) throw new Error('Foreign group member loan');
        const referenceOwner = owners.references,kept=keep?profile.records[slot]:undefined;
        // A settled record keeps its frozen self and its pins; its loans are reread, since a reply can name a new threat.
        const steady=kept!==undefined&&kept.source===owners&&kept.referenceOwner===referenceOwner&&kept.references.length===(referenceOwner?.size??0)&&kept.self.actor===owners.self.actor&&kept.self.identity===owners.self.identity;
        const references=steady?kept.references:[];
        if(referenceOwner!==undefined){
          let index=0;
          // The whole entry list first: a loan's getter can change the map, and validate must see that it did.
          const entries=[...referenceOwner];
          for(const [name,loan] of entries){
            if(loan!==null){
              const row=byHandle.get(loan.handle);
              if(row===undefined||row.body!==loan.body||row.identity!==loan.identity)throw new Error('Foreign observed group reference');
            }
            const pin=references[index];
            if(steady&&pin?.name===name){pin.loan=loan;pin.body=loan?.body;pin.identity=loan?.identity;pin.handle=loan?.handle;}
            else references[index]={name,loan,body:loan?.body,identity:loan?.identity,handle:loan?.handle};
            index++;
          }
        }
        // The busy fence makes these per-profile/member buffers exclusive until
        // the synchronous input writer finishes. Candidate validation reads
        // only body pins; it never rereads these numeric inputs.
        const destination=profile.observations[slot];if(destination===undefined)throw new Error('Missing group observation destination');
        const whole=selection===undefined||selection.slots.includes(slot),held=steady&&!whole&&kept.common&&settled?.touched.includes(slot)!==true;
        const record:GroupMemberRecordV2=steady?kept:{source:owners,self:Object.freeze({...owners.self}),referenceOwner,references,values:destination,common:false,held:false};
        record.values=held?destination:profile.columns.captureNumeric(owners,whole?undefined:selected,destination);
        record.common=!whole;record.held=held;
        profile.records[slot]=record;members.push(record);
      }
      for (let index = 0; index < originalState.length; index++) if (!Object.is(originalState[index], input.state[index])) throw new Error('Group state or reference changed during capture');
      if (input.references.length !== refs.length) throw new Error('Group state or reference changed during capture');
      for (let index = 0; index < refs.length; index++) {
        const row = refs[index];
        if (row === undefined || !sameReference(input.references[index], row)) throw new Error('Group state or reference changed during capture');
      }
      const random = input.random, contextRandom = input.contextRandom;
      if (contextRandom !== undefined && (this.rows.randomStreams !== 2 || random === undefined || contextRandom === random))
        throw new Error('Undeclared or aliased group RNG streams');
      const randoms = [random, contextRandom].flatMap((owner, index) => owner === undefined ? [] : [{
        owner, stream: index + 1, before: owner.snapshot(), restore: Reflect.get(owner, 'restore'),
        snapshot: Reflect.get(owner, 'snapshot'), next: Reflect.get(owner, 'next'),
      }]);
      const rng = prepareV2Rng(this.layout, randoms.map(loan => ({ binding: input.handle, stream: loan.stream, algorithm: 1,
        state: [loan.before.state, loan.before.initial, Number(loan.before.scrambledFork), 0, 0, 0] })));
      const binding = input.queries?.binding;
      if (binding !== undefined && (binding.identity !== input.group || binding.handle !== input.handle
        || binding.observed.size !== refs.length || refs.some(row => binding.observed.get(row.handle) !== row.identity))) throw new Error('Foreign group query loan');
      const queryLoan = input.queries;
      const queryObserved = binding === undefined ? [] : [...binding.observed];
      const queryOperations = binding === undefined ? [] : [...binding.operations];
      const delivery = input.queries?.ring.delivery(input.tick, new Map([[input.group, binding ?? { identity: input.group,
        handle: input.handle, observed: new Map(), operations: new Set() }]]), new Set([input.group]));
      const parameters=this.rows.profiles===undefined?2:3, fieldCount=members.length*profile.order.length;
      // Only numeric staging is reused; the writer detaches header/count authority.
      const extra = delivery?.banks ?? [];
      const counts=extra.length===0?profile.counts:new Map(profile.counts);
      counts.set(2,originalState.length);counts.set(4,parameters);counts.set(6,fieldCount);
      if(extra.length>0)counts.delete(21);
      for (const bank of extra) counts.set(bank.kind, bank.count);
      counts.set(21, rng.count);
      let authority: V2FrameAuthority | undefined;
      const candidate = this.module.project(this.rows.fuel, view => {
        authority = this.writeFrame(view, { lane: 2, module: 1, sequence: 0, tick: input.tick, due: 1 }, counts);
        // The group layout is fixed at admission. Write detached numeric
        // columns directly; no per-member names, sorting or generic batch.
        const at=(kind:number):number=>{
          const region=this.layout.regions[kind-1];
          if(region===undefined)throw new Error('Missing group input region');
          return this.layout.io+region.offset;
        };
        const b=at(1),o=at(5),p=at(4),f=at(6),state=at(2);
        new Uint8Array(view.buffer,view.byteOffset+b,64).fill(0);
        new Uint8Array(view.buffer,view.byteOffset+o,96).fill(0);
        const stamp=relativeTickV2(input.tick,Math.floor(input.tick/2**30)*2**30);
        // The binding block is already zeroed; retain its reserved words without per-segment array/iterator scratch.
        view.setUint32(b,input.handle,true);view.setUint32(b+12,3,true);view.setUint32(b+20,originalState.length,true);
        view.setUint32(b+28,parameters,true);view.setUint32(b+40,fieldCount,true);view.setUint32(b+44,6,true);
        view.setInt32(b+48,stamp,true);view.setInt32(b+52,stamp,true);view.setUint32(b+56,this.rows.fuel,true);
        view.setUint32(o,input.handle,true);view.setInt32(o+16,stamp,true);
        // one bulk copy of the same little-endian words where the bank region is 8-aligned
        if(LITTLE_ENDIAN&&(view.byteOffset+state)%8===0)new Float64Array(view.buffer,view.byteOffset+state,originalState.length).set(originalState);
        else for(let index=0;index<originalState.length;index++)view.setFloat64(state+index*8,originalState[index]??0,true);
        view.setFloat64(p,signal,true);view.setFloat64(p+8,members.length,true);
        if(parameters===3)view.setFloat64(p+16,profileIndex,true);
        let field=0;
        if(LITTLE_ENDIAN){
          // one bulk copy of the same words: only `present` and the value change, and the row ids stay staged
          let staged=profile.fields;
          const stagedBefore=staged;
          if(staged?.count!==fieldCount){
            const buffer=new ArrayBuffer(fieldCount*16);
            staged={count:fieldCount,bytes:new Uint8Array(buffer),words:new Uint32Array(buffer),numbers:new Float64Array(buffer)};
            for(let index=0;index<fieldCount;index++)staged.words[index*4]=index+1;
            profile.fields=staged;
          }
          const {words,numbers,bytes}=staged,order=profile.order,columns=order.length;
          for(let slot=0;slot<members.length;slot++){
            const member=members[slot],row=member?.values;
            // a held row is still in the staging words the last segment copied from
            if(member?.held===true&&staged===stagedBefore){field+=columns;continue;}
            for(let index=0;index<columns;index++){
              const value=row?.[order[index]??-1];
              if(value===undefined||value===Infinity||value===-Infinity)throw new Error('Invalid group observation column');
              const present=!Number.isNaN(value);words[field*4+1]=present?1:0;numbers[field*2+1]=present?value:0;field++;
            }
          }
          new Uint8Array(view.buffer,view.byteOffset+f,bytes.length).set(bytes);
        }else for(const member of members)for(const column of profile.order){
          const value=member.values[column];
          if(value===undefined||value===Infinity||value===-Infinity)throw new Error('Invalid group observation column');
          const offset=f+field*16,present=!Number.isNaN(value);view.setUint32(offset,field+1,true);view.setUint32(offset+4,Number(present),true);view.setFloat64(offset+8,present?value:0,true);field++;
        }
        for (const bank of [...extra, { kind: 21, count: rng.count, bytes: rng.bytes }]) {
          const region = this.layout.regions[bank.kind - 1];
          if (region === undefined || bank.bytes.length !== bank.count * region.stride || bank.count > region.capacity) throw new Error('Group input bank capacity');
          new Uint8Array(view.buffer, this.layout.io + region.offset, bank.bytes.length).set(bank.bytes);
        }
      }, view => {
        if (authority === undefined) throw new Error('Missing group frame authority');
        const actual = validateV2Frame(view, this.layout, authority), state = this.layout.regions[2], actions = this.layout.regions[9];
        if (state === undefined || actions === undefined || actual[2] !== profile.bank.width || (actual[9] ?? 0) > this.rows.outputs) throw new Error('Incomplete group candidate');
        const bank = profile.output, words = this.layout.io + state.offset;
        if (LITTLE_ENDIAN && (view.byteOffset + words) % 8 === 0) bank.set(new Float64Array(view.buffer, view.byteOffset + words, bank.length));
        else for (let index = 0; index < bank.length; index++) bank[index] = view.getFloat64(words + index * 8, true);
        const prepared = profile.bank.prepare(input.state, bank, input.group, input.references, this.scope);
        bankPreparation=prepared;
        const operations: GroupStepOperationV2[] = [];
        for (let index = 0; index < (actual[9] ?? 0); index++) {
          const at = this.layout.io + actions.offset + index * 64, id = view.getUint32(at + 8, true);
          const action = profile.actions.get(id);
          if (action === undefined || view.getUint32(at, true) !== input.handle || view.getUint32(at + 4, true) !== 25
            || view.getUint32(at + 12, true) !== 0) throw new Error('Undeclared group operation');
          const values: number[] = [];
          for (let word = 0; word < 6; word++) {
            const value = view.getFloat64(at + 16 + word * 8, true);
            if (!Number.isFinite(value) || word >= action.words && !Object.is(value, 0)) throw new Error('Invalid group operation operands');
            if (word < action.words) values.push(value);
          }
          const slot = action.member === undefined ? undefined : values[action.member];
          const member = slot === undefined ? undefined : members[slot]?.self;
          const body = member?.actor;
          if (slot !== undefined && (!Number.isInteger(slot) || slot < 0 || body === undefined || body === null)) throw new Error('Unknown group operation member');
          const handle = action.reference === undefined ? undefined : values[action.reference.word];
          const reference = handle === undefined || handle === 0 ? undefined : refs.find(row => row.handle === handle);
          if (action.reference !== undefined && (handle === undefined || !Number.isInteger(handle)
            || (handle === 0 ? action.reference.nullable !== true : reference === undefined)
            || reference !== undefined && action.reference.own === true && reference.group !== input.group)) throw new Error('Unknown group operation reference');
          operations.push(Object.freeze({ id, values: Object.freeze(values),
            ...(member === undefined ? {} : { member }), ...(reference === undefined ? {} : { reference }),
            ...(action.native === undefined ? {} : { native: action.native }) }));
        }
        const queries = actual[10] ?? 0;
        if (queries !== 0 && input.queries === undefined) throw new Error('Missing group query authority');
        const query = input.queries?.ring.prepareFrame(view, queries, input.tick, new Map(binding === undefined ? [] : [[input.handle, binding]]), delivery?.consumed ?? []);
        const next = rng.readCandidate(view, actual[21] ?? 0, new Set([input.handle]));
        return { prepared, operations: Object.freeze(operations), query, next };
      }).value;
      let accepted = false;
      const validate = (): void => {
        this.live();
        if (accepted || revision !== this.revision) throw new Error('Group step already accepted or superseded');
        if (input.group !== envelope.group || input.handle !== envelope.handle || input.signal !== envelope.signal
          || input.tick !== envelope.tick || input.profile !== envelope.profile || input.state !== stateOwner || input.random !== random || input.contextRandom !== contextRandom || input.queries !== queryLoan
          || binding !== undefined && (binding.observed.size !== queryObserved.length || binding.operations.size !== queryOperations.length
            || queryObserved.some(([key, value]) => binding.observed.get(key) !== value) || queryOperations.some(op => !binding.operations.has(op))))
          throw new Error('Changed group continuation owner');
        if(input.capture!==selection||selection!==undefined&&(common===undefined||captureSlots===undefined
          ||selection.common.length!==common.length||selection.slots.length!==captureSlots.length
          ||common.some((name,index)=>selection.common[index]!==name)||captureSlots.some((slot,index)=>selection.slots[index]!==slot)))throw new Error('Changed group capture selection');
        candidate.prepared.validate(); candidate.query?.validate();
        if (input.members.length !== members.length || members.some((member, slot) => {
          const owners = input.members[slot];
          return owners !== member.source || owners.scope !== this.scope || owners.self.actor !== member.self.actor
            || owners.self.group !== member.self.group || owners.self.slot !== member.self.slot || owners.self.identity !== member.self.identity
            || member.self.actor !== null && member.self.actor.entityId !== member.self.identity
            || owners.references !== member.referenceOwner || (owners.references?.size ?? 0) !== member.references.length
            || member.references.some(reference => {
              const current = owners.references?.get(reference.name);
              return current !== reference.loan || current?.body !== reference.body || current?.identity !== reference.identity || current?.handle !== reference.handle;
            });
        }) || input.references.length !== refs.length || refs.some((row, index) => !sameReference(input.references[index], row))) throw new Error('Changed group body loan');
        if (randoms.some(loan => Reflect.get(loan.owner, 'restore') !== loan.restore || Reflect.get(loan.owner, 'snapshot') !== loan.snapshot
          || Reflect.get(loan.owner, 'next') !== loan.next || !sameRng(loan.before, loan.owner.snapshot())
          || !candidate.next.some(row => row.stream === loan.stream))) throw new Error('Changed group RNG owner');
      };
      const accept = (): void => {
        validate(); candidate.query?.(); candidate.prepared.accept();
        for (const loan of randoms) {
          const next = candidate.next.find(row => row.stream === loan.stream);
          if (next === undefined) throw new Error('Missing group RNG candidate');
          loan.owner.restore({ ...loan.before, state: next.state[0] });
        }
        accepted = true; this.revision++;
      };
      const discard=():void=>{if(!accepted){accepted=true;candidate.prepared.discard();}};
      handedOff=true;
      const prepared={ operations: candidate.operations, values: candidate.prepared.values, validate, accept, discard, prepareNative: <A extends AnimalSim>(owners: GroupStepNativeOwnersV2<A>) => {
        if (owners.scope !== this.scope || owners.members !== input.members
          || owners.references !== undefined && owners.references !== input.references) throw new Error('Foreign native group result scope');
        const native = prepareGroupNativeV2(candidate.operations, owners);
        const validateNative = (): void => { validate();native.validate(); };
        return { validate: validateNative, accept: () => {
          validateNative();accept();return native.run();
        } };
      } };
      profile.last=prepared;
      return prepared;
    } finally { if(!handedOff)bankPreparation?.discard();this.busy = false; }
  }
}

// The constructor has already detached these declarations from their author.
function freezeNative(row: GroupStepNativeV2): Readonly<GroupStepNativeV2> {
  if (row.kind === 'hearing') Object.freeze(row.radii);
  if (row.kind === 'state' || row.kind === 'notify-state') Object.freeze(row.states);
  if (row.kind === 'sound') Object.freeze(row.cues);
  if (row.kind === 'event') Object.freeze(row.events);
  return Object.freeze(row);
}

/** The original per-call population context. No callback is supplied by an
 * authored row; confinement remains optional only on the pack context type. */
export type GroupStepContextV2<A extends AnimalSim = AnimalSim> = GuardedHerdContext<A>
  | (CirclingPackContext<A> & { readonly confine?: (actor: A) => void });
/** Concrete original authorities for same-call result barriers. No native
 * operation is selected by a callback, object path or content identifier. */
export interface GroupStepNativeOwnersV2<A extends AnimalSim = AnimalSim> {
  readonly scope: Scope;
  readonly members: readonly V2ColumnOwners<A>[];
  readonly contexts?: readonly GroupStepContextV2<A>[];
  readonly group?: { readonly kind: 'pack'; readonly owner: StalkerBrain<A> }
    | { readonly kind: 'herd'; readonly owner: GrazerBrain<A> };
  readonly references?: readonly GroupStepReferenceV2<A>[];
  readonly rosters?: ReadonlyMap<string, readonly GroupStepReferenceV2<A>[]>;
  readonly ground?: { readonly normalY: (x: number, z: number) => number };
  readonly grass?: { readonly grassHeightAt: (x: number, z: number) => number };
  readonly aggression?: {
    readonly kind: 'events';
    readonly service: AggressionService;
    readonly events: Events;
    readonly director: AggressionDirector<A>;
  } | {
    readonly kind: 'tokens';
    readonly owners: WeakMap<A, AggressionDirector<A>>;
    readonly director: AggressionDirector<A>;
  };
}
export interface GroupStepNativeResultV2 {
  readonly channel: string;
  readonly value: number;
  readonly member?: V2ActorColumnSlot;
}

/** Prepare a finite native segment without sampling or changing any native
 * owner. The original group accepts its candidate before run(), then feeds
 * these transient results into source:result columns and resumes at the SAME
 * call slot. An undeclared operation in the bank refuses before any prefix. */
export function prepareGroupNativeV2<A extends AnimalSim = AnimalSim>(operations: readonly GroupStepOperationV2[], owners: GroupStepNativeOwnersV2<A>): {
  readonly validate: () => void;
  readonly run: () => readonly GroupStepNativeResultV2[];
} {
  const scope = owners.scope, sources = owners.members.slice();
  const pins: (() => boolean)[] = [], before: (() => boolean)[] = [];
  const live = (): void => {
    if (owners.scope !== scope || scope.disposed || scope.disposing
      || owners.members.length !== sources.length || sources.some((row, index) => owners.members[index] !== row)
      || pins.some(pin => !pin())) throw new Error('Retired or replaced native group result owner');
  };
  live();
  if (operations.length > 512 || sources.length > 16) throw new Error('Native group result capacity');
  let used = false;
  const channels = operations.length > 1 ? new Set<string>() : undefined;
  const group = owners.group;
  if (group !== undefined) {
    const owner = group.owner, kind = group.kind, roster = owner.members, original = roster.slice(), ports = owner.groupPorts;
    pins.push(() => owners.group === group && group.kind === kind && group.owner === owner && owner.members === roster && owner.groupPorts === ports);
    before.push(() => roster.length === original.length && original.every((body,index) => roster[index] === body)
      && sources.every((source,index) => source.self.actor === null || source.self.actor === original[index]));
  }
  let plans:Map<A,{readonly parts:Map<number,readonly number[]>;publication?:{validate:()=>void;accept:()=>void}}>|undefined;
  const prepared = operations.map(operation => {
    const request = operation.native;
    if (request === undefined || 'channel' in request && (request.channel.length === 0 || request.channel.length > 128)
      || operation.values.some(value => !Number.isFinite(value)))
      throw new Error('Missing or invalid native group result declaration');
    const targetKind = groupNativeTargetV2(request);
    if (operation.values.length !== groupNativeWordsV2(request)) throw new Error('Native group result arity');
    const member = operation.member;
    const resultChannel = 'channel' in request ? request.channel : undefined;
    if (resultChannel !== undefined && channels !== undefined) {
      const channel = `${String(member?.slot ?? '')}:${resultChannel}`;
      if (channels.has(channel)) throw new Error('Duplicate native group result channel');
      channels.add(channel);
    }
    const source = member === undefined ? undefined : sources[member.slot];
    if (targetKind !== 'member' ? member !== undefined : member === undefined || source === undefined
      || !Number.isInteger(member.slot) || member.slot < 0 || operation.values[0] !== member.slot
      || source.scope !== scope || source.self.actor !== member.actor || member.actor === null
      || source.self.identity !== member.identity || source.self.group !== member.group
      || source.self.slot !== member.slot || member.actor.entityId !== member.identity)
      throw new Error('Foreign native group result member');
    if (member !== undefined && source !== undefined) {
      const body = member.actor;
      pins.push(() => source.scope === scope && source.self.actor === body && source.self.group === member.group
        && source.self.slot === member.slot && source.self.identity === member.identity
        && body !== null && body.entityId === member.identity);
    }
    const emittedReference = operation.reference;
    if (targetKind === 'reference') {
      const references = owners.references;
      if (emittedReference === undefined || references === undefined || references.length > 1024 || !validReference(emittedReference)
        || operation.values[0] !== emittedReference.handle || !references.some(row => sameReference(row,emittedReference)))
        throw new Error('Foreign native group effect reference');
      // Membership is checked before the first effect. Later adoption may
      // change the roster; every operation retains this emitted body.
      before.push(() => owners.references === references && references.some(row => sameReference(row,emittedReference)));
    } else if (emittedReference !== undefined) throw new Error('Unexpected native group effect reference');
    const nativeActor = (): A => {
      const actor = source?.self.actor;
      if (actor === undefined || actor === null || actor !== member?.actor) throw new Error('Missing native emitted actor');
      if (group === undefined) return actor;
      const original = group.owner.members.find(row => row === actor);
      if (original === undefined) throw new Error('Foreign native group actor');
      return original;
    };
    const nativeReference = (): A => {
      const original = emittedReference === undefined ? undefined : owners.references?.find(row => sameReference(row,emittedReference));
      if (original === undefined || original.pose === true) throw new Error('Native effect requires original typed actor reference');
      return original.body;
    };
    const prepareContext = (): GroupStepContextV2<A> => {
      const contexts = owners.contexts, context = member === undefined ? undefined : contexts?.[member.slot], body = member?.actor;
      if (member === undefined || source === undefined || contexts === undefined || contexts.length !== sources.length || context === undefined || body === undefined || body === null
        || context !== source.context || context.player !== source.player.position || !Number.isFinite(context.dt) || !Number.isFinite(context.t)
        || context.dt !== source.dt || context.t !== source.t) throw new Error('Missing or foreign native group context');
      const player = context.player, random = context.rng, time = context.t, dt = context.dt;
      pins.push(() => owners.contexts === contexts && contexts.length === sources.length && contexts[member.slot] === context
        && source.context === context && context.player === player && source.player.position === player && context.rng === random
        && Object.is(context.t,time) && Object.is(source.t,time) && Object.is(context.dt,dt) && Object.is(source.dt,dt));
      return context;
    };
    let invoke: () => number | undefined;
    switch (request.kind) {
      case 'locomotion-plan': {
        const body=nativeActor();
        if(group?.kind!=='herd'||!Number.isInteger(request.part)||request.part<0||request.part>7)throw new Error('Invalid native locomotion owner');
        plans ??= new Map();
        let plan=plans.get(body);if(plan===undefined){plan={parts:new Map()};plans.set(body,plan);}
        if(plan.parts.has(request.part))throw new Error('Duplicate locomotion plan part');
        plan.parts.set(request.part,operation.values.slice(1));
        const current=plan;
        invoke=()=>{if(request.part===0){if(current.publication===undefined)throw new Error('Incomplete locomotion plan');current.publication.accept();}return undefined;};
        break;
      }

      case 'notify-state': case 'notify-flight': case 'notify-beaten': case 'append-member': {
        if (group?.kind !== 'herd') throw new Error('Missing original herd notification owner');
        const owner = group.owner, value = operation.values[0];
        if (request.kind === 'notify-state') {
          const state = GUARDED_STALLION_STATES.find(name => name === (value === undefined ? undefined : request.states[value]));
          if (value === undefined || !Number.isInteger(value) || state === undefined) throw new Error('Invalid native group state notification');
          const notify = owner.onStallionState;
          if (notify !== undefined && typeof notify !== 'function') throw new Error('Invalid native state notification');
          pins.push(() => owner.onStallionState === notify);
          invoke = () => { notify?.call(owner,state,owner);return undefined; };
        } else if (request.kind === 'notify-flight') {
          if (value !== 0 && value !== 1) throw new Error('Invalid native group flight notification');
          const notify = owner.onFlight;
          if (notify !== undefined && typeof notify !== 'function') throw new Error('Invalid native flight notification');
          pins.push(() => owner.onFlight === notify);
          invoke = () => { notify?.call(owner,value === 1,owner);return undefined; };
        } else {
          const body = nativeReference();
          if (request.kind === 'notify-beaten') {
            const notify = owner.onBeaten;
            if (notify !== undefined && typeof notify !== 'function') throw new Error('Invalid native beaten notification');
            pins.push(() => owner.onBeaten === notify);
            invoke = () => { notify?.call(owner,body,owner);return undefined; };
          } else {
            const roster = owner.members, includes: unknown = Reflect.get(roster,'includes'), push: unknown = Reflect.get(roster,'push');
            if (typeof includes !== 'function' || typeof push !== 'function') throw new Error('Invalid native member collection');
            pins.push(() => owner.members === roster && roster.includes === includes && roster.push === push);
            invoke = () => { if (!roster.includes(body)) roster.push(body);return undefined; };
          }
        }
        break;
      }
      case 'scare': {
        if (group?.kind !== 'herd') throw new Error('Missing original group scare owner');
        const body = nativeReference(), radius = operation.values[1], ports = group.owner.groupPorts, scare = ports.scarePack;
        if (radius === undefined || radius < 0 || typeof scare !== 'function') throw new Error('Invalid native scare operation');
        pins.push(() => ports.scarePack === scare);
        invoke = () => { const value = scare.call(ports,body,radius);
          if (typeof value !== 'boolean') throw new Error('Invalid native scare result');return Number(value); };
        break;
      }
      case 'nearest-group': {
        if (group === undefined || owners.references === undefined) throw new Error('Missing original group nearest owner');
        const references = owners.references, original = references.map(row => Object.freeze({...row})), x = operation.values[0], z = operation.values[1], radius = operation.values[2];
        if (x === undefined || z === undefined || radius === undefined || radius < 0) throw new Error('Invalid native group nearest operands');
        before.push(() => owners.references === references && references.length === original.length && original.every((row,index) => sameReference(references[index],row)));
        const resolve = (body: CirclingPackPrey | null): number => {
          if (body === null) return 0;
          const found = original.find(row => row.body === body);
          if (found === undefined) throw new Error('Unknown native nearest result reference');return found.handle;
        };
        const owner = group.owner;
        const find: ((x:number,z:number,radius:number) => CirclingPackPrey | null) | undefined = group.kind === 'pack' ? group.owner.findPrey : group.owner.findThreat;
        if (find !== undefined && typeof find !== 'function') throw new Error('Invalid native nearest callable');
        pins.push(() => group.kind === 'pack' ? group.owner.findPrey === find : group.owner.findThreat === find);
        invoke = () => resolve(find?.call(owner,x,z,radius) ?? null);
        break;
      }
      case 'group-claim': {
        if (group?.kind !== 'pack') throw new Error('Missing original group token owner');
        const body = nativeActor(), context = prepareContext(), cap = operation.values[1], mask = operation.values[2], owner = group.owner, roster = owner.members;
        if (!('claim' in context) || cap === undefined || !Number.isInteger(cap) || cap < 0 || cap > 128 || roster.length > 16
          || mask === undefined || !Number.isInteger(mask) || mask < 0 || mask >= 2 ** roster.length) throw new Error('Invalid native group token operands');
        const attacking = roster.filter((_actor,index) => (mask & (1 << index)) !== 0), ports = owner.groupPorts, register = ports.register, claim = context.claim;
        const borrow: unknown = Reflect.get(owner,'borrowGroupDirector');
        if (typeof register !== 'function' || typeof claim !== 'function' || typeof borrow !== 'function') throw new Error('Missing native group token callable');
        pins.push(() => owner.borrowGroupDirector === borrow && ports.register === register && context.claim === claim);
        invoke = () => { const director = owner.borrowGroupDirector(cap,attacking);register.call(ports,body,director);live();
          const value = claim.call(context,body);if (typeof value !== 'boolean') throw new Error('Invalid native group token result');return Number(value); };
        break;
      }
      case 'cancel-attack': case 'start-attack': {
        const body = member?.actor;
        if (body === undefined || body === null) throw new Error('Missing native attack owner');
        if (request.kind === 'cancel-attack') {
          const cancel: unknown = Reflect.get(body,'cancelAttack');
          if (typeof cancel !== 'function') throw new Error('Missing native cancel callable');
          pins.push(() => body.cancelAttack === cancel);
          invoke = () => { body.cancelAttack();return undefined; };
        } else {
          const seconds = operation.values[1], start: unknown = Reflect.get(body,'startAttack');
          if (seconds === undefined || typeof start !== 'function') throw new Error('Missing native start callable');
          pins.push(() => body.startAttack === start);
          invoke = () => { body.startAttack(seconds);return undefined; };
        }
        break;
      }
      case 'environment': {
        if (group === undefined) throw new Error('Missing native environment group');
        if (request.field === 'playerCrouched') {
          if (group.kind !== 'herd') throw new Error('Missing native crouch environment');
          const ports = group.owner.groupPorts, environment = ports.environment;
          if (typeof environment !== 'function') throw new Error('Missing native environment callable');
          pins.push(() => ports.environment === environment);
          invoke = () => { const value = environment.call(ports).playerCrouched;
            if (typeof value !== 'boolean') throw new Error('Invalid native environment boolean');return Number(value); };
        } else {
          const ports = group.owner.groupPorts, environment = ports.environment;
          if (typeof environment !== 'function') throw new Error('Missing native environment callable');
          pins.push(() => ports.environment === environment);
          invoke = () => { const value = ports.environment().playerMounted;
            if (typeof value !== 'boolean') throw new Error('Invalid native environment boolean');return Number(value); };
        }
        break;
      }
      case 'event': case 'knockdown': {
        const x = operation.values[request.kind === 'event' ? 1 : 0], z = operation.values[request.kind === 'event' ? 2 : 1];
        if (group === undefined || x === undefined || z === undefined) throw new Error('Missing native group notification owner');
        if (request.kind === 'event') {
          const code = operation.values[0], name = code === undefined ? undefined : request.events[code], ports = group.owner.groupPorts, event = ports.onEvent;
          if (code === undefined || !Number.isInteger(code) || name === undefined || event !== undefined && typeof event !== 'function') throw new Error('Invalid native event owner or name');
          pins.push(() => ports.onEvent === event);
          invoke = () => { event?.call(ports,name,x,z);return undefined; };
        } else {
          if (group.kind !== 'herd') throw new Error('Missing native knockdown group');
          const strength = operation.values[2], ports = group.owner.groupPorts, knock = ports.onKnockdown;
          if (strength === undefined || knock !== undefined && typeof knock !== 'function') throw new Error('Invalid native knockdown owner');
          pins.push(() => ports.onKnockdown === knock);
          invoke = () => { knock?.call(ports,x,z,strength);return undefined; };
        }
        break;
      }
      case 'pass-through': {
        const body = nativeActor(), value = operation.values[1];
        if (group?.kind !== 'herd' || value !== 0 && value !== 1) throw new Error('Invalid native pass-through owner');
        const ports = group.owner.groupPorts, pass = ports.passThrough;
        if (typeof pass !== 'function') throw new Error('Missing native pass-through callable');
        pins.push(() => ports.passThrough === pass);
        invoke = () => { pass.call(ports,body,value === 1);return undefined; };
        break;
      }
      case 'damage': {
        const body = emittedReference?.body, amount = operation.values[1], x = operation.values[2], z = operation.values[3];
        if (body === undefined || amount === undefined || x === undefined || z === undefined || typeof body.applyDamage !== 'function')
          throw new Error('Missing native damage owner');
        const apply = body.applyDamage, position = body.position;
        const finitePose = (): boolean => [position.x,position.y,position.z].every(Number.isFinite);
        if (!finitePose()) throw new Error('Invalid native damage position');
        pins.push(() => body.applyDamage === apply && body.position === position && finitePose());
        invoke = () => { apply.call(body,amount,position,new Vector3(x,0,z));return undefined; };
        break;
      }
      case 'stagger': case 'health': {
        if (emittedReference === undefined || emittedReference.pose === true) throw new Error('Native effect requires original actor storage');
        const body = emittedReference.body, value = operation.values[1];
        if (value === undefined) throw new Error('Missing native actor effect operand');
        if (request.kind === 'health') {
          const writable = (): boolean => {
            const property = Object.getOwnPropertyDescriptor(body,'hp');
            return property !== undefined && Object.hasOwn(property,'value') && property.writable === true;
          };
          if (!writable()) throw new Error('Invalid native health owner');
          pins.push(writable);
          invoke = () => { body.hp = value;return undefined; };
        } else {
          const z = operation.values[2], strength = operation.values[3], stagger: unknown = Reflect.get(body,'stagger');
          if (z === undefined || strength === undefined || typeof stagger !== 'function') throw new Error('Missing native stagger owner');
          pins.push(() => body.stagger === stagger);
          invoke = () => { body.stagger(new Vector3(value,0,z),strength);return undefined; };
        }
        break;
      }
      case 'memory': {
        const body = member?.actor, value = operation.values[1], valid = operation.values[2];
        if (body === undefined || body === null || value === undefined || !plainMemoryKey(request.key))
          throw new Error('Invalid native memory operation');
        if (request.encoding !== undefined && (valid !== 0 && valid !== 1 || valid === 0 && !Object.is(value,0)))
          throw new Error('Invalid native memory encoding');
        const memory = body.mem, key = request.key;
        const writable = (): boolean => {
          const descriptor = Object.getOwnPropertyDescriptor(memory,key);
          return descriptor === undefined ? Object.isExtensible(memory) : Object.hasOwn(descriptor,'value') && descriptor.writable === true;
        };
        const prototype: unknown = Object.getPrototypeOf(memory);
        if (prototype !== Object.prototype && prototype !== null || !writable()) throw new Error('Invalid native memory owner');
        pins.push(() => body.mem === memory && writable());
        const decoded = request.encoding === 'negative-infinity' && valid === 0 ? -Infinity : value;
        invoke = () => { memory[key] = decoded;return undefined; };
        break;
      }
      case 'state': {
        const body = member?.actor, code = operation.values[1], state = code === undefined ? undefined : request.states[code];
        const value = ANIMAL_STATES.find(row => row === state);
        if (body === undefined || body === null || code === undefined || !Number.isInteger(code) || value === undefined
          || request.states.some(row => !ANIMAL_STATES.some(allowed => allowed === row))) throw new Error('Unknown native actor state');
        invoke = () => { body.state = value;return undefined; };
        break;
      }
      case 'look-weight': {
        const body = member?.actor, value = operation.values[1];
        if (body === undefined || body === null || value === undefined) throw new Error('Missing native look owner');
        invoke = () => { body.lookWeight = value;return undefined; };
        break;
      }
      case 'look-position': {
        const body = member?.actor, x = operation.values[1], y = operation.values[2], z = operation.values[3];
        if (body === undefined || body === null || x === undefined || y === undefined || z === undefined) throw new Error('Missing native look owner');
        const target = body.lookTarget, set: unknown = Reflect.get(target,'set');
        if (typeof set !== 'function') throw new Error('Invalid native look callable');
        pins.push(() => body.lookTarget === target && target.set === set);
        invoke = () => { target.set(x,y,z);return undefined; };
        break;
      }
      case 'motion': {
        const body = member?.actor, yaw = operation.values[1], speed = operation.values[2], turn = operation.values[3];
        if (body === undefined || body === null || yaw === undefined || speed === undefined || turn === undefined) throw new Error('Missing native motion owner');
        const set: unknown = Reflect.get(body,'setMotion');
        if (typeof set !== 'function') throw new Error('Invalid native motion callable');
        pins.push(() => body.setMotion === set);
        invoke = () => { body.setMotion(yaw,speed,turn);return undefined; };
        break;
      }
      case 'steer': case 'path': case 'confine': case 'sound': case 'hurt': case 'contact': {
        const context = prepareContext(), body = nativeActor();
        if (request.kind === 'sound') {
          const code = operation.values[1], cue = code === undefined ? undefined : request.cues[code], sound = context.sound;
          if (code === undefined || !Number.isInteger(code) || cue === undefined || typeof sound !== 'function') throw new Error('Invalid native sound owner or cue');
          pins.push(() => context.sound === sound);
          invoke = () => { sound.call(context,cue);return undefined; };
        } else if (request.kind === 'hurt') {
          const amount = operation.values[1];
          if (!('hurt' in context) || typeof context.hurt !== 'function' || amount === undefined) throw new Error('Missing native hurt owner');
          const hurt = context.hurt;pins.push(() => context.hurt === hurt);
          invoke = () => { hurt.call(context,amount);return undefined; };
        } else if (request.kind === 'contact') {
          const radius = operation.values[1];
          if (group === undefined || radius === undefined || radius < 0) throw new Error('Missing native group contact owner');
          if (group.kind === 'pack') {
            if (!('claim' in context)) throw new Error('Missing original pack context');
            const ports = group.owner.groupPorts, bite = ports.bite;
            if (typeof bite !== 'function') throw new Error('Missing native bite owner');
            pins.push(() => ports.bite === bite);
            invoke = () => { bite.call(ports,body,context,radius);return undefined; };
          } else {
            if (!('hurt' in context)) throw new Error('Missing original herd context');
            const ports = group.owner.groupPorts, contact = ports.chargeContact;
            if (typeof contact !== 'function') throw new Error('Missing native charge owner');
            pins.push(() => ports.chargeContact === contact);
            invoke = () => { contact.call(ports,body,context,radius);return undefined; };
          }
        } else if (request.kind === 'confine') {
          const confine = context.confine;
          if (typeof confine !== 'function') throw new Error('Missing native group confinement');
          pins.push(() => context.confine === confine);
          invoke = () => { confine.call(context,body);return undefined; };
        } else {
          const a = operation.values[1], b = operation.values[2], c = operation.values[3];
          if (a === undefined || b === undefined || c === undefined) throw new Error('Missing native group steering operands');
          if (request.kind === 'path') {
            const path = context.pathYaw;
            if (typeof path !== 'function') throw new Error('Missing native group path owner');
            pins.push(() => context.pathYaw === path);
            invoke = () => path.call(context,body,a,b,c);
          } else {
            const steer = context.steer;
            if (typeof steer !== 'function') throw new Error('Missing native group steering owner');
            pins.push(() => context.steer === steer);
            invoke = () => { steer.call(context,body,a,b,c);return undefined; };
          }
        }
        break;
      }
      case 'grass': {
        const owner = owners.grass, x = operation.values[0], z = operation.values[1];
        if (owner === undefined || typeof owner.grassHeightAt !== 'function' || x === undefined || z === undefined)
          throw new Error('Missing native grass owner');
        const sample = owner.grassHeightAt;
        pins.push(() => owners.grass === owner && owner.grassHeightAt === sample);
        invoke = () => sample.call(owner, x, z);
        break;
      }
      case 'normal': {
        const owner = owners.ground, x = operation.values[0], z = operation.values[1];
        if (owner === undefined || typeof owner.normalY !== 'function' || x === undefined || z === undefined)
          throw new Error('Missing native ground owner');
        const sample = owner.normalY;
        pins.push(() => owners.ground === owner && owner.normalY === sample);
        invoke = () => {
          const result = sample.call(owner, x, z);
          if (result < -1 || result > 1) throw new Error('Invalid native ground normal');
          return result;
        };
        break;
      }
      case 'nearest': {
        const owner = owners.rosters, roster = owner?.get(request.roster), references = owners.references;
        const x = operation.values[0], z = operation.values[1], radius = operation.values[2];
        if (owner === undefined || roster === undefined || references === undefined || owner.size > 64
          || roster.length > 1024 || references.length > 1024 || x === undefined || z === undefined || radius === undefined || radius < 0)
          throw new Error('Missing or invalid native nearest roster');
        const borrowed = roster.map(row => {
          if (!references.some(reference => sameReference(reference,row))) throw new Error('Foreign native nearest reference');
          return Object.freeze({...row});
        });
        if (new Set(borrowed.map(row => row.handle)).size !== borrowed.length) throw new Error('Duplicate native nearest reference');
        const valid = (): boolean => owners.rosters === owner && owner.get(request.roster) === roster
          && owners.references === references && roster.length === borrowed.length
          && borrowed.every((row,index) => sameReference(roster[index],row) && references.some(reference => sameReference(reference,row))
            && [row.body.position.x,row.body.position.z].every(Number.isFinite));
        if (!valid()) throw new Error('Invalid native nearest position');
        pins.push(valid);
        invoke = () => {
          let selected = 0, distance = radius;
          for (const row of borrowed) if (row.body.alive) {
            const next = Math.hypot(row.body.position.x-x,row.body.position.z-z);
            if (next < distance) { distance = next;selected = row.handle; }
          }
          return selected;
        };
        break;
      }
      case 'visibility': case 'hearing': case 'downwind': {
        const entered = group === undefined ? undefined : prepareContext();
        const owner = group?.owner.groupPorts ?? source?.senses, context = entered ?? source?.context, body = member?.actor;
        const player = entered?.player ?? source?.senses?.player;
        if (source === undefined || owner === undefined || context === undefined || player === undefined || body === undefined || body === null
          || player !== source.player.position || !Number.isFinite(context.playerSpeed) || !Number.isFinite(source.t))
          throw new Error('Missing native group sense owner');
        const speed = context.playerSpeed, time = source.t;
        const finitePose = (): boolean => [body.position.x, body.position.z, player.x, player.y, player.z].every(Number.isFinite);
        if (!finitePose()) throw new Error('Invalid native sense position');
        pins.push(finitePose);
        pins.push(() => (group !== undefined || source.senses === owner && source.senses.player === player) && source.context === context && source.player.position === player && Object.is(context.playerSpeed, speed) && Object.is(source.t, time));
        if (request.kind === 'visibility') {
          const sample = owner.visibility;
          if (typeof sample !== 'function') throw new Error('Missing native visibility owner');
          pins.push(() => owner.visibility === sample);
          invoke = () => sample.call(owner, body.position.x, body.position.z, player, speed, time);
        } else if (request.kind === 'downwind') {
          const sample = owner.downwind;
          if (typeof sample !== 'function') throw new Error('Missing native downwind owner');
          pins.push(() => owner.downwind === sample);
          invoke = () => {
            const result = sample.call(owner, body.position.x, body.position.z, player);
            if (typeof result !== 'boolean') throw new Error('Invalid native downwind result');
            return Number(result);
          };
        } else {
          const sample = owner.hearing, radii = request.radii;
          if (typeof sample !== 'function' || radii.some(value => !Number.isFinite(value) || value < 0))
            throw new Error('Invalid native hearing owner or radii');
          const copied = [radii[0], radii[1], radii[2], radii[3]] as const;
          pins.push(() => owner.hearing === sample && radii.every((value, index) => Object.is(value, copied[index])));
          invoke = () => sample.call(owner, copied, player, speed);
        }
        break;
      }
      case 'claim': {
        const loan = owners.aggression, body = nativeActor();
        if (loan === undefined) throw new Error('Missing native aggression owner');
        const director = loan.director, take: unknown = Reflect.get(director, 'take');
        if (typeof take !== 'function') throw new Error('Invalid native aggression director');
        pins.push(() => owners.aggression === loan && loan.director === director && director.take === take);
        if (group?.kind === 'pack') {
          const context = prepareContext();
          if (!('claim' in context) || typeof context.claim !== 'function') throw new Error('Missing original native claim context');
          const ports = group.owner.groupPorts, register = ports.register, claim = context.claim;
          if (typeof register !== 'function') throw new Error('Missing original native registration');
          pins.push(() => ports.register === register && context.claim === claim);
          invoke = () => { register.call(ports,body,director);live();const result = claim.call(context,body);
            if (typeof result !== 'boolean') throw new Error('Invalid native aggression result');return Number(result); };
        } else if (loan.kind === 'events') {
          const { service, events } = loan, register: unknown = Reflect.get(service, 'register'), ask: unknown = Reflect.get(events, 'ask');
          if (typeof register !== 'function' || typeof ask !== 'function') throw new Error('Invalid native aggression owner');
          pins.push(() => loan.service === service && loan.events === events && service.register === register && events.ask === ask);
          invoke = () => {
            service.register(body, director);
            const result = events.ask('ai.claim', body);
            if (typeof result !== 'boolean') throw new Error('Invalid native aggression result');
            return Number(result);
          };
        } else {
          const tokens = loan.owners, get: unknown = Reflect.get(tokens, 'get'), set: unknown = Reflect.get(tokens, 'set');
          if (typeof get !== 'function' || typeof set !== 'function') throw new Error('Invalid native token owner');
          pins.push(() => loan.owners === tokens && tokens.get === get && tokens.set === set);
          invoke = () => {
            tokens.set(body, director);
            const result = tokens.get(body)?.take(body) ?? true;
            if (typeof result !== 'boolean') throw new Error('Invalid native token result');
            return Number(result);
          };
        }
        break;
      }
      default: throw new Error('Unknown native group result operation');
    }
    return { channel: resultChannel, member, invoke };
  });
  if(plans!==undefined){
    if(group?.kind!=='herd')throw new Error('Missing locomotion group');
    const owner=group.owner,prepare:unknown=Reflect.get(owner,'prepareDrivePlan');
    if(typeof prepare!=='function')throw new Error('Missing locomotion plan owner');
    pins.push(()=>owner.prepareDrivePlan===prepare);
    for(const[body,plan]of plans){
      if(plan.parts.size!==8)throw new Error('Incomplete locomotion plan');
      const values: number[] = [];
      for(let part=0;part<8;part++){const row=plan.parts.get(part);if(row?.length!==3)throw new Error('Incomplete locomotion plan');values.push(...row);}
      plan.publication=owner.prepareDrivePlan(body,values);const publication=plan.publication;
      before.push(()=>{publication.validate();return true;});
    }
  }
  const validate = (): void => {
    live();
    if (used) throw new Error('Native group result segment already consumed');
    if (before.some(pin => !pin())) throw new Error('Changed native group effect reference');
  };
  validate();
  return { validate, run: () => {
    validate();used = true;
    const result: GroupStepNativeResultV2[] = [];
    prepared.forEach(operation => {
      live();
      const value = operation.invoke();
      if (value === undefined) return;
      if (!Number.isFinite(value) || operation.channel === undefined) throw new Error('Non-finite native group result');
      result.push(Object.freeze({ channel: operation.channel, value, ...(operation.member === undefined ? {} : { member: operation.member }) }));
    });
    live();return Object.freeze(result);
  } };
}
