/** Reversible H4 group-bank transport. It owns no group, member, scheduler,
 * RNG or save. Reference loans are supplied afresh by the existing roster. */
import type { Scope } from '../app/scope';
import { parseGroupBankV2, groupBankWidthV2, type GroupBankReferenceV2,
  type GroupBankFieldV2, type GroupBankValueV2 } from '@wildshard/format/scriptGroupBankV2';

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Non-finite group bank value');
  return value;
}
function integer(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid group bank index');
  return value;
}
/** Capture references only from actual native roster slots, including dead
 * members. A slot is removed only by the original owner's explicit despawn. */
function references(input: readonly GroupBankReferenceV2[]): ReadonlyMap<number, GroupBankReferenceV2> {
  if (input.length > 1024) throw new Error('Group reference capacity');
  const result = new Map<number, GroupBankReferenceV2>();
  const wires = new Set<string>(), identities = new Set<string>(), slots = new Map<string,Set<number>>();
  for (const row of input) {
    integer(row.handle, 1, 0x7fffffff);
    integer(row.slot, 0, 4095);
    const groupSlots=slots.get(row.group)??new Set<number>();
    if (row.group.length === 0 || row.identity.length === 0 || row.wire.length === 0
      || result.has(row.handle) || wires.has(row.wire) || identities.has(row.identity) || groupSlots.has(row.slot))
      throw new Error('Ambiguous group reference loan');
    result.set(row.handle, Object.freeze({ group: row.group, slot: row.slot, identity: row.identity, wire: row.wire, handle: row.handle }));
    wires.add(row.wire); identities.add(row.identity); groupSlots.add(row.slot);slots.set(row.group,groupSlots);
  }
  return result;
}
function ownValues(input: Readonly<Record<string, GroupBankValueV2>>, names: readonly string[]): void {
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid group bank record');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key)))
    throw new Error('Unexpected group bank field');
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) throw new Error('Group bank accessor refused');
  }
}
function referenceWire(handle: number, row: GroupBankFieldV2, group: string,
  byHandle: ReadonlyMap<number, GroupBankReferenceV2>): string {
  const found = byHandle.get(integer(handle, 1, 0x7fffffff));
  if (found === undefined || row.kind !== 'reference' && row.kind !== 'references'
    || row.own === true && found.group !== group) throw new Error('Unresolved group reference');
  return found.wire;
}
const snapshotSlice:unknown=Reflect.get(Float64Array.prototype,'slice');
const snapshotIterator:unknown=Reflect.get(Float64Array.prototype,Symbol.iterator);
const snapshotSet:unknown=Reflect.get(Float64Array.prototype,'set');
// Native brand getters exclude shared backing without reading caller accessors.
const typedBuffer:unknown=Reflect.getOwnPropertyDescriptor(Object.getPrototypeOf(Float64Array.prototype),'buffer')?.get;
const bufferBytes:unknown=Reflect.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')?.get;
const noArguments:readonly never[]=Object.freeze([]);
function unsharedNumbers(bank:ArrayLike<number>):boolean {
  if(!ArrayBuffer.isView(bank)||Object.getPrototypeOf(bank)!==Float64Array.prototype||typeof typedBuffer!=='function'||typeof bufferBytes!=='function')return false;
  try{Reflect.apply(bufferBytes,Reflect.apply(typedBuffer,bank,noArguments),noArguments);return true;}catch{return false;}
}
interface SnapshotPair { readonly before:Float64Array; readonly next:Float64Array }
function ordinarySnapshot(value:ArrayLike<number>,method:'slice'|typeof Symbol.iterator):boolean {
  return ArrayBuffer.isView(value)&&Object.getPrototypeOf(value)===Float64Array.prototype
    &&!Object.hasOwn(value,'constructor')&&!Object.hasOwn(value,'length')&&!Object.hasOwn(value,method)
    &&Reflect.get(value,method)===(method==='slice'?snapshotSlice:snapshotIterator);
}
/** A stateless codec; fields retain their declared order. The returned record
 * fits the original owner's snapshot assembly, rather than a new envelope. */
