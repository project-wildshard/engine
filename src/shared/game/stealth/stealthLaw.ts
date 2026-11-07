import type {StealthRows,StealthSources} from '@wildshard/format/stealth';
import type { Scope } from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../population/returnProgram';
import { emitFault } from '@wildshard/engine/core/faults';

// CI12: stealth's renderer-free half. The page (stealth/controller.ts) and a native host step the same sources, detection
// and crouch/shot state through this module, in the same order and with the same equations; the page keeps the HUD.

/** Admitted scalar awareness observations; animal senses retain their actual owners. */
export interface StealthThreat {x:number;z:number;awareness:number;alert:number;hunting:number}
export interface StealthObservation {grass:number;mounted:boolean;forced:boolean;threats:readonly StealthThreat[]}
type PackPhase = Extract<StealthSources['sources'][number],{kind:'packs'}>['hunting'][number];
interface StealthActor {readonly alive:boolean;readonly position:{readonly x:number;readonly z:number};readonly mem:Readonly<Record<string,number>>}
/** The live owners a sample reads, structurally: the page's wildlife and riding views, or a native host's groups. */
export interface StealthSampleOwners {
 readonly population: {readonly packs:readonly {readonly members:readonly StealthActor[];readonly awareness:number;readonly phase:PackPhase}[];
  readonly herds:readonly {readonly members:readonly StealthActor[]}[]} | null;
 readonly riding: {readonly mounted:boolean;readonly taming:{readonly view:{readonly trust:number|null}}} | null;
 readonly grass: {readonly grassStandingAt:(x:number,z:number)=>number};
}
/** Read each live exclusion once, in the original short-circuit order. */
function excludedThreat(actor:{readonly mem:Readonly<Record<string,number>>},fields:readonly string[]):boolean{
 const length=fields.length;
 for(let index=0;index<length;index++)if(index in fields&&(actor.mem[fields[index]??'undefined']??0)===1)return true;
 return false;
}
/** Gather in row/group/member order, then select the nearest threats stably.
 * Positions remain native doubles, independent of render projections. */
export function sampleStealthSources(rows:StealthSources,player:{readonly position:{readonly x:number;readonly z:number}},owners:StealthSampleOwners):StealthObservation {
 const threats:StealthThreat[]=[];
 for(const row of rows.sources){
  if(row.kind==='packs'){
   for(let i=0;i<row.groups;i++){const pack=owners.population?.packs[i];if(pack===undefined)break;
    for(let j=0;j<row.members;j++){const actor=pack.members[j];if(actor===undefined)break;if(actor.alive)threats.push({x:actor.position.x,z:actor.position.z,awareness:pack.awareness,alert:row.alert,hunting:Number(row.hunting.includes(pack.phase))});}}
  }else{
   for(let i=0;i<row.groups;i++){const herd=owners.population?.herds[i];if(herd===undefined)break;
    for(let j=0;j<row.members;j++){const actor=herd.members[j];if(actor===undefined)break;if(actor.alive&&!excludedThreat(actor,row.exclude))threats.push({x:actor.position.x,z:actor.position.z,awareness:actor.mem['aw']??0,alert:row.alert,hunting:0});}}
  }
 }
 return {grass:owners.grass.grassStandingAt(player.position.x,player.position.z),mounted:owners.riding?.mounted??false,
  forced:owners.riding!==null&&owners.riding.taming.view.trust!==null,
  threats:threats.sort((a,b)=>Math.hypot(a.x-player.position.x,a.z-player.position.z)-Math.hypot(b.x-player.position.x,b.z-player.position.z)).slice(0,rows.take)};
}
export interface StealthDetectionSnapshot {readonly state:Readonly<Record<string,number>>;readonly elapsed:number}
/** Renderer-free decision owner: rows and scalar snapshots only, with one projection at most every 100 ms. */
export class StealthDetection {
 readonly program:ReturnProgram;
 state:Readonly<Record<string,number>>={on:0,off:0,inLong:0,can:0,latched:0,cover:0,threat:0,x:0,z:0,state:0};
 private elapsed=0;
 private reportedFrame=false;
 constructor(input:unknown,owner?:Scope){this.program=ReturnProgram.page(input,owner);}
 step(dt:number,observations:Readonly<Record<string,number>>,threats:readonly StealthThreat[]):boolean{
  try{
   if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid stealth step delta');
   const elapsed=this.elapsed+dt;
   if(elapsed<.1-1e-9){this.elapsed=elapsed;return false;}
   if(threats.length>8)throw new Error('Stealth threat observation bound');
   const state=this.program.project('step',{...this.state,...observations,dt:elapsed,count:threats.length},undefined,threats.map(row=>({...row})));
   this.state=state;this.elapsed=0;return true;
  }catch(error){
   if(!this.reportedFrame){this.reportedFrame=true;emitFault({system:'stealth.detection',error,verdict:'retry'});}
   return false;
  }
 }
 /** The projected state and the pending 100 ms cadence; the fault latch stays this owner's. */
 snapshot():StealthDetectionSnapshot{return {state:{...this.state},elapsed:this.elapsed};}
 restore(saved:StealthDetectionSnapshot):void{this.state={...saved.state};this.elapsed=saved.elapsed;}
}
/** The pose a crouch step reads, sampled by its host before the step (the page from its player and input). */
export interface StealthPose {readonly sprint:boolean;readonly jump:boolean;readonly hover:boolean;readonly swimming:boolean;readonly practice:boolean;
 readonly crouching:boolean;readonly x:number;readonly z:number}
