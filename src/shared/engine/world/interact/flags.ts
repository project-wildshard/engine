import * as v from 'valibot';
import { saves } from '../../saves/runtime';
/**
 * Flags — the one piece of world state the interactables kit and the quests share: a set of strings, persisted per
 * level in localStorage ('ws.flags.v1'), with change listeners. Transient flags (`plate:*`, see types.ts) live in
 * memory only. The in-memory set is the truth for the session (iOS private mode throws on write).
 *
 *   const flags = new Flags(chunk.id);
 *   flags.set('talked:castaway');  flags.has('open:hold-grate');  flags.clear('lever:hold-a');
 *   flags.onChange((flag, on) => …);   test(flags, { all: ['a'], none: ['b'] })
 *   flags.reset()                      // dev: `?resetquest` — forget this level's progress
 */
import { TRANSIENT_PREFIXES, autoFlag, type InteractDef, type Cond } from './types';

const flagsSave = saves.define({ key: 'flags', scope: 'shard', version: 1, schema: v.array(v.string()), initial: () => [] as string[] });


export type FlagListener = (flag: string, on: boolean) => void;
/** How long a page's own write stands before the server's word replaces it: a round trip and a retry. */
const FLAG_ANSWER_TICKS = 120;

/** What a page's own book saved for a level, for a server that takes a player's progress over. */
export function pageSavedFlags(level: string): readonly string[] { return flagsSave.read(level); }

export class Flags {
  /** J130: told of every book made, on a page whose books follow a server. */
  static made: ((book: Flags) => void) | null = null;
  private set_ = new Set<string>();
  private listeners: FlagListener[] = [];
  private persist: boolean;
  /** A client's copy: a page's own write stands only until the server has had time to answer it, by frame tick. */
  private following: { readonly wish: (flag: string) => void; readonly held: Map<string, number>; tick: number } | null = null;
  readonly level: string;

  // no parameter property: node's type stripping (the bakers' loader) rejects them
  constructor(level: string, persist = true) {
    this.level = level;
    this.persist = persist;
    if (persist) try {
      const mine = flagsSave.read(level.replace(/^chunk:\/\/local\//u, ''));
      if (Array.isArray(mine)) for (const f of mine) if (typeof f === 'string') this.set_.add(f);
    } catch { /* fresh */ }
    Flags.made?.(this);
  }
  /** Follow a server's copy of this book. It keeps the saves; `wish` hears each write this page makes. */
  follow(wish: (flag: string) => void): void { this.persist = false; this.following = { wish, held: new Map(), tick: 0 }; }
  /** The server's flags as of frame `tick`. A page's own write stands for `FLAG_ANSWER_TICKS`, then the server's word does. */
  mirror(server: ReadonlySet<string>, tick: number): void {
    const { following } = this;
    if (following === null) return;
    following.tick = tick;
    const changed = (flag: string, on: boolean): void => {
      if (on) this.set_.add(flag); else this.set_.delete(flag);
      for (const l of this.listeners) l(flag, on);
    };
    for (const [flag, at] of following.held) if (server.has(flag) === this.set_.has(flag) || Math.abs(tick - at) > FLAG_ANSWER_TICKS) following.held.delete(flag);
    for (const flag of this.set_) if (!server.has(flag) && !following.held.has(flag)) changed(flag, false);
    for (const flag of server) if (!this.set_.has(flag) && !following.held.has(flag)) changed(flag, true);
  }

  has(flag: string): boolean { return this.set_.has(flag); }
  /** how many flags start with `prefix` */
  count(prefix: string): number { let n = 0; for (const f of this.set_) if (f.startsWith(prefix)) n++; return n; }
  get all(): string[] { return [...this.set_]; }
  /** Snapshot restore is silent: quest/listener state is restored separately, without replaying transitions. */
  restore(flags: readonly string[]): void {
    if (new Set(flags).size !== flags.length) throw new RangeError('Invalid flag snapshot');
    this.set_ = new Set(flags); this.save();
  }

  set(flag: string, on = true): void {
    if (this.set_.has(flag) === on) return;
    if (on) this.set_.add(flag); else this.set_.delete(flag);
    if (this.following !== null) { this.following.held.set(flag, this.following.tick); if (on) this.following.wish(flag); }
    if (!TRANSIENT_PREFIXES.some((p) => flag.startsWith(p))) this.save();
    for (const l of this.listeners) l(flag, on);
  }
  clear(flag: string): void { this.set(flag, false); }
  toggle(flag: string): boolean { const on = !this.has(flag); this.set(flag, on); return on; }

  onChange(fn: FlagListener): () => void {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i !== -1) this.listeners.splice(i, 1); };
  }

  /** forget everything this level remembers */
  reset(): void {
    const had = [...this.set_];
    this.set_.clear();
    this.save();
    for (const f of had) for (const l of this.listeners) l(f, false);
  }

