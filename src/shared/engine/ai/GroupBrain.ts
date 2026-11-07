import {prepareGroupNativeV2,settledGroupSlots,type GroupStepV2,type GroupStepNativeOwnersV2,type GroupStepNativeResultV2} from '../script/groupStepV2';
import type {AnimalSim} from '../entities/AnimalSim';
import type {V2ColumnOwners} from '../script/observationColumnsV2';
import type {GroupStepRowsV2} from '@wildshard/format/scriptGroupStepV2';
import type {GroupBankValueV2} from '@wildshard/format/scriptGroupBankV2';
import { AggressionDirector } from './director';
import { emitFault } from '../core/faults';
import * as v from 'valibot';

const groupState = v.strictObject({
  members: v.array(v.string()), time: v.nullable(v.pipe(v.number(), v.finite())),
  directors: v.array(v.strictObject({ cap: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(128)), held: v.array(v.string()) })),
});

type ReadonlyTree<T> = T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T;
export type GroupGuestBindingsV2 = ReadonlyTree<GroupStepRowsV2>;
export interface GroupGuestProjectionV2 {
 readonly groupBindings?:GroupGuestBindingsV2;
 readonly prepareGroup:(input:Parameters<GroupStepV2['prepare']>[0])=>ReturnType<GroupStepV2['prepare']>;
}
export interface GroupGuestFrameV2<A extends AnimalSim = AnimalSim> {
 readonly input:Omit<Parameters<GroupStepV2['prepare']>[0],'members'> & {readonly members:readonly V2ColumnOwners<A>[]};
 readonly native:GroupStepNativeOwnersV2<A>;
 readonly resume:{readonly field:string;readonly values:readonly number[];readonly segments:number};
}
export interface GroupGuestPublicationV2 {
 /** Pure validation of the original codec, roster and scalar publication. */
 readonly validate:()=>void;
 /** Only assignments to the original owner's fields; no hooks/RNG/effects. */
 readonly commit:()=>void;
}