export interface StealthCrouchSnapshot {
 readonly detection:StealthDetectionSnapshot;readonly state:string;readonly cover:number;readonly threat:number;readonly inLongGrass:boolean;
 readonly canCrouch:boolean;readonly latched:boolean;readonly threatX:number;readonly threatZ:number;readonly pendingToggle:boolean;
 readonly pendingCancel:boolean;readonly toggleWas:boolean;readonly shotUntil:number;readonly t:number;readonly hinted:boolean;
 readonly observation:StealthObservation;
}
const copyObservation=(o:StealthObservation):StealthObservation=>({grass:o.grass,mounted:o.mounted,forced:o.forced,threats:o.threats.map(row=>({...row}))});
/** Crouch eligibility, the latch, the published state and the sneak shot: everything the page's controller decides
 *  apart from its panels, disc and chevron. */
export class StealthCrouch {
 readonly law:StealthDetection;
 state:string;cover=0;threat=0;inLongGrass=false;canCrouch=false;latched=false;threatX=0;threatZ=0;
 pendingToggle=false;pendingCancel=false;toggleWas=false;shotUntil=-1;t=0;hinted=false;
 observation:StealthObservation={grass:0,mounted:false,forced:false,threats:[]};
 private readonly rows:StealthRows;
 constructor(rows:StealthRows,owner?:Scope){this.rows=rows;this.law=new StealthDetection(rows.program,owner);this.state=rows.states[0]??'none';}
 /** The crouch disc. */
 press():void{this.pendingToggle=!this.pendingToggle;}
 step(dt:number,pose:StealthPose):void{
  const o=this.observation;
  this.pendingCancel ||= pose.sprint||pose.jump;
  const stepped=this.law.step(dt,{...this.rows.tuning,grass:o.grass,forced:Number(o.forced),blocked:Number(pose.hover||pose.swimming||o.mounted||pose.practice),practice:Number(pose.practice),crouched:Number(pose.crouching),px:pose.x,pz:pose.z,sprint:Number(pose.sprint),jump:Number(this.pendingCancel),toggle:Number(this.pendingToggle)},o.threats);
  if(!stepped)return;this.pendingToggle=false;this.pendingCancel=false;
  const v=this.law.state;this.inLongGrass=v['inLong']===1;this.canCrouch=v['can']===1;this.latched=v['latched']===1;
  this.cover=v['cover']??0;this.threat=v['threat']??0;this.threatX=v['x']??0;this.threatZ=v['z']??0;
  const state=this.rows.states[v['state']??0];if(state===undefined)throw new Error('Undeclared stealth state');this.state=state;
 }
 answer(request:{want:boolean;via:'toggle'|'hold'}):{allowed:boolean;latched:boolean}{
  if(request.via==='toggle'){if(request.want&&!this.toggleWas)this.pendingToggle=!this.pendingToggle;this.toggleWas=request.want;}
  return {allowed:request.via==='hold'&&this.canCrouch,latched:this.latched};
 }
 noteShot():void{this.shotUntil=this.state===this.rows.sneak.state?this.t+this.rows.sneak.seconds:-1;}
 sneakMultiplier():number{return this.t<this.shotUntil?this.rows.sneak.multiplier:1;}
 /** The host's update: its clock and the sources sampled for the next steps. */
 observe(t:number,observation:StealthObservation):void{this.t=t;this.observation=observation;}
 /** True once, the first time crouching becomes available (the one-time TALL GRASS hint). */
 takeHint():boolean{if((this.canCrouch||this.latched)&&!this.hinted){this.hinted=true;return true;}return false;}
 snapshot():StealthCrouchSnapshot{
  return {detection:this.law.snapshot(),state:this.state,cover:this.cover,threat:this.threat,inLongGrass:this.inLongGrass,canCrouch:this.canCrouch,
   latched:this.latched,threatX:this.threatX,threatZ:this.threatZ,pendingToggle:this.pendingToggle,pendingCancel:this.pendingCancel,
   toggleWas:this.toggleWas,shotUntil:this.shotUntil,t:this.t,hinted:this.hinted,observation:copyObservation(this.observation)};
 }
 restore(saved:StealthCrouchSnapshot):void{
  this.law.restore(saved.detection);this.state=saved.state;this.cover=saved.cover;this.threat=saved.threat;this.inLongGrass=saved.inLongGrass;
  this.canCrouch=saved.canCrouch;this.latched=saved.latched;this.threatX=saved.threatX;this.threatZ=saved.threatZ;this.pendingToggle=saved.pendingToggle;
  this.pendingCancel=saved.pendingCancel;this.toggleWas=saved.toggleWas;this.shotUntil=saved.shotUntil;this.t=saved.t;this.hinted=saved.hinted;
  this.observation=copyObservation(saved.observation);
 }
}
