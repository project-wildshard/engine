import {Vector3} from 'three';
import * as v from 'valibot';
import {ProjectedState,type ReturnProgram,type ProjectedSnapshot} from '../population/returnProgram';
import type {EncounterSlotsRows,SlotViewRows} from '@wildshard/format/encounterRows';

/** The original slot owner's live bodies, allocation authority and tells. */
export interface SlotActor {
  readonly entityId:string;readonly position:{readonly x:number;readonly y:number;readonly z:number};
  readonly mem:Record<string,number>;readonly alive:boolean;readonly hidden:boolean;herd:number;
  readonly scale:number;yOffset:number;readonly yaw:number;readonly hp:number;readonly attackPhase:number;
}
export interface SlotTell {hide:()=>void;wedge:(x:number,z:number,yaw:number,reach:number,fill:number,alpha:number)=>void}
export interface SlotActorRoster<A extends SlotActor> {
  readonly factory:{model:(kind:string,variant:string)=>unknown};
  readonly spawn:(kind:string,x:number,z:number,yaw:number,variant:string)=>A;
  readonly retire:(actor:A)=>void;
}
export interface SlotSiteChange {readonly index:number;readonly awake:number}
/** Complete slot ownership. Body and random states remain their real owners'. */
export interface SlotContinuation {
  readonly version:1;readonly recipe:string;readonly cycle:ProjectedSnapshot;
  readonly retired:readonly number[];readonly changes:readonly SlotSiteChange[];readonly trailT:number;
  readonly awake:readonly {readonly id:string;readonly site:number;readonly lastHp:number;readonly wedge:number;readonly law:ProjectedSnapshot}[];
}
const finite=v.pipe(v.number(),v.finite()),natural=v.pipe(finite,v.integer(),v.minValue(0));
const projection=v.strictObject({state:v.record(v.string(),finite),elapsed:v.pipe(finite,v.minValue(0))});
const continuation=v.strictObject({version:v.literal(1),recipe:v.pipe(v.string(),v.maxLength(1_000_000)),cycle:projection,
  retired:v.pipe(v.array(natural),v.maxLength(256)),changes:v.pipe(v.array(v.strictObject({index:natural,awake:v.picklist([0,1])})),v.maxLength(1024)),
  trailT:v.pipe(finite,v.minValue(0)),awake:v.pipe(v.array(v.strictObject({id:v.pipe(v.string(),v.minLength(1),v.maxLength(512)),
    site:natural,lastHp:finite,wedge:natural,law:projection})),v.maxLength(8))});
interface Awake<A, Tell> { readonly a: A; readonly site: number; readonly law:ProjectedState; lastHp: number; readonly wedge: Tell }
const point = new Vector3(), UP = new Vector3(0, 1, 0);
/** How many sites one `slots.awake.<n>` row carries: a row is an f32, exact to here. */
const SITES_PER_ROW = 24;
/** The rows that say which sites stand empty: a server writes them and a page reads them. */
export function slotAwakeRows(count:number):{
  readonly read:(awake:readonly boolean[])=>readonly {readonly name:string;value:number}[];
  readonly awake:(row:(name:string)=>number|undefined,out:boolean[])=>void;
  readonly heard:(row:(name:string)=>number|undefined)=>boolean;
} {
  const rows=Array.from({length:Math.ceil(count/SITES_PER_ROW)},(_,index)=>({name:`slots.awake.${String(index)}`,value:0}));
  return {read:awake=>{for(const [index,row]of rows.entries()){let word=0;for(let bit=0;bit<SITES_PER_ROW;bit++)if(awake[index*SITES_PER_ROW+bit]===true)word+=2**bit;row.value=word;}return rows;},
    awake:(row,out)=>{for(const [index,{name}]of rows.entries()){const word=row(name)??0;for(let bit=0;bit<SITES_PER_ROW&&index*SITES_PER_ROW+bit<count;bit++)out[index*SITES_PER_ROW+bit]=Math.floor(word/2**bit)%2===1;}},
    heard:row=>rows.some(({name})=>row(name)!==undefined)};
}

/** A slot encounter keeps one native body roster; existing AS owns its cycle and members; the
 * sites' own show and hide is the caller's, from the changes `update` returns. */