export class GroupBankV2 {
  private readonly fields: readonly GroupBankFieldV2[];
  /** At most two inactive numeric pairs; pending publications own their pair. */
  private readonly snapshots:SnapshotPair[]=[];
  readonly width: number;
  /** Last fully checked scalar words, never a decoded/publication authority. */
  private readonly scalarWords:Float64Array|undefined;
  private scalarGroup='';
  private scalarHandles:ReadonlyMap<number,GroupBankReferenceV2>|undefined;
  private scalarBusy=false;
  /** Only immutable native backing kind is memoized; words are always reread. */
  private readonly scalarBanks=new WeakSet<ArrayLike<number>>();
  /** Numeric-only staging is lent to one synchronous update, never a candidate. */
  private updates: {offset:number;width:number;values:number[]}[] | undefined;
  private referenceLoan: {readonly group:string;
    readonly rows:readonly GroupBankReferenceV2[];readonly byHandle:ReadonlyMap<number,GroupBankReferenceV2>;readonly byWire:ReadonlyMap<string,GroupBankReferenceV2>} | undefined;
  private readonly offsets = new Map<string, {readonly row: GroupBankFieldV2; readonly offset: number;readonly plainNumber:boolean}>();
  /** Admitted offsets in field order; plain numbers still validate finite values. */
  private readonly ordered: readonly {readonly row:GroupBankFieldV2;readonly offset:number;readonly plainNumber:boolean}[];
  constructor(input: unknown) {
    this.fields = structuredClone(parseGroupBankV2(input));
    let width=0;
    for(const row of this.fields){this.offsets.set(row.name,{row,offset:width,plainNumber:row.kind==='number'&&row.integer!==true&&row.min===undefined&&row.max===undefined});width+=groupBankWidthV2(row);}
    this.width=width;this.ordered=Array.from(this.offsets.values());
    this.scalarWords=this.fields.every(row=>row.kind!=='nullable-number'&&row.kind!=='references')?new Float64Array(width):undefined;
  }
  private loan(input: readonly GroupBankReferenceV2[], group: string): {
    readonly byHandle: ReadonlyMap<number, GroupBankReferenceV2>;
    readonly byWire: ReadonlyMap<string, GroupBankReferenceV2>;
  } {
    if (group.length === 0) throw new Error('Missing group identity');
    // Only wire metadata is reusable; publication still pins this call's row objects.
    const prior=this.referenceLoan;
    if(prior?.group===group&&prior.rows.length===input.length
      &&prior.rows.every((pin,index)=>{const row=input[index];return row!==undefined&&row.group===pin.group&&row.slot===pin.slot
        &&row.identity===pin.identity&&row.wire===pin.wire&&row.handle===pin.handle;}))return prior;
    const byHandle=references(input),byWire=new Map([...byHandle.values()].map(row=>[row.wire,row]));
    const loan={group,rows:[...byHandle.values()],byHandle,byWire};this.referenceLoan=loan;return loan;
  }
  encode(input: Readonly<Record<string, GroupBankValueV2>>, group: string,
    roster: readonly GroupBankReferenceV2[]): Float64Array {
    ownValues(input, this.fields.map(row => row.name));
    const { byWire } = this.loan(roster, group), bank = new Float64Array(this.width);
    let offset = 0;
    for (const row of this.fields) {
      const value = input[row.name];
      const reference = (wire: string): number => {
        const found = byWire.get(wire);
        if (found === undefined || row.kind !== 'reference' && row.kind !== 'references'
          || row.own === true && found.group !== group) throw new Error('Unresolved group reference');
        return found.handle;
      };
      switch (row.kind) {
        case 'number':
          if (typeof value !== 'number') throw new Error('Invalid numeric group field');
          finite(value);
          if (row.integer === true && !Number.isInteger(value) || row.min !== undefined && value < row.min
            || row.max !== undefined && value > row.max) throw new Error('Group field outside bound');
          bank[offset] = value;
          break;
        case 'boolean':
          if (typeof value !== 'boolean') throw new Error('Invalid boolean group field');
          bank[offset] = Number(value);
          break;
        case 'enum': {
          if (typeof value !== 'string') throw new Error('Invalid enum group field');
          const index = row.values.indexOf(value);
          if (index === -1) throw new Error('Unknown group enum');
          bank[offset] = index;
          break;
        }
        case 'nullable-number':
          if (value !== null && typeof value !== 'number') throw new Error('Invalid nullable group field');
          bank[offset] = value === null ? 0 : 1;
          bank[offset + 1] = value === null ? 0 : finite(value);
          break;
        case 'reference':
          if (value !== null && typeof value !== 'string') throw new Error('Invalid group reference');
          bank[offset] = value === null ? 0 : reference(value);
          break;
        case 'references':
          if (!Array.isArray(value) || value.length > row.capacity || new Set(value).size !== value.length)
            throw new Error('Invalid ordered group references');
          bank[offset] = value.length;
          for (const [index, wire] of value.entries()) {
            if (typeof wire !== 'string') throw new Error('Invalid ordered group reference');
            bank[offset + index + 1] = reference(wire);
          }
          break;
        default: throw new Error('Unknown group bank field');
      }
      offset += groupBankWidthV2(row);
    }
    return bank;
  }
  /** Update only named input slots in the SAME scratch bank. All changed
   * values and reference loans validate before the first write. Omitted slots
   * keep the accepted candidate; this is not a second continuation or save. */
  update(bank: Float64Array, changes: Readonly<Record<string,GroupBankValueV2>>, group: string,
    roster: readonly GroupBankReferenceV2[]): void {
    if(bank.length!==this.width)throw new Error('Group bank width mismatch');
    const prototype:unknown=Object.getPrototypeOf(changes);
    if(prototype!==Object.prototype&&prototype!==null)throw new Error('Invalid group bank record');
    const {byWire}=this.loan(roster,group),next=this.updates??[];
    this.updates=undefined;
    let used=0;
    try {
      for(const key of Reflect.ownKeys(changes)){
        const plan=typeof key==='string'?this.offsets.get(key):undefined,descriptor=Object.getOwnPropertyDescriptor(changes,key);
        if(plan===undefined||descriptor===undefined||!Object.hasOwn(descriptor,'value'))throw new Error('Unexpected group bank field or accessor');
        const value:unknown=descriptor.value,row=plan.row;
        const entry=next[used]??={offset:0,width:0,values:[]};used++;
        entry.offset=plan.offset;
        const values=entry.values;let width=0;
        const reference=(wire:string):number=>{
          const loan=byWire.get(wire);
          if(loan===undefined||(row.kind!=='reference'&&row.kind!=='references')||row.own===true&&loan.group!==group)throw new Error('Unresolved group reference');
          return loan.handle;
        };
        switch(row.kind){
          case 'number':
            if(typeof value!=='number'||!Number.isFinite(value)||row.integer===true&&!Number.isInteger(value)
              ||row.min!==undefined&&value<row.min||row.max!==undefined&&value>row.max)throw new Error('Group field outside bound');
            values[width++]=value;break;
          case 'boolean':if(typeof value!=='boolean')throw new Error('Invalid boolean group field');values[width++]=Number(value);break;
          case 'enum':{
            const index=typeof value==='string'?row.values.indexOf(value):-1;
            if(index<0)throw new Error('Unknown group enum');values[width++]=index;break;
          }
          case 'reference':if(value!==null&&typeof value!=='string')throw new Error('Invalid group reference');values[width++]=value===null?0:reference(value);break;
          case 'nullable-number':
            if(value!==null&&typeof value!=='number')throw new Error('Invalid nullable group field');values[width++]=value===null?0:1;values[width++]=value===null?0:finite(value);break;
          case 'references':{
            if(!Array.isArray(value)||value.length>row.capacity||new Set(value).size!==value.length)throw new Error('Invalid ordered group references');
            values[width++]=value.length;
            for(const wire of value){if(typeof wire!=='string')throw new Error('Invalid ordered group reference');values[width++]=reference(wire);}
            while(width<=row.capacity)values[width++]=0;break;
          }
          default:throw new Error('Unknown group bank field');
        }
        entry.width=width;
      }
      for(let index=0;index<used;index++){
        const entry=next[index];if(entry===undefined)throw new Error('Missing group bank update');
        for(let word=0;word<entry.width;word++){
          const value=entry.values[word];if(value===undefined)throw new Error('Missing group bank update value');
          if(!Object.is(bank[entry.offset+word],value))bank[entry.offset+word]=value;
        }
      }
    } finally { this.updates=next; }
  }
  private validateScalars(bank:ArrayLike<number>,group:string,byHandle:ReadonlyMap<number,GroupBankReferenceV2>,previous:Float64Array):void {
    const known=this.scalarGroup===group&&this.scalarHandles===byHandle;
    // A failed prefix must not make any partially checked cache authoritative.
    this.scalarHandles=undefined;this.scalarBusy=true;
    try{
      for(let index=0;index<this.width;index++){
        const value=bank[index];
        if(value===undefined)throw new Error('Missing group bank value');
        if(known&&Object.is(value,previous[index]))continue;
        const plan=this.ordered[index];if(plan===undefined)throw new Error('Missing group bank read plan');
        const row=plan.row;finite(value);
        if(!plan.plainNumber)switch(row.kind){
          case 'number':
            if(row.integer===true&&!Number.isInteger(value)||row.min!==undefined&&value<row.min||row.max!==undefined&&value>row.max)throw new Error('Group field outside bound');
            break;
          case 'boolean':integer(value,0,1);break;
          case 'enum':
            if(row.values[integer(value,0,row.values.length-1)]===undefined)throw new Error('Missing group enum');
            break;
          case 'reference':if(value!==0)referenceWire(value,row,group,byHandle);break;
          case 'nullable-number':case 'references':throw new Error('Variable-width scalar read plan');
          default:throw new Error('Unknown group bank field');
        }
        previous[index]=value;
      }
      this.scalarGroup=group;this.scalarHandles=byHandle;
    }finally{this.scalarBusy=false;}
  }
  private read(bank:ArrayLike<number>,group:string,roster:readonly GroupBankReferenceV2[],result?:Record<string,GroupBankValueV2>):void {
    if(result===undefined&&this.scalarWords!==undefined&&!this.scalarBusy&&(this.scalarBanks.has(bank)||unsharedNumbers(bank))){
      if(bank.length!==this.width)throw new Error('Group bank width mismatch');
      const {byHandle}=this.loan(roster,group);this.scalarBanks.add(bank);
      this.validateScalars(bank,group,byHandle,this.scalarWords);return;
    }
    this.readFull(bank,group,roster,result);
  }
  private readFull(bank: ArrayLike<number>, group: string, roster: readonly GroupBankReferenceV2[],
    result?: Record<string,GroupBankValueV2>): void {
    if (bank.length !== this.width) throw new Error('Group bank width mismatch');
    const { byHandle } = this.loan(roster, group);
    for (const {row,offset,plainNumber} of this.ordered) {
      const value = bank[offset];
      if (value === undefined) throw new Error('Missing group bank value');
      finite(value);
      if(plainNumber){if(result!==undefined)result[row.name]=value;continue;}
      switch (row.kind) {
        case 'number':
          if (row.integer === true && !Number.isInteger(value) || row.min !== undefined && value < row.min
            || row.max !== undefined && value > row.max) throw new Error('Group field outside bound');
          if(result!==undefined) result[row.name] = value;
          break;
        case 'boolean': {
          const flag=integer(value,0,1)===1;
          if(result!==undefined)result[row.name]=flag;break;
        }
        case 'enum': {
          const selected = row.values[integer(value, 0, row.values.length - 1)];
          if (selected === undefined) throw new Error('Missing group enum');
          if(result!==undefined) result[row.name] = selected;
          break;
        }
        case 'nullable-number': {
          const number = bank[offset + 1];
          if (number === undefined) throw new Error('Missing nullable group number');
          finite(number);
          if (integer(value, 0, 1) === 0 && !Object.is(number, 0)) throw new Error('Nonzero absent group value');
          if(result!==undefined) result[row.name] = value === 0 ? null : number;
          break;
        }
        case 'reference': {
          const wire=value===0?null:referenceWire(value,row,group,byHandle);
          if(result!==undefined)result[row.name]=wire;break;
        }
        case 'references': {
          const count = integer(value, 0, row.capacity), values: string[] = [];
          for (let index = 0; index < row.capacity; index++) {
            const handle = bank[offset + index + 1];
            if (handle === undefined) throw new Error('Missing ordered group reference');
            if (index < count) values.push(referenceWire(handle,row,group,byHandle));
            else if (!Object.is(handle, 0)) throw new Error('Nonzero unused group reference');
          }
          if (new Set(values).size !== values.length) throw new Error('Duplicate ordered group reference');
          if(result!==undefined) result[row.name] = Object.freeze(values);
          break;
        }
        default: throw new Error('Unknown group bank field');
      }
    }
  }