  private save(): void {
    if (!this.persist) return;
    try {
      flagsSave.write([...this.set_].filter((f) => !TRANSIENT_PREFIXES.some((p) => f.startsWith(p))), this.level.replace(/^chunk:\/\/local\//u, ''));
    } catch { /* not persisted this session */ }
  }
}

/** a condition over the flags: every `all`, at least one `any` (when given), no `none`. An absent condition holds. */
export function test(flags: { has: (f: string) => boolean }, c: Cond | undefined): boolean {
  if (!c) return true;
  if (c.all && !c.all.every((f) => flags.has(f))) return false;
  if (c.any && c.any.length > 0 && !c.any.some((f) => flags.has(f))) return false;
  if (c.none?.some((f) => flags.has(f))) return false;
  return true;
}

/** Read bounded numeric flag grants without state writes or temporary storage.
 * Terms retain authored order; a Boolean contributes its declared numeric bit. */
export function flagValue(flags: Pick<Flags, 'has'>, terms: readonly { readonly name: string; readonly bit: number }[]): number {
  if (terms.length > 64) throw new RangeError('Too many flag value terms');
  let value = 0;
  for (const term of terms) {
    if (term.name.length === 0 || term.name.length > 128 || !Number.isSafeInteger(term.bit) || Math.abs(term.bit) > 65536) throw new Error('Invalid flag value term');
    value += Number(flags.has(term.name)) * term.bit;
  }
  return value;
}

/** Automatic row metadata plus live read-only prompt decisions. */
export interface InteractionState {
  readonly d:InteractDef;readonly auto:string|null;readonly sets:readonly string[];readonly gives:readonly string[];
  readonly contents:readonly ({readonly kind:'item';readonly id:string;readonly n:number}|{readonly kind:'flag';readonly id:string})[];
  readonly taken:string;readonly open:string;readonly lit:string;readonly used:string;readonly lever:string;readonly plate:string;
  readonly lockKey:string|null;readonly shown:()=>boolean;readonly locked:()=>string|null;
  readonly promptRadius:(animation?:number,visible?:boolean)=>number;
}
/** Read-only state shared by page and native table consumers; it owns no actions, physics or saves. */
export function bindInteractionState(d:InteractDef,flags:Pick<Flags,'has'>):InteractionState {
  if(d.id.length===0||d.id.length>128||(d.sets?.length??0)>1024||(d.kind==='chest'&&d.contents.length>1024)
    ||(d.reach!==undefined&&(!Number.isFinite(d.reach)||d.reach<0)))throw new Error('Invalid interaction state row');
  const taken=`taken:${d.id}`,open=`open:${d.id}`,lit=`lit:${d.id}`,used=`used:${d.id}`,lever=`lever:${d.id}`,plate=`plate:${d.id}`;
  const lockKey=(d.kind==='chest'||d.kind==='door')&&d.lock!==undefined?`key:${d.lock}`:null;
  const contents:readonly ({readonly kind:'item';readonly id:string;readonly n:number}|{readonly kind:'flag';readonly id:string})[]=d.kind==='chest'?d.contents.map(row=>'item' in row?{kind:'item',id:row.item,n:row.n??1}:{kind:'flag',id:'key' in row?`key:${row.key}`:row.flag}):[];
  const shown=():boolean=>!((d.kind==='key'||d.kind==='pickup')&&flags.has(taken))&&test(flags,d.showWhen);
  const locked=():string|null=>!test(flags,d.requires)?d.lockedLabel??'Locked':lockKey!==null&&!flags.has(lockKey)&&!flags.has(open)?d.lockedLabel??'Locked — it needs a key':null;
  const promptRadius=(animation=0,visible=shown()):number=>{
    if(!visible)return 0;
    let base=2.5;
    switch(d.kind){
      case 'chest':base=flags.has(open)?0:2.5;break;
      case 'door':base=animation>0.02&&d.look!=='plank'?0:d.opensWhen!==undefined&&d.lock===undefined&&d.requires===undefined?0:2.5;break;
      case 'beacon':base=flags.has(lit)?0:2.5+0.4;break;
      case 'altar':base=flags.has(used)?0:2.5+0.3;break;
      case 'bench':base=2.5+0.5;break;
      case 'lever':base=d.latch===true&&flags.has(lever)?0:2.5;break;
      case 'plate':case 'barrel':base=0;break;
      case 'key':case 'pickup':break;
      default:break;
    }
    return d.reach===undefined?base:base>0?d.reach:0;
  };
  return {d,auto:autoFlag(d),sets:d.sets??[],gives:d.kind==='key'?[`key:${d.key}`]:[],contents,
    taken,open,lit,used,lever,plate,lockKey,shown,locked,promptRadius};
}

/** Borrowed native graph, grants and physical eligibility. The caller retains reach, sight and save ownership. */
export interface InteractionTransitionPorts<Row extends InteractionState> {
  readonly commit:(id:string)=>{readonly ok:boolean};
  readonly item:(id:string,n:number)=>void;
  readonly touched?:(row:Row)=>boolean;
  readonly plate?:(row:Row,size:number)=>boolean;
  readonly touch?:'direct'|'graph';
  readonly rowLimit?:number;
  readonly flagLimit?:number;
}
/** A bounded table's ordered native transitions, with no clock, physics or continuation of its own. */
export interface InteractionTransitions<Row extends InteractionState> {
  readonly setFlags:(list:readonly string[]|undefined,on?:boolean)=>void;
  readonly interact:(row:Row)=>boolean;
  readonly latch:(row:Row)=>void;
  readonly step:(rows?:readonly Row[])=>void;
}
/** Preflight a native table before effects. Physical eligibility is lent; graph and direct pickups retain their own order. */
export function bindInteractionTransitions<Row extends InteractionState>(rows:readonly Row[],flags:Pick<Flags,'has'|'set'>,
  ports:InteractionTransitionPorts<Row>):InteractionTransitions<Row> {
  const rowLimit=ports.rowLimit??1024,flagLimit=ports.flagLimit??1024;
  if(!Number.isInteger(rowLimit)||rowLimit<1||rowLimit>1024||!Number.isInteger(flagLimit)||flagLimit<1||flagLimit>1024
    ||rows.length>rowLimit||new Set(rows.map(row=>row.d.id)).size!==rows.length)throw new Error('Invalid interaction transition table');
  const validFlags=(list:readonly string[]):boolean=>list.length<=flagLimit&&list.every(id=>id.length>0&&id.length<=256);
  for(const row of rows){
    bindInteractionState(row.d,flags);
    if(!validFlags(row.sets)||row.contents.length>rowLimit||row.contents.some(grant=>grant.id.length===0||grant.id.length>256
      ||(grant.kind==='item'&&(!Number.isSafeInteger(grant.n)||grant.n<0))))throw new Error('Invalid interaction transition grants');
    if(row.d.kind==='plate'&&ports.plate===undefined)throw new Error('Interaction plate needs its physical owner');
    if(row.d.kind==='pickup'&&row.d.touch===true&&(ports.touched===undefined||(ports.touch==='direct'&&row.d.item===undefined)))throw new Error('Interaction pickup needs its touch owner and grant');
  }
  const known=new Set(rows);
  const requireRow=(row:Row):void=>{if(!known.has(row))throw new Error('Unknown interaction transition row');};
  const setFlags=(list:readonly string[]|undefined,on=true):void=>{
    if(list===undefined)return;
    if(!validFlags(list))throw new Error('Invalid interaction transition flags');
    for(const id of list)flags.set(id,on);
  };
  const latch=(row:Row):void=>{
    requireRow(row);const d=row.d;
    if(d.kind==='door'&&d.latch===true&&d.opensWhen!==undefined&&!flags.has(row.open)&&test(flags,d.opensWhen))flags.set(row.open);
  };
  const interact=(row:Row):boolean=>{
    requireRow(row);const d=row.d;
    if(!row.shown()||row.locked()!==null||d.kind==='plate'||d.kind==='barrel')return false;
    if(d.kind==='door'){
      if(d.look==='plank'&&flags.has(row.open)){flags.set(row.open,false);return true;}
      if(row.auto!==null)flags.set(row.auto);setFlags(row.sets);
    }else if(!ports.commit(d.id).ok)return false;
    if(d.kind==='chest')for(const grant of row.contents){if(grant.kind==='item')ports.item(grant.id,grant.n);else flags.set(grant.id);}
    return true;
  };
  const step=(selected:readonly Row[]=rows):void=>{
    if(selected.length>rowLimit)throw new Error('Too many interaction transition rows');
    for(const row of selected)requireRow(row);
    for(const row of selected){
      const d=row.d;if(!row.shown())continue;
      if(d.kind==='plate'){
        const down=ports.plate?.(row,d.size);if(down===undefined)throw new Error('Missing interaction plate owner');
        if(down!==flags.has(row.plate)){flags.set(row.plate,down);setFlags(row.sets,down);}
      }else if(d.kind==='pickup'&&d.touch===true&&ports.touched?.(row)===true){
        if(ports.touch==='direct'){
          if(d.item===undefined)throw new Error('Missing interaction pickup grant');
          flags.set(row.taken);setFlags(row.sets);ports.item(d.item,1);
        }else ports.commit(d.id);
      }else if(d.kind==='door')latch(row);
    }
  };
  return {setFlags,interact,latch,step};
}