export class SlotEncounterLaw<A extends SlotActor, Tell extends SlotTell> {
  private readonly cycle:ProjectedState;
  private readonly retired:number[]=[];
  private roster:SlotActorRoster<A>|null=null;
  readonly awake: Awake<A, Tell>[] = [];
  private readonly changes: SlotSiteChange[] = [];
  private readonly rows: SlotViewRows;
  private readonly wedges: readonly Tell[];
  private readonly identity:string;
  private trailT = 0;
  constructor(private readonly slots:EncounterSlotsRows, view: SlotViewRows, private readonly program:ReturnProgram, private readonly ports: {
    readonly cues:{cue:(id:string,point:Vector3,normal:Vector3)=>void};
    readonly sites:readonly {readonly x:number;readonly z:number;readonly yaw:number;readonly variant:number}[]|null;
    readonly guest:ReturnProgram;readonly wedges:readonly Tell[];
    readonly ground:(x:number,z:number)=>number;readonly cosmetic:()=>number;
  }) {
    this.cycle=new ProjectedState({...slots.cycle,signals:{step:slots.cycle.signal}},program);this.rows=view;
    this.wedges=ports.wedges;
    this.identity=JSON.stringify({slots,view,sites:ports.sites},(_key,value:unknown):unknown=>
      typeof value==='number'&&Object.is(value,-0)?{'slot.number':'-0'}:value);
  }
  /** Detach all lifecycle fields without sampling, projecting or drawing RNG. */
  snapshot(identify:(actor:A)=>string):SlotContinuation {
    return {version:1,recipe:this.identity,cycle:this.cycle.snapshot(),retired:[...this.retired],
      changes:this.changes.map(change=>({...change})),trailT:this.trailT,
      awake:this.awake.map(member=>({id:identify(member.a),site:member.site,lastHp:member.lastHp,
        wedge:this.wedges.indexOf(member.wedge),law:member.law.snapshot()}))};
  }
  /** Resolve only the existing native roster; no wake, retirement, cue, tell,
   * factory allocation, guest call or entropy occurs during adoption. */
  restore(input:unknown,find:(id:string)=>A|null):void {
    const saved=v.parse(continuation,input),sites=this.ports.sites;
    if(saved.recipe!==this.identity||saved.awake.length>0&&(this.roster===null||sites===null)
      ||saved.awake.some(member=>member.site>=(sites?.length??0)||member.wedge>=this.wedges.length)
      ||saved.retired.some(index=>index>=(sites?.length??0))||saved.changes.some(change=>change.index>=(sites?.length??0))
      ||new Set(saved.awake.map(member=>member.id)).size!==saved.awake.length
      ||new Set(saved.awake.map(member=>member.site)).size!==saved.awake.length)
      throw new Error('Incompatible slot continuation');
    const cycle=new ProjectedState({...this.slots.cycle,signals:{step:this.slots.cycle.signal}},this.program);cycle.restore(saved.cycle);
    const awake=saved.awake.map(member=>{
      const a=find(member.id),wedge=this.wedges[member.wedge];if(a===null||wedge===undefined)throw new Error('Missing slot body or tell');
      const law=new ProjectedState(this.slots.member,this.program);law.restore(member.law);
      return {a,site:member.site,lastHp:member.lastHp,wedge,law};
    });
    if(new Set(awake.map(member=>member.a)).size!==awake.length)throw new Error('Aliased slot body');
    this.cycle.restore(cycle.snapshot());this.awake.splice(0,this.awake.length,...awake);
    this.retired.splice(0,this.retired.length,...saved.retired);this.changes.splice(0,this.changes.length,...saved.changes);this.trailT=saved.trailT;
  }
  attachActors(roster:SlotActorRoster<A>):void {
    const rows=this.slots.actors;if(rows===undefined)throw new Error('Missing slot actor rows');
    for(const variant of new Set([rows.variant,...Object.values(rows.variants)]))roster.factory.model(rows.kind,variant);
    this.roster=roster;
  }
  /** Wake the chosen sites (the cycle's own choice when `which` is omitted); the changes until the next `update`. */
  wake(which?: readonly number[]): readonly SlotSiteChange[] {
    const sites=this.ports.sites,rows=this.slots.actors,roster=this.roster;if(sites===null||rows===undefined||roster===null)return this.changes;
    const selected=new Set<number>();
    if(which!==undefined)for(const index of which)selected.add(index);
    else for(let slot=0;slot<this.slots.select.count;slot++){
      const out=this.program.project(this.slots.select.signal,{...this.cycle.state,count:sites.length,night:this.cycle.state['t']??0,slot}),index=out['index'];
      if(index!==undefined){if(!Number.isSafeInteger(index)||index<0)throw new Error('Invalid encounter slot selection');selected.add(index);}
    }
    for(const index of selected){
      if(this.awake.length>=8||this.awake.some(row=>row.site===index))continue;
      const site=sites[index],wedge=this.wedges[this.awake.length%this.wedges.length];if(site===undefined||wedge===undefined)continue;
      const yaw=site.yaw+rows.yaw,a=roster.spawn(rows.kind,site.x,site.z,yaw,rows.variants[String(site.variant)]??rows.variant);
      a.herd=rows.herd;Object.assign(a.mem,rows.memory);a.mem[rows.home.x]=site.x;a.mem[rows.home.z]=site.z;a.mem[rows.home.yaw]=yaw;a.yOffset=rows.sink*a.scale;
      this.changes.push({index,awake:1});this.awake.push({a,site:index,lastHp:a.hp,wedge,law:new ProjectedState(this.slots.member,this.program)});
      this.ports.cues.cue(this.rows.cues.wake, point.set(site.x, this.ports.ground(site.x, site.z) + this.rows.lift.wake, site.z), UP);
    }
    return this.changes;
  }
  /** Send every actor home; a site whose actor is already gone stands again. */
  dawn():readonly SlotSiteChange[]{
    const rows=this.slots.actors;if(rows===undefined)throw new Error('Missing slot actor rows');
    for(const {a,site}of this.awake){if(a.alive)a.mem[rows.dawn]=1;else if(a.hidden)this.changes.push({index:site,awake:0});}return this.changes;
  }
  private retire(index:number,delayed:boolean):void {
    const member=this.awake[index];if(member===undefined)return;
    this.roster?.retire(member.a);if(delayed)this.retired.push(member.site);this.awake.splice(index,1);
  }
  /** Step the roster and draw it; the sites to hide or show since the last call. */
  update(dt: number, frame: Readonly<Record<string, number>>): readonly SlotSiteChange[] {
    this.changes.length = 0;
    const rows=this.rows,cues=this.ports.cues,actors=this.slots.actors;if(actors===undefined)throw new Error('Missing slot actor rows');
    const step=this.cycle.step(this.roster===null?0:dt,frame),members=new Map<Awake<A, Tell>,Readonly<Record<string,number>>>();
    if(step.dt>0)for(const member of this.awake)members.set(member,member.law.project({dt:step.dt,alive:Number(member.a.alive),gone:member.a.mem[actors.gone]??0}));
    if(step.values[rows.cycle.wake]===1)this.wake();
    if(step.values[rows.cycle.dawn]===1)this.dawn();
    if(step.values[this.slots.release]===1){for(const index of this.retired)this.changes.push({index,awake:0});this.retired.length=0;}
    this.trailT += dt; const trail = this.trailT > rows.every; if (trail) this.trailT = 0;
    for (let i = this.awake.length - 1; i >= 0; i--) {
      const w = this.awake[i]; if (w === undefined) continue;
      const a = w.a, sc = a.scale, state = members.get(w) ?? {};
      if (a.hp < w.lastHp) {
        point.set(a.position.x, a.position.y + rows.lift.hit * sc, a.position.z);
        const weak=this.ports.guest.project('weakPoint',{x:a.position.x,ay:a.position.y,z:a.position.z,cos:Math.cos(-a.yaw),sin:Math.sin(-a.yaw),scale:a.scale,yOffset:a.yOffset,hitX:point.x,hitY:point.y,hitZ:point.z})['weakPoint']===1;
        cues.cue(weak ? rows.cues.weak : a.hp < w.lastHp - rows.cues.hard.drop ? rows.cues.hard.cue : rows.cues.hit, point, UP);
        w.lastHp = a.hp;
      }
      if (!a.alive) {
        w.wedge.hide();
        if (state[rows.states.broken] === 1) cues.cue(rows.cues.broken, point.set(a.position.x, a.position.y + rows.lift.broken * sc, a.position.z), UP);
        if (state[rows.states.retire] === 1) { this.retire(i,true); }
        continue;
      }
      if (state[rows.states.home] === 1) { this.retire(i,false); this.changes.push({ index: w.site, awake: 0 }); continue; }
      if (trail) for (const row of rows.trails) {
        const value = a.mem[row.field] ?? 0;
        if (value < row.min || value >= row.max || (row.chance < 1 && this.ports.cosmetic() >= row.chance)) continue;
        cues.cue(row.cue, point.set(a.position.x, row.at === 'ground' ? this.ports.ground(a.position.x, a.position.z) + row.lift : a.position.y + row.lift * sc, a.position.z), UP);
      }
      const p = a.attackPhase, tell = rows.tell, reach = tell.reach * sc;
      if (p < 0) { w.wedge.hide(); continue; }
      if (p < tell.strike + tell.hold) w.wedge.wedge(a.position.x, a.position.z, a.yaw, reach, Math.min(1, p / tell.wind), p < tell.strike ? tell.alpha[0] + tell.alpha[1] * (p / tell.wind) : tell.alpha[2]);
      else w.wedge.hide();
      if (a.mem[rows.strike.field] === 1) {
        a.mem[rows.strike.field] = 2;
        point.set(a.position.x + Math.sin(a.yaw) * reach * rows.strike.ahead, 0, a.position.z + Math.cos(a.yaw) * reach * rows.strike.ahead);
        cues.cue(rows.cues.strike, point.setY(this.ports.ground(point.x, point.z) + rows.lift.strike), UP);
      }
    }
    return this.changes;
  }
}
