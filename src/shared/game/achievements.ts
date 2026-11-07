/**
 * Shard achievements — each shard has its own table, each achievement pays out a TITLE (the thing that
 * would sit under your name in multiplayer; single-player only shows it on the menu's Achievements tab).
 * An achievement counts KILLS (`kind`, + `variant`) or an adventure EVENT (`event` — Driftwood's quest, sea glass,
 * the dive treasure, the vista bench: `progress.recordEvent('glass', total)`), never both.
 *
 *   achievementsFor('chunk://local/pine-hollow')   → AchievementDef[] (empty for a shard without a table)
 *
 * A kill matches an achievement when the species matches and, if the achievement names one, the variant
 * matches too (`ghost` = the Ghost stag, `ironhide` = Old Ironhide — the legendaries from src/engine/entities/species/).
 * Progress / earned state / the worn title live in src/client/game/Progress.ts.
 */
import type { IconId } from '@wildshard/engine/ui/icons';
import { emitFault } from '@wildshard/engine/core/faults';

export interface AchievementDef {
  /** unique within the shard, persisted */
  id: string;
  /** the achievement's name ("DEERSTALKER") */
  name: string;
  /** what it takes ("Kill 5 deer") */
  goal: string;
  /** kills / events needed */
  count: number;
  /** species id (`Animal.kind`) — a kill achievement */
  kind?: string;
  /** an adventure event id (Progress.recordEvent) — an event achievement */
  event?: string;
  /** VariantDef id when only one variant counts (legendaries) */
  variant?: string;
  /** the title it unlocks — the joke */
  title: string;
  icon: IconId;
}



const TABLES: Record<string, AchievementDef[]> = {};

