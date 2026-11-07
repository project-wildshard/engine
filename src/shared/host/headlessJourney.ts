import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '@wildshard/engine/physics/CharacterMotor';
import * as v from 'valibot';
import type { HeadlessCommand } from './tickProtocol';
import type { SimHost } from '@wildshard/engine/sim';
import { floorBelow } from '@wildshard/engine/physics/query';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { walkingSpeed } from '@wildshard/engine/player/walk';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

export interface WalkPoint { readonly x:number;readonly z:number;readonly jump?:boolean|number;readonly jumpAt?:number }
export interface WalkStall { readonly tick:number;readonly waypoint:number;readonly x:number;readonly y:number;readonly z:number }
export interface WalkStart { x:number;z:number;y?:number;yaw:number;hover?:boolean }
export interface WalkBounds { x0:number;x1:number;z0:number;z1:number;floor:number }
export interface HeadlessJourneyPlan { ticks:number;points:WalkPoint[];start?:WalkStart;once?:boolean;inside?:WalkBounds;holdActors?:boolean }
export interface HeadlessJourneyReport {
  ticks:number;preparationTicks:number;settledTicks:number;complete:boolean;out:number;distance:number;visited:number;traversals:number;stuck:WalkStall[];
  final:{tick:number;position:[number,number,number];grounded:boolean};maxTickMicros:number;
}
const finite=v.pipe(v.number(),v.finite());
const natural=v.pipe(finite,v.integer(),v.minValue(0));
/** Finite offline route data only; no callbacks, module URLs, snapshots or facts. */
export const HeadlessJourneyPlanSchema:v.GenericSchema<HeadlessJourneyPlan> = v.strictObject({
  ticks:v.pipe(natural,v.minValue(1),v.maxValue(14_400)),
  start:v.exactOptional(v.strictObject({x:finite,z:finite,y:v.exactOptional(finite),yaw:finite,hover:v.exactOptional(v.boolean())})),
  once:v.exactOptional(v.boolean()),
  holdActors:v.exactOptional(v.boolean()),
  inside:v.exactOptional(v.pipe(v.strictObject({x0:finite,x1:finite,z0:finite,z1:finite,floor:finite}),v.check(box=>box.x0<box.x1&&box.z0<box.z1,'Ordered walk bounds'))),
  points:v.pipe(v.array(v.strictObject({x:finite,z:finite,jump:v.exactOptional(v.union([v.boolean(),v.pipe(natural,v.maxValue(2))])),
    jumpAt:v.exactOptional(v.pipe(finite,v.minValue(0)))})),v.minLength(2),v.maxLength(256)),
});
/** Compact observations of actual native ticks, never a replacement continuation. */
export const HeadlessJourneyReportSchema:v.GenericSchema<HeadlessJourneyReport> = v.strictObject({
  ticks:natural,preparationTicks:natural,settledTicks:natural,complete:v.boolean(),out:natural,distance:v.pipe(finite,v.minValue(0)),visited:natural,traversals:natural,
  stuck:v.pipe(v.array(v.strictObject({tick:natural,waypoint:natural,x:finite,y:finite,z:finite})),v.maxLength(512)),
  final:v.strictObject({tick:natural,position:v.tuple([finite,finite,finite]),grounded:v.boolean()}),maxTickMicros:v.pipe(finite,v.minValue(0)),
});
type JourneyCommand=Extract<HeadlessCommand,{kind:'player'}>;

/** The browser walk's same waypoint tolerance and 0.3 m / 2 s progress rule,
 * driven by fixed ticks and actual committed feet. It never teleports or skips a blocked waypoint. */