export interface GroupMember { readonly alive: boolean }
interface FixedGuestResume {readonly states:readonly number[];readonly allowed:ReadonlySet<number>}
/** Shared roster, blackboard and decision clock. Authored goals remain in the owning content. */
export class GroupBrain<A extends GroupMember> {
  readonly tickClass = 'ai';
  readonly members: A[];
  readonly blackboard: Map<string, unknown> = new Map<string, unknown>();
  private readonly guestResumes=new WeakMap<object,FixedGuestResume>();
  private reportedGuestFrame=false;
  protected groupTime: typeof Infinity = -Infinity;
  private directors: Map<number, AggressionDirector<A>> | undefined;
  constructor(members: A[]) { this.members = members; }
  /** Member callbacks may arrive together; the group makes one decision per simulation instant. */
  protected groupDelta(time: number, dt: number): number {
    if (Math.abs(time - this.groupTime) < 1e-8) return 0;
    this.groupTime = time;
    return dt;
  }
  /** Dynamic mounted/bold caps reuse the same finite director without another random roll. */
  protected groupDirector(cap: number, attacking: (actor: A) => boolean): AggressionDirector<A> {
    this.directors ??= new Map();
    let director = this.directors.get(cap);
    if (director === undefined) { director = new AggressionDirector<A>(cap); this.directors.set(cap, director); }
    director.sweep(attacking);
    for (const member of this.members) if (member.alive && attacking(member)) director.take(member);
    return director;
  }
  /** Lend the original per-cap token pool at a native group apply slot.
   * The guest supplies attacking member identities; no attack law is inferred. */
  borrowGroupDirector(cap: number, attacking: readonly A[]): AggressionDirector<A> {
    if (!Number.isInteger(cap) || cap < 0 || cap > 128 || new Set(attacking).size !== attacking.length
      || attacking.some(actor => !this.members.includes(actor))) throw new Error('Invalid native group token loan');
    return this.groupDirector(cap, actor => actor.alive && attacking.includes(actor));
  }
  /** Snapshot the shared decision clock and token pools using stable member ids; actor state is owned separately. */
  protected snapshotGroup(identity: (actor: A) => string): string {
    return JSON.stringify({ members: this.members.map(identity), time: this.groupTime === -Infinity ? null : this.groupTime,
      directors: [...(this.directors ?? [])].sort(([a], [b]) => a - b).map(([cap, director]) => ({ cap,
        held: this.members.filter(actor => director.holds(actor)).map(identity) })) });
  }
  /** Validate the complete roster and token pools before replacing group continuation; no decisions or RNG run. */
  protected restoreGroup(saved: string, identity: (actor: A) => string): void {
    const data = v.parse(groupState, JSON.parse(saved)), ids = this.members.map(identity), actors = new Map(this.members.map(actor => [identity(actor), actor]));
    if (actors.size !== this.members.length || JSON.stringify(data.members) !== JSON.stringify(ids)
      || new Set(data.directors.map(row => row.cap)).size !== data.directors.length) throw new Error('Incompatible group continuation');
    const directors = new Map<number, AggressionDirector<A>>();
    for (const row of data.directors) {
      if (new Set(row.held).size !== row.held.length || row.held.length > row.cap) throw new Error('Invalid group token continuation');
      const director = new AggressionDirector<A>(row.cap);
      for (const id of row.held) { const actor = actors.get(id); if (actor === undefined) throw new Error('Unresolved group member'); director.take(actor); }
      directors.set(row.cap, director);
    }
    this.groupTime = data.time ?? -Infinity; this.directors = directors;
  }
  /** Internal native subclasses capture current original owners at every barrier. */
  protected captureGuest(_replies:readonly GroupStepNativeResultV2[],_settled?:{readonly after:object;readonly touched:readonly number[]}):GroupGuestFrameV2<A & AnimalSim> { throw new Error('Missing native group guest capture'); }
  /** Validate the original codec before RNG acceptance; commit performs only scalar/role publication. */
  protected prepareGuestCommit(_frame:GroupGuestFrameV2<A & AnimalSim>,_values:Readonly<Record<string,GroupBankValueV2>>):GroupGuestPublicationV2 { throw new Error('Missing native group guest publication'); }
  /** A frame failure is handled, never a request to fall through to another
   * controller. Keep accepted native effects; direct/init callers stay strict. */
  protected skipGuestFrame(error:unknown):void {
    if(!this.reportedGuestFrame){this.reportedGuestFrame=true;emitFault({system:'ai.group',error,verdict:'retry'});}
  }
 /** Only fully frozen data rows can omit repeated continuation-table scans. */
 private fixedGuestResume(resume:GroupGuestFrameV2['resume'],states:readonly number[]):FixedGuestResume|undefined{
  if(!Object.isFrozen(resume))return undefined;
  const fields=Object.getOwnPropertyDescriptors(resume),field=fields.field,segments=fields.segments,values=fields.values;
  if(field===undefined||segments===undefined||values===undefined||!Object.hasOwn(field,'value')
   ||!Object.hasOwn(segments,'value')||!Object.hasOwn(values,'value'))return undefined;
  const source:unknown=values.value;
  if(!Array.isArray(source)||!Object.isFrozen(source)||source.length!==states.length)return undefined;
  const copy:number[]=[];
  for(let i=0;i<states.length;i++){
   const value=Object.getOwnPropertyDescriptor(source,i),number:unknown=value?.value;
   if(value===undefined||!Object.hasOwn(value,'value')||typeof number!=='number'||!Object.is(number,states[i]))return undefined;
   copy.push(number);
  }
  const fixed:FixedGuestResume={states:copy,allowed:new Set(copy)};this.guestResumes.set(resume,fixed);return fixed;
 }
 /** Run one original method across synchronous native barriers. Every segment
   * captures fresh original owners. State and RNG accept before ordered native
   * effects, so a native exception retains the original accepted prefix; no
   * rollback or replay is introduced around native side effects. */
 protected runGuest(program:GroupGuestProjectionV2):void {
  const prepare=program.prepareGroup;
  let frame=this.captureGuest([]);
  const resume=frame.resume,scope=frame.input.members[0]?.scope;
  let fixed=this.guestResumes.get(resume);
  const field=resume.field,segments=resume.segments,states=fixed?.states??resume.values.slice();
  const original=frame.input,{group,handle,profile,signal,tick,random,contextRandom,state}=original;
  if(scope===undefined||scope!==frame.native.scope||!Number.isInteger(resume.segments)||resume.segments<1||resume.segments>512
   ||fixed===undefined&&(resume.values.length===0||resume.values.length>512||!resume.values.includes(0)
   ||new Set(resume.values).size!==resume.values.length||resume.values.some(value=>!Number.isSafeInteger(value)||value<0)))throw new Error('Invalid group guest continuation');
  fixed??=this.fixedGuestResume(resume,states);
  for(let segment=0;segment<segments;segment++){
   if(scope.disposed||scope.disposing||program.prepareGroup!==prepare||frame.resume!==resume||frame.native.scope!==scope
    ||resume.field!==field||resume.segments!==segments||fixed===undefined&&(resume.values.length!==states.length||resume.values.some((value,index)=>value!==states[index]))
    ||frame.input.group!==group||frame.input.handle!==handle||frame.input.profile!==profile||frame.input.signal!==signal||frame.input.tick!==tick
    ||frame.input.random!==random||frame.input.contextRandom!==contextRandom||frame.input.state!==state
    ||frame.input.members.some(member=>member.scope!==scope))throw new Error('Replaced group guest owner');
   const prepared=prepare.call(program,frame.input);
   try {
   // The original codec validates the already-decoded candidate before
   // either borrowed RNG accepts its next state.
   const values=prepared.values;
   const pc=values[field];
   if(typeof pc!=='number'||!(fixed===undefined?states.includes(pc):fixed.allowed.has(pc)))throw new Error('Undeclared group guest continuation');
   const publication=this.prepareGuestCommit(frame,values),native=prepareGroupNativeV2(prepared.operations,frame.native);
   // `accept` opens with the candidate's own validate.
   publication.validate();native.validate();
   prepared.accept();publication.commit();
   const replies=native.run();
   if(pc===0)return;
   const touched=settledGroupSlots(prepared.operations);
   frame=this.captureGuest(replies,touched===undefined?undefined:{after:prepared,touched});
   }finally{prepared.discard();}
  }
  throw new Error('Group guest continuation exceeded its declared bound');
 }
}
