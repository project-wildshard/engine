import * as THREE from 'three';
import * as v from 'valibot';
import type {Scope} from '@wildshard/engine/app/scope';
import {V2_ACTION_OPS,type V2ActionBinding,type V2ActionOperation,type V2ActionTarget} from '@wildshard/format/scriptActionsV2';
import {ReturnProgram} from '../population/returnProgram';
import type {PreparedProjectionV2} from '../population/returnProjectionV2';
import {prepareV2WorldActions,type PreparedV2WorldActions,type TamingActionResult,type V2WorldActionLoan} from '../shardfile/worldActionsV2';
import type {TamingHorse,TamingHerd,TamingServices,TamingObservation} from './bindingTypes';
/** Admitted dual projections and the original historical numeric defaults. */
export interface TamingPrograms {approach:unknown;breaking:unknown;riding:unknown;initial:Record<string,number>}
const finite = v.pipe(v.number(), v.finite()), herdIndex = v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(7));
const Saved = v.strictObject({ version: v.literal(3), phase: v.picklist(['wild', 'breaking', 'bonded']),
  bonded: v.nullable(v.string()), upgraded: v.boolean(), herd: v.nullable(herdIndex), stallion: v.nullable(v.string()),
  drove: v.pipe(v.array(herdIndex), v.maxLength(8)), state: v.record(v.string(), finite),
  clock: v.pipe(finite, v.minValue(0), v.maxValue(.1)), prev: v.nullable(v.tuple([finite, finite, finite])) });

type SavedTaming=v.InferOutput<typeof Saved>;
/** the action operations a taming step may emit (none on a read-only eligibility check), made once */
const WRITES:ReadonlySet<V2ActionOperation>=new Set(Object.values(V2_ACTION_OPS).filter(op=>op===23||op>=26)),READ_ONLY:ReadonlySet<V2ActionOperation>=new Set();
/** a taming key in the programme's camelCase (`zz_h_dot` -> `zzHDot`), made once per key (G639: every probe frame ran the
 *  regex over every frame and candidate key) */
const camelKeys = new Map<string, string>();
function camel(key: string): string {
  let named = camelKeys.get(key);
  if (named === undefined) { named = key.replaceAll(/_([A-Za-z0-9])/g, (_match, next: string) => next.toUpperCase()); if (camelKeys.size < 4096) camelKeys.set(key, named); }
  return named;
}
interface TamingRunWork<A> {
  readonly frame:Record<string,number>;readonly fields:{key:string;seen:boolean}[];readonly fieldIndex:Map<string,{key:string;seen:boolean}>;
  readonly actors:A[];readonly actorTargets:V2ActionTarget[];
  readonly targets:Map<number,V2ActionTarget>;readonly bindings:Map<number,V2ActionBinding>;
  readonly write:V2ActionBinding;readonly read:V2ActionBinding;targetCount:number;
}
function tamingRunWork<A>():TamingRunWork<A>{
  const targets=new Map<number,V2ActionTarget>([[1,{identity:'service',kind:'taming'}],[2,{identity:'mount',kind:'mount'}]]);
  for(let i=0;i<8;i++)targets.set(16+i,{identity:`herd:${String(i)}`,kind:'taming-herd'});
  const base={identity:'taming',handle:1,targets,maxCommands:32,bounds:{coordinate:Number.MAX_VALUE,velocity:0}};
  return {frame:{},fields:[],fieldIndex:new Map(),actors:[],actorTargets:[],targets,bindings:new Map(),write:{...base,operations:WRITES},read:{...base,operations:READ_ONLY},targetCount:0};
}
/** Native observations and historical continuation around the admitted taming
 * guest. Bodies, mounts, herds, entropy and scopes remain their actual owners. */