export function achievementsFor(chunkId: string): AchievementDef[] { return TABLES[chunkId.replace(/^chunk:\/\/local\//u, '')] ?? []; }

/** A level owns its authored rows; a resident level can release only its own registration. */
export function registerAchievements(chunkId: string, defs: AchievementDef[]): () => void {
  const id = chunkId.replace(/^chunk:\/\/local\//u, '');
  const previous = TABLES[id];
  TABLES[id] = defs;
  return () => { if (TABLES[id] === defs) { if (previous) TABLES[id] = previous; else delete TABLES[id]; } };
}

/** Authored matching/count policy over the caller's existing progress storage. */
/** Bounded read-only totals submitted to the existing event or count owner. */
export interface AchievementFlagRow {
  readonly id:string;readonly method:'event'|'count';readonly onlyWhenSet?:boolean;
  readonly value:{readonly flag:string}|{readonly flags:readonly string[]}|{readonly prefix:string}|{readonly constant:0};
}
/** Borrow the live durable flags; no storage or subscription is installed. */
export interface AchievementFlagPorts { readonly has:(flag:string)=>boolean;readonly count:(prefix:string)=>number }
export interface AchievementCounterRows {
  readonly feats:readonly Pick<AchievementDef,'id'|'count'|'kind'|'event'|'variant'>[];
  readonly flags?:readonly AchievementFlagRow[];
  readonly prefix:string;readonly floorTotals:boolean;readonly validateTotals:boolean;readonly write:'before'|'after'|'each';
}
/** Actual saved counters and stable fact emission; this counter never owns persistence. */
export interface AchievementCounterPorts {
  readonly read:()=>Record<string,number>;readonly write:(counts:Record<string,number>)=>void;
  readonly emit:(fact:string,entity:string)=>void;
}
/** Shared native/page outcome surface, including replay of an old save's achieved identities. */
export interface AchievementCounters {
  readonly kill:(kind:string,variant?:string)=>void;readonly event:(event:string,total?:number)=>void;
  readonly count:(id:string,total:number)=>void;readonly replay:()=>void;
  readonly syncFlags:(flags:AchievementFlagPorts,submit?:(id:string,total:number)=>void)=>void;
}
/** Renderer-free counter book for native quest continuations. Outcomes queue
 * plain fact rows for the existing ledger owner; restoring never replays them. */
export class AchievementCounterBook {
  private counts: Record<string, number> = {};
  private facts: { readonly fact: string; readonly entity: string }[] = [];
  readonly counters: AchievementCounters;
  constructor(rows: AchievementCounterRows, initial: Readonly<Record<string, number>> = {}) {
    this.restore(initial);
    this.counters = createAchievementCounters(rows, { read: () => ({ ...this.counts }),
      write: counts => { this.counts = counts; }, emit: (fact, entity) => { this.facts.push({ fact, entity }); } });
  }
  snapshot(): Record<string, number> { return { ...this.counts }; }
  /** The containing quest validates its saved envelope before committing it. */
  restore(counts: Readonly<Record<string, number>>): void {
    if (Object.values(counts).some(count => !Number.isSafeInteger(count) || count < 0)) throw new RangeError('Invalid achievement totals');
    this.counts = { ...counts }; this.facts.length = 0;
  }
  takeFacts(): readonly { readonly fact: string; readonly entity: string }[] {
    const facts = this.facts; this.facts = []; return facts;
  }
}
/** Match bounded authored outcomes and submit only newly reached stable identities.
 * Bad runtime counts/identities report once without writes; authored rows still refuse at binding. */
export function createAchievementCounters(profile:AchievementCounterRows,ports:AchievementCounterPorts):AchievementCounters {
  let reportedCount = false, reportedIdentity = false;
  if(profile.feats.length>256||new Set(profile.feats.map(row=>row.id)).size!==profile.feats.length||profile.prefix.length>96
    ||profile.feats.some(row=>!(/^[a-z][a-z0-9-]{0,95}$/u.test(row.id))||['constructor','prototype','__proto__'].includes(row.id)||!Number.isSafeInteger(row.count)||row.count<1||row.count>4096))throw new Error('Invalid achievement counter rows');
  const flagRows=profile.flags??[];
  const valid=(flag:string):boolean=>flag.length>0&&flag.length<=256;
  if(flagRows.length>256||new Set(flagRows.map(row=>row.id)).size!==flagRows.length||flagRows.some(row=>{const constant:unknown=Reflect.get(row.value,'constant');return !valid(row.id)||!['event','count'].includes(row.method)||('flag' in row.value?!valid(row.value.flag):'flags' in row.value?row.value.flags.length>256||row.value.flags.some(flag=>!valid(flag)):'prefix' in row.value?!valid(row.value.prefix):constant!==0);}))throw new Error('Invalid achievement flag rows');
  const rows=profile.feats.map(feat=>({feat,fact:profile.prefix+feat.id,entities:Array.from({length:feat.count},(_,n)=>`${feat.id}:${String(n+1)}`)}));
  const emit=(row:typeof rows[number],first:number,total:number):void=>{
    for(let n=0;n<row.entities.length;n++){const entity=row.entities[n];if(n>=first&&n<total&&entity!==undefined)ports.emit(row.fact,entity);}
  };
  const advance=(row:typeof rows[number],state:Record<string,number>,total?:number):void=>{
    const before=state[row.feat.id]??0,requested=total??(before+1);
    const after=Math.min(row.feat.count,Math.max(before,profile.floorTotals?Math.floor(requested):requested));
    if(profile.validateTotals&&(!Number.isFinite(after)||after<0)){
      if(!reportedCount){reportedCount=true;emitFault({system:'achievement.counters',error:new RangeError('Invalid achievement count'),verdict:'retry'});}
      return;
    }
    if(before===after)return;state[row.feat.id]=after;
    if(profile.write==='each'){
      for(let n=before;n<after;n++){state[row.feat.id]=n+1;ports.write(state);const entity=row.entities[n];if(entity!==undefined)ports.emit(row.fact,entity);}
    }else{if(profile.write==='before')ports.write(state);emit(row,before,after);if(profile.write==='after')ports.write(state);}
  };
  const outcome=(kind:'kill'|'event',name:string,variant?:string,total?:number):void=>{
    const state=ports.read();
    for(const row of rows)if(kind==='kill'?row.feat.kind===name&&(row.feat.variant===undefined||row.feat.variant===variant):row.feat.event===name)advance(row,state,total);
  };
  return {kill:(kind,variant)=>{outcome('kill',kind,variant);},event:(event,total)=>{outcome('event',event,undefined,total);},
    count:(id,total)=>{const row=rows.find(entry=>entry.feat.id===id);if(row===undefined){
      if(!reportedIdentity){reportedIdentity=true;emitFault({system:'achievement.counters',error:new Error(`Unknown achievement ${id}`),verdict:'retry'});}
      return;
    }advance(row,ports.read(),total);},
    syncFlags:(flags,submit)=>{
      for(const row of flagRows){
        const value=row.value;
        const total='flag' in value?Number(flags.has(value.flag)):'flags' in value?value.flags.reduce((n,flag)=>n+Number(flags.has(flag)),0):'prefix' in value?flags.count(value.prefix):0;
        if(row.onlyWhenSet===true&&total===0)continue;
        if(submit!==undefined)submit(row.id,total);
        else if(row.method==='event')outcome('event',row.id,undefined,total);
        else {const found=rows.find(entry=>entry.feat.id===row.id);if(found===undefined)throw new Error(`Unknown achievement ${row.id}`);advance(found,ports.read(),total);}
      }
    },
    replay:()=>{const state=ports.read();for(const row of rows)emit(row,0,Math.min(row.feat.count,state[row.feat.id]??0));}};
}