export class PhysicsRouteCursor {
  private at=0;
  private direction=1;
  private jumps=0;
  private jumpedAt=0;
  private lastY:number|undefined;
  private windowTick=0;
  private windowDistance=Infinity;
  private readonly reported=new Set<string>();
  readonly stuck:WalkStall[]=[];
  visited=0;
  traversals=0;
  complete=false;
  private readonly points:readonly WalkPoint[];
  private readonly options:{once?:boolean;edge?:boolean};
  constructor(points:readonly WalkPoint[],options:{once?:boolean;edge?:boolean}={}) {
    this.points=points;this.options=options;
    if(points.length<2||points.some(point=>![point.x,point.z].every(Number.isFinite)))throw new Error('Walk needs two finite route points');
  }
  command(position:readonly number[],tick:number):JourneyCommand {
    const [x,y,z]=position;
    if(x===undefined||y===undefined||z===undefined||![x,y,z].every(Number.isFinite))throw new Error('Invalid committed walk feet');
    if(this.complete)return {kind:'player',moveX:0,moveZ:0,yaw:0};
    let point=this.points[this.at];if(point===undefined)throw new Error('Missing walk waypoint');
    for(let skipped=0;skipped<this.points.length&&Math.hypot(point.x-x,point.z-z)<.8;skipped++){
      this.visited++;this.at+=this.direction;this.jumps=0;this.windowTick=tick;this.windowDistance=Infinity;
      if(this.at>=this.points.length&&this.options.once===true){this.complete=true;return {kind:'player',moveX:0,moveZ:0,yaw:0};}
      if(this.at>=this.points.length){this.direction=-1;this.at=this.points.length-2;this.traversals++;}
      else if(this.at<0){this.direction=1;this.at=1;this.traversals++;}
      point=this.points[this.at];if(point===undefined)throw new Error('Missing next walk waypoint');
    }
    const dx=point.x-x,dz=point.z-z,distance=Math.hypot(dx,dz),key=`${this.direction}:${this.at}`;
    if(distance<this.windowDistance-.3){this.windowDistance=distance;this.windowTick=tick;}
    if(this.options.edge===true&&tick-this.windowTick>72){
      // An escape leg proves that a wall holds; only that declared mode may
      // advance a blocked target. Ordinary routes retain the failed waypoint.
      this.at++;this.jumps=0;this.windowDistance=Infinity;this.windowTick=tick;
      if(this.at>=this.points.length)this.complete=true;
      return {kind:'player',moveX:0,moveZ:0,yaw:0};
    }
    if(tick-this.windowTick>=120&&!this.reported.has(key)){
      this.reported.add(key);this.stuck.push({tick,waypoint:this.at,x,y,z});
    }
    const count=point.jump===true?1:typeof point.jump==='number'?point.jump:0;
    let jump=false;
    if(count>0&&distance<(point.jumpAt??1.6)&&this.jumps===0){jump=true;this.jumps=1;this.jumpedAt=tick;}
    else if(count>1&&this.jumps===1&&tick-this.jumpedAt>5&&this.lastY!==undefined&&(y-this.lastY)*60<1.5){jump=true;this.jumps=2;}
    this.lastY=y;
    return {kind:'player',moveX:distance===0?0:dx/distance,moveZ:distance===0?0:dz/distance,yaw:Math.atan2(-dx,-dz),...(jump?{jump:true}:{})};
  }
}

/** One committed tick of a journey, for a replay (P1-E5.3-B3). The feet are copied; the capture may keep the sample. */
export interface HeadlessJourneySample {readonly commands:readonly HeadlessCommand[];readonly x:number;readonly y:number;readonly z:number;readonly grounded:boolean}
/** Terminal offline walk. Every tick runs the original native adapter and
 * its script/decision/finite-state refusals. The parent request watchdog still
 * preempts a blocked worker. This proof does not encode a resumable checkpoint.
 * `capture` sees the placed start with no commands, then every committed tick. */