export class TamingSession<A extends TamingHorse,H extends TamingHerd<A>> {
  phase:'wild'|'breaking'|'bonded'='wild'; bonded:string|null=null; upgraded=false; herd:number|null=null; stallion:string|null=null;
  private clock=0; private previous:[number,number,number]|null=null; private readonly drove=new Set<number>();
  private readonly runWork:TamingRunWork<A>[]=[];
  private readonly actors=new Map<string,A>(); private state:Record<string,number>;private readonly program:ReturnProgram;private readonly project:NonNullable<ReturnProgram['prepareWorld']>;
  private readonly lenders:readonly unknown[];private readonly ear=new THREE.Vector3();private readonly direction=new THREE.Vector3();private readonly toward=new THREE.Vector3();
  private readonly visual={trust:-1,alert:0,ear:0,earOffset:0,round:-1,balance:0,danger:0,offer:0,radius:0,beaten:0,roll:0,shake:0};
  readonly interactable: { position: THREE.Vector3; radius: number; label: string; onInteract: () => void; }={position:new THREE.Vector3(0,-1e4,0),radius:0,label:'',onInteract:():void=>{this.startBreaking();}};
  readonly view:TamingObservation={trust:null,alert:0,ear:null,round:null,balance:0,danger:false,offer:false};
  onBonded?:((horse:A)=>void)|undefined;onBreaking?:((on:boolean)=>void)|undefined;
  input:{readonly held:(action:'ride.offer'|'lean.right'|'lean.left')=>boolean}|null=null;
  get companion():A|null{return this.bonded===null?null:this.actors.get(this.bonded)??null;}
  get promptHorse():A|null{return this.stallion===null?null:this.actors.get(this.stallion)??null;}
  constructor(private readonly opts:TamingServices<A,H>,readonly scope:Scope){
    this.lenders=[opts.player,opts.mount,opts.profile,opts.bond,opts.herds];this.program=ReturnProgram.page(opts.programs.approach,scope);if(this.program.prepareWorld===undefined)throw new Error('Missing taming world projection');this.project=this.program.prepareWorld;
    this.state=v.parse(v.record(v.string(),finite),{...opts.programs.initial});if(Object.keys(this.state).length>32)throw new Error('Taming state bound exceeded');
    let saved:string|null=null;try{saved=opts.bond.read();}catch{/* unavailable storage */}
    this.run('zz_init',{zz_savedBond:saved===opts.profile.bonds[0]?0:saved===opts.profile.bonds[1]?1:-1,zz_restX:opts.rest.x+opts.profile.offset[0],zz_restZ:opts.rest.z+opts.profile.offset[1],zz_restYaw:Math.atan2(opts.rest.face.x,opts.rest.face.z)});
  }
  private live():void{if(this.scope.disposed||this.scope.disposing)throw new Error('Retired taming owner');if(this.lenders.some((owner,index)=>owner!==[this.opts.player,this.opts.mount,this.opts.profile,this.opts.bond,this.opts.herds][index])||this.program.prepareWorld!==this.project)throw new Error('Changed taming projection');}
  private capture(draw:boolean):{frame:Record<string,number>;candidates:Record<string,number>[];ids:readonly (string|null)[];herds:readonly H[]} {
    this.live();const o=this.opts,p=o.player,herds=o.herds();if(herds.length>8)throw new Error('Taming herd bound exceeded');
    const ids:(string|null)[]=[];const candidates=herds.map(h=>{const a=h.stallion;ids.push(a?.entityId??null);let dot=0;
      if(a!==null){this.actors.set(a.entityId,a);a.headWorld(this.ear);p.camera.getWorldDirection(this.direction);dot=this.direction.dot(this.toward.copy(this.ear).sub(p.camera.position).normalize());}
      return {x:a?.position.x??0,y:a?.position.y??0,z:a?.position.z??0,alive:Number(a?.alive??false),[o.profile.fields.candidateUpgraded]:Number(a?.kind===o.profile.upgradeKind),
        zz_h_cx:h.cx,zz_h_cz:h.cz,zz_h_yaw:a?.yaw??0,zz_h_upgraded:Number(a?.kind===o.profile.upgradeKind),zz_h_beaten:Number(h.stallionState==='beaten'),zz_h_flee:Number(h.mode==='flee'),zz_h_trust:h.trust,zz_h_alert:h.alert,zz_h_scale:a?.scale??1,zz_h_dot:dot};});
    const x=p.position.x,y=p.position.y,z=p.position.z,wind=o.wind();
    const frame={px:x,py:y,pz:z,zz_count:herds.length,zz_crouched:Number(p.crouching),zz_windStrength:wind.strength,zz_offer:Number(this.input?.held('ride.offer')??o.hud.offer),
      zz_lean:this.input?Number(this.input.held('lean.right'))-Number(this.input.held('lean.left')):Number(p.keys.has('KeyD'))-Number(p.keys.has('KeyA'))+o.hud.lean,
      zz_moved:this.previous===null?0:Math.hypot(x-this.previous[0],z-this.previous[2]),zz_r0:draw?o.random():0,zz_r1:draw?o.random():0,zz_r2:draw?o.random():0};
    return {frame,ids,herds,candidates:candidates.map(row=>Object.assign(row,{zz_h_downwind:((x-row.x)*wind.x+(z-row.z)*wind.z)/(Math.hypot(x-row.x,z-row.z)||1)}))};
  }
  private run(initialSignal:string,initialExtra:Readonly<Record<string,number>>={},initialCapture=0,readOnly=false):Readonly<Record<string,number>> {
    const work=this.runWork.pop()??tamingRunWork<A>();
    try{return this.runWithWork(work,initialSignal,initialExtra,initialCapture,readOnly);}
    finally{work.actors.length=0;if(!this.scope.disposed&&!this.scope.disposing)this.runWork.push(work);}
  }
  private runWithWork(work:TamingRunWork<A>,initialSignal:string,initialExtra:Readonly<Record<string,number>>,initialCapture:number,readOnly:boolean):Readonly<Record<string,number>> {
    work.bindings.set(1,readOnly?work.read:work.write);
    let signal=initialSignal,capture=initialCapture;const extra={...initialExtra};this.live();let present=false,result:Readonly<Record<string,number>>={},nativeAccepted=0,adopted:string|null=null;
    let observed={frame:{} as Record<string,number>,candidates:[] as Record<string,number>[],ids:[] as readonly (string|null)[],herds:[] as readonly H[]};
    for(let step=0;step<8;step++){
      this.live();if(capture===1||capture===2)observed=this.capture(capture===2);
      if(capture===3){const a=this.promptHorse;if(a===null)throw new Error('Missing taming actor');Object.assign(extra,{zz_adoptX:a.position.x,zz_adoptZ:a.position.z,zz_adoptYaw:a.yaw});}
      const actors=work.actors;actors.length=0;for(const actor of this.actors.values())actors.push(actor);
      const id=(name:string|null):number=>name===null?0:actors.findIndex(a=>a.entityId===name)+1;
      if(actors.length>64)throw new Error('Taming owner capacity');
      // the guest's frame is built straight in its camelCase keys, in the order (and with the overwrites) of the
      // snake_case rows it was once spread from; no per-step snake object and re-keyed copy
      const frame=work.frame;for(let i=0;i<work.fields.length;i++){const field=work.fields[i];if(field!==undefined)field.seen=false;}
      const put=(key:string,value:number):void=>{
        const name=camel(key);let field=work.fieldIndex.get(name);
        if(field===undefined){field={key:name,seen:true};work.fieldIndex.set(name,field);work.fields.push(field);}else field.seen=true;
        frame[name]=value;
      },drove=[...this.drove],previous=this.previous;
      for(const [key,value] of Object.entries(observed.frame))put(key,value);
      put('zz_phase',['wild','breaking','bonded'].indexOf(this.phase));put('zz_bonded',id(this.bonded));put('zz_upgraded',Number(this.upgraded));put('zz_herd',this.herd??-1);put('zz_stallion',id(this.stallion));put('zz_clock',this.clock);
      put('zz_previous',Number(previous!==null));put('zz_prevX',previous?.[0]??0);put('zz_prevY',previous?.[1]??0);put('zz_prevZ',previous?.[2]??0);for(let i=0;i<8;i++)put(`zz_drove${String(i)}`,drove[i]??-1);
      for(const [key,value] of Object.entries(this.state))put(`zz_s_${key}`,value);for(const [key,value] of Object.entries(this.visual))put(`zz_v_${key}`,value);
      for(const [key,value] of Object.entries(this.opts.programs.initial))put(`zz_initial_${key}`,value);
      put('zz_mounted',id(this.opts.mount.horse?.entityId??null));put('zz_nativeAccepted',nativeAccepted);put('zz_adopted',id(adopted));put('zz_selectedYaw',this.promptHorse?.yaw??0);put('zz_candidateUpgraded',Number(this.promptHorse?.kind===this.opts.profile.upgradeKind));
      for(const [key,value] of Object.entries(extra))put(key,value);
      let fields=0;for(let i=0;i<work.fields.length;i++){
        const field=work.fields[i];if(field===undefined)throw new Error('Missing taming frame field');
        if(field.seen)work.fields[fields++]=field;else{delete frame[field.key];work.fieldIndex.delete(field.key);}
      }work.fields.length=fields;
      const candidates=observed.candidates.map((row,index)=>{const out:Record<string,number>={};for(const [key,value] of Object.entries(row))out[camel(key)]=value;out[camel('zz_h_actor')]=id(observed.ids[index]??null);return out;});
      for(let i=actors.length;i<work.targetCount;i++)work.targets.delete(64+i);
      // Reserve the whole range before a live identity getter can throw. The
      // next borrower must also remove targets from a partly built attempt.
      work.targetCount=actors.length;
      for(let i=0;i<actors.length;i++){
        const actor=actors[i];if(actor===undefined)throw new Error('Missing taming actor');
        const identity=actor.entityId;let target=work.actorTargets[i];
        if(target===undefined||target.identity!==identity){target={identity,kind:'taming-actor'};work.actorTargets[i]=target;}
        work.targets.set(64+i,target);
      }
      const prepared:PreparedProjectionV2=this.project(camel(signal),frame,work.bindings,candidates);
      result=prepared.values;const number=(key:string):number=>{const value=result[camel(`zz_${key}`)];if(value===undefined||!Number.isFinite(value))throw new Error('Missing taming continuation output');return value;};
      const bit=(key:string):number=>{const value=number(key);if(value!==0&&value!==1)throw new Error('Invalid taming flag');return value;};
      const nextSignal=number('next'),nextCapture=number('capture'),nextPresent=bit('present'),nextUpgrade=bit('upgrade');bit('accept');
      if(!Number.isInteger(nextCapture)||nextCapture<0||nextCapture>3)throw new Error('Invalid taming capture');
      const nextName=nextSignal===0?null:this.program.signalName(nextSignal);
      const actor=(key:string):string|null=>{const index=number(key);if(!Number.isInteger(index)||index<0||index>actors.length)throw new Error('Invalid taming actor output');return index===0?null:actors[index-1]?.entityId??null;};
      const next=this.admit({version:3,phase:['wild','breaking','bonded'][number('phase')],bonded:actor('bonded'),upgraded:bit('upgraded')===1,herd:number('herd')===-1?null:number('herd'),stallion:actor('stallion'),drove:Array.from({length:8},(_,i)=>number(`drove${String(i)}`)).filter(i=>i!==-1),state:Object.fromEntries(Object.keys(this.state).map(key=>[key,number(`s_${key}`)])),clock:number('clock'),prev:bit('previous')===0?null:[number('prevX'),number('prevY'),number('prevZ')]},actors.map(a=>a.entityId),8,this.opts.mount.horse?.entityId??null,false);
      const visual=Object.fromEntries(Object.keys(this.visual).map(key=>[key,number(`v_${key}`)]));
      for(const key of ['ear','danger','offer','beaten'])if(visual[key]!==0&&visual[key]!==1)throw new Error('Invalid taming visual flag');
      const herds=prepared.actions.some(a=>a.target.startsWith('herd:'))?this.opts.herds():[];if(observed.herds.length>0&&herds.some((herd,index)=>herd!==observed.herds[index]))throw new Error('Changed taming herd owner');
      const identity={binding:'taming',scope:this.scope},loans:V2WorldActionLoan<A,H>[]=[{...identity,target:'service',kind:'taming',owner:this.opts,services:this.opts,presentation:this},{...identity,target:'mount',kind:'mount',owner:this.opts.mount},...herds.map((h,i):V2WorldActionLoan<A,H>=>({binding:'taming',scope:this.scope,target:`herd:${String(i)}`,kind:'taming-herd',owner:h})),...actors.map((a):V2WorldActionLoan<A,H>=>({binding:'taming',scope:this.scope,target:a.entityId,kind:'taming-actor',owner:a,services:this.opts,presentation:this}))];
      const operations:PreparedV2WorldActions<A>=prepareV2WorldActions(prepared.actions,loans);operations.validate();prepared.accept();this.install(next);Object.assign(this.visual,visual);
      for(const apply of operations.operations){const value:TamingActionResult<A>|undefined=apply();if(value?.kind==='mounted')nativeAccepted=Number(value.accepted);else if(value?.kind==='adopted'){this.actors.set(value.actor.entityId,value.actor);adopted=value.actor.entityId;}else if(value?.kind==='retired')this.actors.delete(value.actor.entityId);}
      operations.validate();present ||= nextPresent===1;if(nextName===null){if(present)this.present();return result;}
      signal=nextName;capture=nextCapture;extra['zz_adoptUpgraded']=nextUpgrade;
    }
    throw new Error('Taming same-call barrier capacity');
  }
  private present():void{const a=this.promptHorse,s=this.visual,m=this.opts.mount;this.interactable.radius=s.radius;this.interactable.label=s.beaten===1?this.opts.profile.labels.breaking:this.opts.profile.labels.mount;if(a!==null)this.interactable.position.copy(a.position);
    if(s.ear===1&&a!==null){a.headWorld(this.ear);this.ear.y+=s.earOffset;}Object.assign(this.view,{trust:s.trust<0?null:s.trust,alert:s.alert,round:s.round<0?null:s.round,balance:s.balance,danger:s.danger===1,offer:s.offer===1,ear:s.ear===1?this.ear:null});m.breakRoll=s.roll;m.breakShake=s.shake;}
  update(dt:number):void{if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid taming elapsed time');this.run('zz_probe',{zz_dt:dt});}
  noteEvent(name:string,x:number,z:number):void{if(name==='pack-driven-off'||name==='pack-break')this.run('zz_event',{zz_eventX:x,zz_eventZ:z,zz_shot:0},1);}
  noteShot(x:number,z:number):void{this.run('zz_event',{zz_eventX:x,zz_eventZ:z,zz_shot:1},1);}
  canTame(a:A):boolean{return this.run('zz_eligible',{zz_candidateUpgraded:Number(a.kind===this.opts.profile.upgradeKind)},0,true)['zzAccept']===1;}
  startBreaking():void{this.run('zz_start');}forceBreak():void{this.run('zz_force');}
  snapshot():string{return JSON.stringify({version:3,phase:this.phase,bonded:this.bonded,upgraded:this.upgraded,herd:this.herd,stallion:this.stallion,drove:[...this.drove],state:this.state,clock:this.clock,prev:this.previous});}
  private install(saved:SavedTaming):void{this.phase=saved.phase;this.bonded=saved.bonded;this.upgraded=saved.upgraded;this.herd=saved.herd;this.stallion=saved.stallion;this.state=saved.state;this.clock=saved.clock;this.previous=saved.prev;this.drove.clear();saved.drove.forEach(i=>{this.drove.add(i);});}
  private admit(input:unknown,actors:readonly string[],herds:number,mounted:string|null,restoring=true):SavedTaming{
    if(actors.length>64||herds>8)throw new Error('Taming continuation bound exceeded');const saved=v.parse(Saved,input),ids=new Set(actors);
    if(ids.size!==actors.length||[saved.bonded,saved.stallion].some(id=>id!==null&&!ids.has(id))||(saved.herd!==null&&saved.herd>=herds)||saved.drove.some(i=>i>=herds)||new Set(saved.drove).size!==saved.drove.length||Object.keys(saved.state).sort().join(',')!==Object.keys(this.state).sort().join(',')
      ||Math.abs(saved.state['b']??2)>1.2||(saved.state['round']??0)<1||(saved.state['round']??7)>6||(saved.phase==='breaking'&&(saved.herd===null||saved.stallion===null||restoring&&mounted!==saved.stallion))||((saved.phase==='bonded'||saved.upgraded)&&saved.bonded===null))throw new Error('Invalid taming continuation');return saved;
  }
  restore(wire:string,horses:readonly A[]):void{this.live();if(wire.length>65536)throw new Error('Taming continuation bound exceeded');const saved=this.admit(JSON.parse(wire),horses.map(a=>a.entityId),this.opts.herds().length,this.opts.mount.horse?.entityId??null);this.install(saved);this.actors.clear();horses.forEach(a=>{this.actors.set(a.entityId,a);});Object.assign(this.visual,{round:saved.phase==='breaking'?saved.state['round']??1:-1,balance:saved.state['b']??0,radius:0});this.present();}
}
