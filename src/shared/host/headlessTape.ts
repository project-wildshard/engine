import * as v from 'valibot';
import type {SimHost} from '@wildshard/engine/sim';
import {PhysicsRouteCursor,type WalkPoint} from './headlessJourney';
import type {HeadlessCommand,HeadlessEffect} from './tickProtocol';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

export interface HeadlessTapeSegment {id:string;ticks:number;commands:HeadlessCommand[];route?:WalkPoint[];frames?:HeadlessCommand[][]}
export interface HeadlessTapePlan {version:1;observe:string[];segments:HeadlessTapeSegment[]}
export interface HeadlessTapeObservation {
  id:string;tick:number;position:[number,number,number];peakY:number;grounded:boolean;
  flags:string[];quests:{id:string;currentId:string|null;started:boolean;complete:boolean}[];effects:HeadlessEffect[];adapters:{id:string;state:string}[];
}
export interface HeadlessTapeReport {version:1;ticks:number;observations:HeadlessTapeObservation[]}
const finite=v.pipe(v.number(),v.finite());
const natural=v.pipe(finite,v.integer(),v.minValue(0));
const text=v.pipe(v.string(),v.minLength(1),v.maxLength(128));
const validTape=(plan:HeadlessTapePlan):boolean=>plan.segments.reduce((sum,row)=>sum+row.ticks,0)<=60_000
  &&new Set(plan.segments.map(row=>row.id)).size===plan.segments.length&&new Set(plan.observe).size===plan.observe.length
  &&plan.segments.every(row=>row.frames===undefined||row.frames.length===row.ticks&&row.commands.length===0&&row.route===undefined)
  &&plan.segments.reduce((sum,row)=>sum+(row.frames?.reduce((total,commands)=>total+commands.length,0)??row.commands.length),0)<=60_000;
/** Internal codec composition; callers supply the one canonical tick grammar,
 * not a second copy which could silently lose a newly admitted command. */
export function headlessTapePlanSchema(command:v.GenericSchema<HeadlessCommand>):v.GenericSchema<HeadlessTapePlan> {
  return v.pipe(v.strictObject({version:v.literal(1),observe:v.pipe(v.array(text),v.maxLength(32)),
    segments:v.pipe(v.array(v.strictObject({id:text,ticks:v.pipe(natural,v.minValue(1),v.maxValue(18_000)),
      commands:v.pipe(v.array(command),v.maxLength(1024)),
      frames:v.exactOptional(v.pipe(v.array(v.pipe(v.array(command),v.maxLength(1024))),v.minLength(1),v.maxLength(18_000))),
      route:v.exactOptional(v.pipe(v.array(v.strictObject({x:finite,z:finite,jump:v.exactOptional(v.union([v.boolean(),v.pipe(natural,v.maxValue(2))])),jumpAt:v.exactOptional(v.pipe(finite,v.minValue(0)))})),v.minLength(2),v.maxLength(256)))})),v.minLength(1),v.maxLength(128))}),
    v.check(validTape,'Distinct tape observations and at most 60000 fixed ticks'));
}
/** The bounded reply contains actual observations, never a resumable checkpoint
 * or an assertion supplied by the tape's author. */
export function headlessTapeReportSchema(effect:v.GenericSchema<HeadlessEffect>):v.GenericSchema<HeadlessTapeReport> {
  return v.strictObject({version:v.literal(1),ticks:v.pipe(natural,v.maxValue(60_000)),
    observations:v.pipe(v.array(v.strictObject({id:text,tick:natural,position:v.tuple([finite,finite,finite]),peakY:finite,grounded:v.boolean(),
      flags:v.pipe(v.array(text),v.maxLength(4096)),quests:v.pipe(v.array(v.strictObject({id:text,currentId:v.nullable(text),started:v.boolean(),complete:v.boolean()})),v.maxLength(512)),effects:v.pipe(v.array(effect),v.maxLength(1024)),
      adapters:v.pipe(v.array(v.strictObject({id:text,state:v.pipe(v.string(),v.maxLength(1_000_000))})),v.maxLength(32))})),v.maxLength(128))});
}
/** Private worker-side execution of an already admitted offline tape. Every
 * repeated command still enters the existing native owner and fixed tick.
 * The worker keeps its request watchdog; the reply is terminal observations. */
