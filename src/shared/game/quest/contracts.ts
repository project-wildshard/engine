/** Numeric projection bridge. Authored AS owns decisions; this module retains
 * admitted identities, detached rewards and the original page save envelope. */
import { parseContractCatalogue, type ContractCatalogue, type ContractReward as Reward } from '@wildshard/format/contracts';
import type { Scope } from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../population/returnProgram';

export interface Contract {
  serial:number; kind:string; target:string; need:number; have:number;
  title:string; goal:string; reward:Reward;
}
/** Durable counters and currently accepted offers; serials never rewind. */
export interface Board {next:number;slots:Contract[];claimed:number;streak:number;best:number}
export interface KillInfo {kind:string;variant?:string|undefined;rarity?:string|undefined;elite:string|null;tags:readonly string[]}
type Frame=Readonly<Record<string,number>>;
const guests=new WeakMap<ContractCatalogue,{program:ReturnProgram;ids:Map<string,number>}>();
const owners=new WeakMap<ContractCatalogue,{scope?:Scope;retired:boolean}>();
function guest(rows:ContractCatalogue):{program:ReturnProgram;ids:Map<string,number>}{
 const owner=owners.get(rows);
 if(owner?.retired===true)throw new Error('Contract owner disposed');
 let value=guests.get(rows);
 if(value===undefined){
  if(rows.program===undefined)throw new Error('Contract catalogue lacks its admitted programme');
  const strings=new Set<string>();
  const visit=(input:unknown):void=>{if(typeof input==='string')strings.add(input);else if(Array.isArray(input))input.forEach(visit);else if(typeof input==='object'&&input!==null)Object.values(input).forEach(visit);};
  visit({...rows,program:null});
  value={program:ReturnProgram.page(rows.program,owner?.scope),ids:new Map([...strings].map((name,i)=>[name,i]))};guests.set(rows,value);
 }
 return value;
}
/** Detach an entered catalogue and bind its guest to that owner's verified
 * module loan. Retained rows reject after retirement without retaining Scope. */