  /** Check the same complete bank without allocating a discarded snapshot. */
  validate(bank:ArrayLike<number>,group:string,roster:readonly GroupBankReferenceV2[]):void {
    this.read(bank,group,roster);
  }
  decode(bank:ArrayLike<number>,group:string,roster:readonly GroupBankReferenceV2[]):Readonly<Record<string,GroupBankValueV2>> {
    const result:Record<string,GroupBankValueV2>={};
    this.read(bank,group,roster,result);return Object.freeze(result);
  }

  /** Validate a complete detached candidate, then borrow one publication into
   * the original bank. A caller composes validate with its native effects/RNG
   * transaction before accept; no operation here steps an actor or a clock. */
  prepare(bank: Float64Array, candidate: ArrayLike<number>, group: string,
    roster: readonly GroupBankReferenceV2[], scope: Scope): {
      readonly values: Readonly<Record<string, GroupBankValueV2>>;
      readonly validate: () => void;
      readonly accept: () => void;
      /** Retire an unconsumed publication without writing its original bank. */
      readonly discard: () => void;
    } {
    if (candidate.length !== this.width || bank.length !== this.width || scope.disposed || scope.disposing) throw new Error('Retired group bank owner');
    this.validate(bank, group, roster);
    const pair=ordinarySnapshot(bank,'slice')&&ordinarySnapshot(candidate,Symbol.iterator)
      ? this.snapshots.pop()??{before:new Float64Array(this.width),next:new Float64Array(this.width)}:undefined;
    let released=false,exposed=false,active=0;
    const release=():void=>{
      if(pair===undefined||released||exposed||active!==0)return;
      released=true;if(this.snapshots.length<2)this.snapshots.push(pair);
    };
    try {
      const before=pair?.before??bank.slice(),next=pair?.next??Float64Array.from(candidate);
      if(pair!==undefined){before.set(bank);next.set(candidate);}
      const values = this.decode(next, group, roster);
      const pins = roster.map(row => ({ source: row, group: row.group, slot: row.slot,
        identity: row.identity, wire: row.wire, handle: row.handle }));
      let accepted = false;
      const validate = (): void => {
        active++;
        try {
        if (accepted || scope.disposed || scope.disposing) throw new Error('Retired group bank preparation');
        if (bank.length !== before.length) throw new Error('Changed group bank owner');
        for (let index = 0; index < before.length; index++) {
          if (!Object.is(before[index], bank[index])) throw new Error('Changed group bank owner');
        }
        if (roster.length !== pins.length) throw new Error('Changed group reference loan');
        for (let index = 0; index < pins.length; index++) {
          const pin = pins[index], row = roster[index];
          if (pin === undefined || row !== pin.source || row.group !== pin.group || row.slot !== pin.slot
            || row.identity !== pin.identity || row.wire !== pin.wire || row.handle !== pin.handle)
            throw new Error('Changed group reference loan');
        }
        } finally {active--;if(accepted)release();}
      };
      return { values, validate, discard:()=>{if(!accepted){accepted=true;release();}}, accept: () => {
        active++;
        try {
        validate();
        const write:unknown=Reflect.get(bank,'set');
        if(typeof write!=='function')throw new TypeError('Group bank setter is not callable');
        // An overridden setter may retain its argument, even when it throws.
        exposed||=write!==snapshotSet;Reflect.apply(write,bank,[next]);accepted=true;
        } finally {active--;if(accepted)release();}
      } };
    } catch(error) { release();throw error; }
  }
}