export function runTrustedHeadlessTape(host:SimHost,step:(commands:readonly HeadlessCommand[])=>void,
  effects:()=>readonly HeadlessEffect[],plan:HeadlessTapePlan):HeadlessTapeReport {
  if(host.scope.disposed||host.scope.disposing)throw new Error('Tape owner retired');
  const owners=plan.observe.map(id=>{const owner=host.adapters.get(id);if(owner===undefined)throw new Error(`Missing tape observation owner ${id}`);return {id,owner};});
  const player=leadPlayer(host),initial=host.state.tick,observations:HeadlessTapeObservation[]=[],encoder=new TextEncoder();let bytes=0;
  for(const segment of plan.segments){
    let peakY=player.position.y;const emitted:HeadlessEffect[]=[];
    const cursor=segment.route===undefined?null:new PhysicsRouteCursor(segment.route,{once:true});
    const moving=[...segment.commands];if(cursor!==null)moving.push({kind:'player',moveX:0,moveZ:0,yaw:0});
    for(let tick=0;tick<segment.ticks;tick++){
      if(cursor!==null){
        const p=player.position,command=cursor.command([p.x,p.y,p.z],tick);
        if(cursor.complete)break;
        if(cursor.stuck.length>0)throw new Error(`Tape route stuck ${segment.id}`);
        moving[moving.length-1]=command;
      }
      const prior=host.state.tick;step(segment.frames?.[tick]??(cursor===null?segment.commands:moving));
      if(host.scope.disposed||host.scope.disposing)throw new Error('Tape owner retired');
      if(host.state.tick!==prior+1)throw new Error('Tape did not commit exactly one tick');
      const p=player.position;if(![p.x,p.y,p.z].every(Number.isFinite))throw new Error('Nonfinite tape feet');
      peakY=Math.max(peakY,p.y);for(const effect of effects())emitted.push({...effect});
      if(emitted.length>1024)throw new Error('Tape effect allowance exceeded');
    }
    if(cursor!==null&&!cursor.complete){
      const p=player.position;cursor.command([p.x,p.y,p.z],segment.ticks);
      if(!cursor.complete)throw new Error(`Tape route incomplete ${segment.id}`);
    }
    const p=player.position;
    const observation:HeadlessTapeObservation={id:segment.id,tick:host.state.tick,position:[p.x,p.y,p.z],peakY,
      grounded:player.motor.snapshot().result.grounded,flags:[...host.flags.all],
      quests:host.quests.map(quest=>({id:quest.def.id,currentId:quest.current?.id??null,started:quest.snapshot().started,complete:quest.isComplete})),effects:emitted,
      adapters:owners.map(({id,owner})=>{
        if(host.adapters.get(id)!==owner)throw new Error(`Tape observation owner changed ${id}`);
        const value=owner.snapshot();
        const state=typeof value==='string'?value:JSON.stringify(value,(_key,entry:unknown)=>{
          if(typeof entry==='number'&&!Number.isFinite(entry))throw new Error(`Nonfinite tape owner ${id}`);return entry;
        });
        if(state.length>1_000_000)throw new Error('Tape owner observation allowance exceeded');return {id,state};
      })};
    bytes+=encoder.encode(JSON.stringify(observation)).byteLength;
    if(bytes>8_000_000)throw new Error('Tape observation allowance exceeded');
    observations.push(observation);
  }
  return {version:1,ticks:host.state.tick-initial,observations};
}

/** A resident tape owner stays pinned across streamed parts as well as inside
 * each ordinary terminal plan. No part may silently rebind an observation. */
export function createTrustedHeadlessTape(host:SimHost,step:(commands:readonly HeadlessCommand[])=>void,
  effects:()=>readonly HeadlessEffect[]):(plan:HeadlessTapePlan)=>HeadlessTapeReport {
  let pinned:{id:string;owner:unknown}[]|undefined;
  return plan=>{
    const owners=plan.observe.map(id=>({id,owner:host.adapters.get(id)}));
    if(pinned===undefined)pinned=owners;
    else if(owners.length!==pinned.length||owners.some((row,index)=>row.id!==pinned?.[index]?.id||row.owner!==pinned[index]?.owner))throw new Error('Tape observation owner changed between parts');
    return runTrustedHeadlessTape(host,step,effects,plan);
  };
}