export function ownContractCatalogue(input:ContractCatalogue,scope:Scope):ContractCatalogue {
 if(scope.disposed||scope.disposing)throw new Error('Contract owner disposed');
 const rows=parseContractCatalogue(input),owner:{scope?:Scope;retired:boolean}={scope,retired:false};
 owners.set(rows,owner);
 try {guest(rows);}catch(error){owners.delete(rows);throw error;}
 scope.onDispose(()=>{owner.retired=true;delete owner.scope;guests.delete(rows);});
 return rows;
}
function id(rows:ContractCatalogue,value:string|undefined|null):number{return value===undefined||value===null?-1:guest(rows).ids.get(value)??-2;}
function columns(a:readonly number[]=[],b:readonly number[]=[],c:readonly number[]=[]):Record<string,number>{
 const frame:Record<string,number>={};
 for(const [prefix,values]of [['a',a],['b',b],['c',c]]as const)values.forEach((value,i)=>{frame[`${prefix}${String(i).padStart(2,'0')}`]=value;});
 return frame;
}
/** Project a bounded numeric observation without adding a timer or state owner. */
export function projectContract(rows:ContractCatalogue,signal:string,frame:Frame,candidates:readonly Frame[]=[]):Frame{
 const prefix=(values:Frame):Record<string,number>=>Object.fromEntries(Object.entries(values).map(([key,value])=>[`contract.${key}`,value]));
 return Object.fromEntries(Object.entries(guest(rows).program.project(`contract.${signal}`,prefix(frame),undefined,candidates.map(prefix))).map(([key,value])=>[key.slice(9),value]));
}
function result(frame:Frame,key:string):number{const value=frame[key];if(value===undefined)throw new Error('Missing contract projection channel');return value;}
/** Resolve observed names through the authored named-target predicates. */
export function eliteOf(rows:ContractCatalogue,kind:string,variant:string|undefined):string|null{
 const entries=Object.entries(rows.elites);
 for(let offset=0;offset<entries.length;offset+=4){
  const part=entries.slice(offset,offset+4),index=result(projectContract(rows,'elite',{kind:id(rows,kind),variant:id(rows,variant),count:part.length,...columns(part.map(([,value])=>id(rows,value.kind)),part.map(([,value])=>id(rows,value.variant)))}),'index');
  if(index>=0)return part[index]?.[0]??null;
 }
 return null;
}
/** Classify authoritative body observations; selectors and exclusions live in AS. */
export function contractKill(rows:ContractCatalogue,subject:{readonly kind:string;readonly variant?:string;readonly rarity?:string;readonly label?:string}):KillInfo{
 const frame={kind:id(rows,subject.kind),variant:id(rows,subject.variant),label:id(rows,subject.label)};
 const tags=(rows.tags??[]).filter(row=>{
  for(let offset=0;offset<row.any.length;offset+=4){const part=row.any.slice(offset,offset+4);if(result(projectContract(rows,'tag',{...frame,count:part.length,...columns(part.map(match=>id(rows,match.kind)),part.map(match=>id(rows,match.variant)),part.map(match=>id(rows,match.label)))}),'value')===1)return true;}
  return false;
 }).map(row=>row.tag);
 return {kind:subject.kind,variant:subject.variant,rarity:subject.rarity,elite:eliteOf(rows,subject.kind,subject.variant),tags};
}
/** Rebuild words and a detached payout from today's admitted identity. */
export function contractFor(rows:ContractCatalogue,serial:number,kind:string,target:string):Contract|null{
 const row=rows.rows.find(offer=>offer.kind===kind&&offer.target===target);
 return row===undefined?null:{serial,kind,target,have:0,need:row.need,title:row.title,goal:row.goal,reward:{...row.reward,items:row.reward.items.map(item=>({id:item.id,n:item.n}))}};
}
/** Draw using the AS serial stream, bounded collision retries and fallback. */
export function draw(rows:ContractCatalogue,serial:number,taken:readonly Contract[]=[]):Contract{
 const index=(kind:string,target:string):number=>rows.rows.findIndex(row=>row.kind===kind&&row.target===target),first=rows.initial[serial],fallback=index(rows.fallback.kind,rows.fallback.target);
 let salt=0,selected=-1;
 for(;;){
  for(let offset=0;offset<rows.draws.length;offset+=4){
   const part=rows.draws.slice(offset,offset+4),choice=projectContract(rows,'draw',{serial:Number.isFinite(serial)?serial:Number.MAX_VALUE,salt,first:first===undefined?-1:index(first.kind,first.target),count:part.length,...columns(part.map(row=>row.below),part.map(row=>row.targets.length))});
   selected=result(choice,'index');const bandIndex=result(choice,'band'),band=bandIndex<0?undefined:part[bandIndex],target=band?.targets[result(choice,'target')];
   if(selected<0&&band!==undefined&&target!==undefined)selected=index(band.kind,target);if(selected>=0)break;
  }
  let collision=0;
  for(let offset=0;offset<taken.length;offset+=4){const part=taken.slice(offset,offset+4);collision+=result(projectContract(rows,'collision',{candidate:selected,count:part.length,...columns(part.map(row=>index(row.kind,row.target)))}),'value');}
  const finish=projectContract(rows,'drawFinish',{candidate:selected,excluded:collision,salt,attempts:rows.attempts,fallback});
  selected=result(finish,'index');if(result(finish,'retry')===0)break;salt=result(finish,'salt');
 }
 const offer=rows.rows[selected],value=offer===undefined?null:contractFor(rows,serial,offer.kind,offer.target);
 if(value===null)throw new Error('Missing admitted contract offer');return value;
}
/** Assemble declared slots; gameplay selection is delegated to the guest. */
export function newBoard(rows:ContractCatalogue):Board{
 const slots:Contract[]=[];for(let i=0;i<rows.slots;i++)slots.push(draw(rows,i,slots));
 return {next:rows.slots,slots,claimed:0,streak:0,best:0};
}
/** Supply numeric identities/ranks to the offer's authored predicate. */
export function counts(rows:ContractCatalogue,c:Contract,k:KillInfo):boolean{
 const rule=rows.matches.find(row=>row.kind===c.kind);if(rule===undefined)return false;
 return result(projectContract(rows,'count',{match:['species','elite','tag','rarity'].indexOf(rule.match),target:id(rows,c.target),kind:id(rows,k.kind),elite:id(rows,k.elite),tagged:Number(k.tags.includes(c.target)),excluded:Number(rule.excludeTags.some(tag=>k.tags.includes(tag))),excludeElite:Number(rule.excludeElite),rank:rows.ranks[k.rarity??rows.defaultRank]??0,targetRank:rows.ranks[c.target]??0,knownRank:Number(rows.ranks[c.target]!==undefined),below:rule.belowRank??-1}),'value')===1;
}
/** Apply projected increments to every overlapping live offer. */
export function recordKill(rows:ContractCatalogue,b:Board,k:KillInfo):number[]{
 const moved:number[]=[];b.slots.forEach((c,i)=>{const next=projectContract(rows,'progress',{have:c.have,need:c.need,accepted:Number(counts(rows,c,k))});c.have=result(next,'have');if(result(next,'moved')===1)moved.push(i);});return moved;
}
export const isFilled=(c:Contract):boolean=>c.have>=c.need;
/** The existing inventory owner receives a detached projected payout. */
export function claim(rows:ContractCatalogue,b:Board,i:number):Reward|null{
 const c=b.slots[i];if(c===undefined)return null;
 let next:Frame={},milestone:ContractCatalogue['milestones'][number]|undefined;
 for(let offset=0;offset<Math.max(1,rows.milestones.length);offset+=4){const part=rows.milestones.slice(offset,offset+4);
  next=projectContract(rows,'claim',{valid:1,have:c.have,need:c.need,next:b.next,claimed:b.claimed,streak:b.streak,best:b.best,count:part.length,...columns(part.map(row=>row.claimed))});
  if(result(next,'status')===0)return null;milestone=part[result(next,'milestone')];if(milestone!==undefined)break;
 }
 if(result(next,'status')===0)return null;
 b.claimed=result(next,'claimed');b.streak=result(next,'streak');b.best=result(next,'best');
 const reward:Reward={items:c.reward.items.map(item=>({...item})),bolts:c.reward.bolts,...(c.reward.skin===undefined?{}:{skin:c.reward.skin})};
 if(milestone!==undefined)reward.skin=milestone.skin;
 const serial=b.next;b.next=result(next,'next');b.slots[i]=draw(rows,serial,b.slots.filter((_,j)=>j!==i));return reward;
}
/** Replace only the selected identity and the guest's continuation counters. */
export function reroll(rows:ContractCatalogue,b:Board,i:number):void{
 if(b.slots[i]===undefined)return;const next=projectContract(rows,'tear',{valid:1,next:b.next});
 b.streak=result(next,'streak');const serial=b.next;b.next=result(next,'next');b.slots[i]=draw(rows,serial,b.slots.filter((_,j)=>j!==i));
}
const isObj=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const num=(value:unknown,fallback:number):number=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
/** Decode the original permissive page envelope; AS normalizes its counters. */
export function loadBoard(rows:ContractCatalogue,saved:string|null):Board{
 const raw=(():unknown=>{try{return JSON.parse(saved??'null');}catch{return null;}})();
 if(!isObj(raw)||!Array.isArray(raw['slots'])||raw['slots'].length!==rows.slots)return newBoard(rows);
 const slots:Contract[]=[];
 for(const value of raw['slots']){
  if(!isObj(value))return newBoard(rows);
  const serial=num(value['serial'],0),kind=value['kind'],target=value['target'],authored=typeof kind==='string'&&typeof target==='string'?contractFor(rows,serial,kind,target):null;
  const slot=authored??draw(rows,serial,slots);slot.have=result(projectContract(rows,'loaded',{have:num(value['have'],0),need:slot.need}),'have');slots.push(slot);
 }
 let next=num(raw['next'],rows.slots);for(const slot of slots)next=result(projectContract(rows,'loadNext',{next,serial:slot.serial}),'next');
 return {next,slots,claimed:num(raw['claimed'],0),streak:num(raw['streak'],0),best:num(raw['best'],0)};
}
/** Preserve the original wire and property order; no payout enters a save. */
export function saveBoard(b:Board):string{
 return JSON.stringify({next:b.next,slots:b.slots.map(c=>({serial:c.serial,kind:c.kind,target:c.target,have:c.have})),claimed:b.claimed,streak:b.streak,best:b.best});
}
