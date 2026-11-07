// oxlint-disable-next-line import/no-nodejs-modules -- Bind only the physically earned continuation between bounded native cases.
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {HeadlessTapePlanSchema,HeadlessTapeReportSchema} from '../../../src/shared/host/tickProtocol';

const natural=v.pipe(v.number(),v.safeInteger(),v.minValue(0));
const digest=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const finite=v.pipe(v.number(),v.finite());
export const QaraPartSchema=v.strictObject({plan:HeadlessTapePlanSchema,expected:HeadlessTapeReportSchema});
export type QaraPart=v.InferOutput<typeof QaraPartSchema>;
export const QaraHandoffSchema=v.strictObject({version:v.literal(1),source:digest,snapshot:v.pipe(v.string(),v.maxLength(24_000_000)),digest,
  nightTick:natural,ticks:natural,parts:v.pipe(v.array(QaraPartSchema),v.maxLength(128)),
  motion:v.array(v.tuple([v.string(),v.strictObject({x:finite,z:finite,vx:finite,vz:finite})]))});
export type QaraHandoff=v.InferOutput<typeof QaraHandoffSchema>;
export const qaraWireHash=(wire:string):string=>createHash('sha256').update(wire).digest('hex');

/** All children share the original tape allowance, including the already
 * replayed prefix. Intermediate handoffs add checks, never a second budget. */
export function checkQaraLedger(parts:readonly QaraPart[],nightTick:number,ticks:number):void{
  let tick=nightTick,commands=0,bytes=0;
  if(parts.length>128)throw new Error('Qara aggregate part allowance exceeded');
  for(let index=0;index<parts.length;index++){
    const part=parts[index];if(part===undefined)throw new Error('Missing Qara part');
    const segment=part.plan.segments[0],observation=part.expected.observations[0];
    if(part.plan.segments.length!==1||segment===undefined||segment.id!==`fight-${index}`||segment.ticks>512
      ||segment.frames?.length!==segment.ticks||segment.commands.length>0||segment.route!==undefined
      ||JSON.stringify(part.plan.observe)!==JSON.stringify(['nalati.patrol','nalati.qara','nalati.weapons'])
      ||part.expected.observations.length!==1||observation?.id!==segment.id||part.expected.ticks!==segment.ticks)
      throw new Error('Qara handoff changed an ordered part');
    tick+=segment.ticks;if(observation.tick!==tick)throw new Error('Qara handoff skipped an input interval');
    commands+=segment.frames.reduce((sum,frame)=>sum+frame.length,0);
    bytes+=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
  }
  if(tick-nightTick!==ticks)throw new Error('Qara handoff lost captured ticks');
  if(ticks>60_000||commands>60_000||bytes>8_000_000)throw new Error('Qara aggregate tape allowance exceeded');
}

/** Diagnostic integrity of the original 512-tick observation intervals.
 * An extra earned handoff splits an interval; join its ordered effects and
 * peak before hashing, without omitting any original checked boundary. */
export function qaraObservationHash(rows:readonly v.InferOutput<typeof HeadlessTapeReportSchema>['observations'][number][],nightTick:number):string{
  const hash=createHash('sha256');let pending:typeof rows[number]|undefined;
  for(let index=0;index<rows.length;index++){
    const row=rows[index];if(row===undefined)throw new Error('Missing Qara observation');
    pending={...row,id:'',peakY:Math.max(pending?.peakY??row.peakY,row.peakY),effects:[...(pending?.effects??[]),...row.effects]};
    if((row.tick-nightTick)%512===0||index===rows.length-1){hash.update(JSON.stringify(pending));hash.update('\n');pending=undefined;}
  }
  return hash.digest('hex');
}
export function qaraCommandHash(parts:readonly QaraPart[]):string{
  const hash=createHash('sha256');
  for(const part of parts)for(const segment of part.plan.segments)for(const frame of segment.frames??[]){
    hash.update(JSON.stringify(frame,(_key:string,value:unknown):unknown=>{
      if(typeof value==='number'&&Object.is(value,-0))return {'number.sign':'-0'};
      return value!==null&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value;
    }));hash.update('\n');
  }
  return hash.digest('hex');
}