export function runHeadlessJourney(host:SimHost,step:(commands:readonly HeadlessCommand[])=>void,input:HeadlessJourneyPlan,capture?:(sample:HeadlessJourneySample)=>void):HeadlessJourneyReport {
  const player=leadPlayer(host),plan=v.parse(HeadlessJourneyPlanSchema,input),cursor=new PhysicsRouteCursor(plan.points,{once:plan.once===true,edge:plan.inside!==undefined}),initial=host.state.tick;
  let distance=0,maxTickMicros=0,out=0,ticks=0;
  const observe=(commands:readonly HeadlessCommand[]):void=>{const p=player.position;capture?.({commands,x:p.x,y:p.y,z:p.z,grounded:player.fall.grounded});};
  const held=new Map<AnimalSim,boolean>();
  const holdActors=():void=>{
    for(const actor of host.entities.values()){
      if(!held.has(actor))held.set(actor,actor.harnessHold);
      actor.harnessHold=true;
    }
  };
  const tick=(commands:readonly HeadlessCommand[]):void=>{
    if(plan.holdActors===true)holdActors();
    const prior=host.state.tick,started=diagnosticNow();step(commands);maxTickMicros=Math.max(maxTickMicros,(diagnosticNow()-started)*1000);
    if(host.state.tick!==prior+1)throw new Error('Journey did not commit exactly one tick');
    const p=player.position;if(![p.x,p.y,p.z].every(Number.isFinite))throw new Error('Journey produced invalid feet');
    observe(commands);
  };
  const preparationTicks=plan.start===undefined?0:36;
  const walking={speed:walkingSpeed(false,false,0,1,1),crouching:false};
  // Only explicit physics routes replace the native capsule and walking law.
  const releaseWalk=plan.start===undefined?()=>undefined:player.useWalkingControl(walking);
  let releaseActors:()=>void=()=>undefined;
  try {
  if(plan.holdActors===true){holdActors();releaseActors=host.onStep('physics.walk.hold',holdActors);}
  if(plan.start!==undefined){
    const start=plan.start,p=player.position,ground=host.groundHeightAt(start.x,start.z);
    const floor=start.y??Math.max(ground,floorBelow(host.physics,start.x,start.z,ground+2.5,2.6,player.motor.collider)??ground);
    player.resetPose({x:start.x,y:floor,z:start.z},start.yaw);
    player.releaseMotor().dispose();
    const motor=new CharacterMotor(host.physics,{...PLAYER_CAPSULE,...PLAYER_BODY,owner:player.id});
    player.attachMotor(motor);motor.resetAt(p);
    if(start.hover===true)player.setBoard(true);
    observe([]);
    for(let at=0;at<preparationTicks;at++)tick([]);
  }
  for(let at=0;at<plan.ticks;at++){
    const p=player.position,x=p.x,z=p.z,command=cursor.command([p.x,p.y,p.z],at);
    if(plan.once===true&&cursor.complete)break;
    tick([command]);ticks++;distance+=Math.hypot(p.x-x,p.z-z);
    const box=plan.inside;
    if(box!==undefined&&(p.x<box.x0||p.x>box.x1||p.z<box.z0||p.z>box.z1||p.y<box.floor))out++;
    if(plan.once===true&&cursor.stuck.length>0)break;
  }
  // The original one-way ruler stops at the endpoint; only the continuous
  // integration tape releases input for its final grounded observation.
  const settledTicks=plan.once===true?0:60;for(let at=0;at<settledTicks;at++)tick([]);
  if(host.state.tick!==initial+preparationTicks+ticks+settledTicks)throw new Error('Journey tick count differs');
  const p=player.position;
  return {ticks,preparationTicks,settledTicks,complete:cursor.complete,out,distance,visited:cursor.visited,traversals:cursor.traversals,stuck:cursor.stuck,
    final:{tick:host.state.tick,position:[p.x,p.y,p.z],grounded:player.motor.snapshot().result.grounded},maxTickMicros};
  } finally { releaseActors();for(const [actor,prior] of held)actor.harnessHold=prior;held.clear();releaseWalk(); }
}
